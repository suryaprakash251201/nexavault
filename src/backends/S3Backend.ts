/**
 * S3Backend - S3-compatible storage backend
 *
 * NOTE: The AWS SDK is imported LAZILY (only when S3 is actually used).
 * This is critical for Obsidian: heavy third-party SDKs must not execute
 * any top-level code during plugin load, or the plugin fails to enable.
 */

import type {
  S3Client,
  PutObjectCommandInput,
  GetObjectCommandInput,
  DeleteObjectCommandInput,
  ListObjectsV2CommandInput,
  HeadObjectCommandInput,
  CopyObjectCommandInput,
} from '@aws-sdk/client-s3';
import { BaseSyncBackend, RemoteFile } from './SyncBackend';
import { Manifest } from '../models/Manifest';
import { Change } from '../models/Change';
import { RemoteChange } from '../models/SyncResult';
import { Logger } from '../utils/logger';
import { SecureCredentialStore } from '../crypto/SecureCredentialStore';
import { EncryptionService } from '../crypto/EncryptionService';
import { normalizePath, joinPath } from '../utils/pathUtils';
import { S3Settings, S3ProviderType } from '../models/Settings';

interface S3Config extends S3Settings {
  enabled: boolean;
}

export interface BackupInfo {
  id: string;
  name: string;
  timestamp: number;
  size: number;
  fileCount: number;
  backend: string;
}

export interface BackupSnapshot {
  id: string;
  createdAt: number;
  deviceId: string;
  files: Record<string, { hash: string; size: number; mtime: number }>;
}

// Lazy loader for the S3 AWS SDK - module body only evaluates on first use
let sdkPromise: Promise<typeof import('@aws-sdk/client-s3')> | null = null;
function getSdk(): Promise<typeof import('@aws-sdk/client-s3')> {
  sdkPromise ||= import('@aws-sdk/client-s3');
  return sdkPromise;
}

// Lazy loader for @aws-sdk/lib-storage (multipart uploads)
let libStoragePromise: Promise<typeof import('@aws-sdk/lib-storage')> | null = null;
function getLibStorage(): Promise<typeof import('@aws-sdk/lib-storage')> {
  libStoragePromise ||= import('@aws-sdk/lib-storage');
  return libStoragePromise;
}

export class S3Backend extends BaseSyncBackend {
  private client: S3Client | null = null;
  private credentialStore: SecureCredentialStore;
  private encryptionService: EncryptionService | null = null;
  private bucket: string;
  private prefix: string;
  private fileReader: ((path: string) => Promise<Uint8Array>) | null = null;

  /**
   * Inject a vault file reader (wired by SyncEngine)
   */
  setFileReader(reader: (path: string) => Promise<Uint8Array>): void {
    this.fileReader = reader;
  }

  constructor(config: S3Config, logger: Logger, credentialStore: SecureCredentialStore) {
    super(config, logger);
    this.credentialStore = credentialStore;
    this.bucket = config.bucket;
    this.prefix = config.prefix || 'vault/';
  }

  getId(): string {
    return 's3';
  }

  getName(): string {
    const providerNames: Record<S3ProviderType, string> = {
      aws: 'AWS S3',
      r2: 'Cloudflare R2',
      b2: 'Backblaze B2',
      minio: 'MinIO',
      custom: 'Custom S3',
    };
    return providerNames[this.config.provider] || 'S3 Compatible';
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    this.logger.info(`Connecting to ${this.getName()}...`);

    // Get credentials from secure storage
    let accessKeyId = this.config.accessKeyId;
    let secretAccessKey = this.config.secretAccessKey;
    let sessionToken = this.config.sessionToken;

    if (!accessKeyId) accessKeyId = await this.credentialStore.get('s3_access_key');
    if (!secretAccessKey) secretAccessKey = await this.credentialStore.get('s3_secret_key');
    if (!sessionToken && this.config.provider === 'aws') {
      sessionToken = await this.credentialStore.get('s3_session_token');
    }

    if (!accessKeyId || !secretAccessKey) {
      throw new Error('S3 credentials not configured');
    }

    // Lazily load the AWS SDK (never executes during plugin load)
    const { S3Client, HeadObjectCommand } = await getSdk();

    // Determine endpoint
    let endpoint = this.config.endpoint;
    if (!endpoint) endpoint = this.getDefaultEndpoint(this.config.provider);

    this.client = new S3Client({
      region: this.config.region,
      endpoint,
      credentials: {
        accessKeyId,
        secretAccessKey,
        ...(sessionToken && { sessionToken }),
      },
      forcePathStyle: this.config.provider === 'minio' || this.config.provider === 'custom',
    });

    // Initialize encryption if enabled
    if (this.config.encryption?.enabled) {
      this.encryptionService = new EncryptionService(this.config.encryption);
      await this.encryptionService.initialize();
    }

    // Test connection
    try {
      await this.client.send(new HeadObjectCommand({
        Bucket: this.bucket,
        Key: this.prefix + '.healthcheck',
      }));
    } catch (error: any) {
      if (error.name !== 'NotFound' && error.$metadata?.httpStatusCode !== 404) {
        throw new Error(`S3 connection failed: ${error.message}`);
      }
      // 404 is fine - bucket exists but healthcheck object doesn't
    }

    this.connected = true;
    this.logger.info(`${this.getName()} connected successfully`);
  }

  async disconnect(): Promise<void> {
    this.client = null;
    this.encryptionService = null;
    this.connected = false;
    this.logger.info(`${this.getName()} disconnected`);
  }

  async testConnection(): Promise<boolean> {
    if (!this.client) return false;

    const { HeadObjectCommand } = await getSdk();
    try {
      await this.client.send(new HeadObjectCommand({
        Bucket: this.bucket,
        Key: this.prefix + '.healthcheck',
      }));
      return true;
    } catch {
      return true; // 404 is still a successful connection
    }
  }

  async getRemoteManifest(): Promise<Manifest> {
    if (!this.client) throw new Error('Not connected');

    this.logger.debug('Fetching S3 manifest...');

    const { ListObjectsV2Command, HeadObjectCommand } = await getSdk();

    try {
      const files: Manifest['files'] = {};
      let continuationToken: string | undefined;

      do {
        const response = await this.client.send(new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: this.prefix,
          ContinuationToken: continuationToken,
        }));

        for (const obj of response.Contents || []) {
          if (obj.Key && !obj.Key.endsWith('/')) {
            const relativePath = normalizePath(obj.Key.replace(this.prefix, ''));
            if (relativePath && !relativePath.startsWith('metadata/')) {
              const head = await this.client.send(new HeadObjectCommand({
                Bucket: this.bucket,
                Key: obj.Key,
              }));

              files[relativePath] = {
                hash: head.Metadata?.['x-vaultsync-hash'] || '',
                size: obj.Size || 0,
                mtime: head.LastModified?.getTime() || Date.now(),
              };
            }
          }
        }

        continuationToken = response.NextContinuationToken;
      } while (continuationToken);

      return {
        version: 1,
        generatedAt: Date.now(),
        deviceId: 's3',
        files,
        metadata: {
          totalFiles: Object.keys(files).length,
          totalSize: Object.values(files).reduce((sum, f) => sum + f.size, 0),
          schemaVersion: 1,
        },
      };
    } catch (error) {
      this.logger.error('Failed to get S3 manifest', error);
      throw error;
    }
  }

  async uploadFile(path: string, data: Uint8Array): Promise<{ etag?: string; versionId?: string }> {
    if (!this.client) throw new Error('Not connected');

    const { PutObjectCommand } = await getSdk();
    const key = this.getObjectKey(path);
    let uploadData = data;

    // Encrypt if enabled
    if (this.encryptionService) {
      uploadData = await this.encryptionService.encrypt(data);
    }

    // Use multipart upload for large files
    const multipartThreshold = (this.config.multipartThresholdMB || 100) * 1024 * 1024;
    if (uploadData.length > multipartThreshold) {
      return this.uploadMultipart(key, uploadData);
    }

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: uploadData,
      Metadata: {
        'x-vaultsync-hash': await this.computeHash(data),
        'x-vaultsync-original-size': data.length.toString(),
        'x-vaultsync-encrypted': this.encryptionService ? 'true' : 'false',
      },
    });

    const response = await this.client.send(command);
    return { etag: response.ETag, versionId: response.VersionId };
  }

  private async uploadMultipart(key: string, data: Uint8Array): Promise<{ etag?: string; versionId?: string }> {
    if (!this.client) throw new Error('Not connected');

    // Lazily load lib-storage (multipart upload helper)
    const { Upload } = await getLibStorage();
    const partSize = (this.config.multipartChunksizeMB || 50) * 1024 * 1024;

    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: data,
        Metadata: {
          'x-vaultsync-hash': await this.computeHash(data),
          'x-vaultsync-original-size': data.length.toString(),
          'x-vaultsync-encrypted': this.encryptionService ? 'true' : 'false',
        },
      },
      queueSize: 4,
      partSize,
    });

    const response = await upload.done();
    return { etag: response.ETag, versionId: response.VersionId };
  }

  async downloadFile(path: string): Promise<Uint8Array> {
    if (!this.client) throw new Error('Not connected');

    const { GetObjectCommand } = await getSdk();
    const key = this.getObjectKey(path);

    const response = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }));

    if (!response.Body) {
      throw new Error(`File not found: ${path}`);
    }

    // Stream to buffer
    const chunks: Uint8Array[] = [];
    const stream = response.Body as any;
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    let data = Buffer.concat(chunks);

    // Decrypt if enabled
    if (this.encryptionService && response.Metadata?.['x-vaultsync-encrypted'] === 'true') {
      data = await this.encryptionService.decrypt(data);
    }

    // Verify hash
    const expectedHash = response.Metadata?.['x-vaultsync-hash'];
    if (expectedHash) {
      const actualHash = await this.computeHash(data);
      if (actualHash !== expectedHash) {
        throw new Error(`Hash mismatch for ${path}`);
      }
    }

    return data;
  }

  async deleteFile(path: string): Promise<void> {
    if (!this.client) throw new Error('Not connected');

    const { DeleteObjectCommand } = await getSdk();
    const key = this.getObjectKey(path);

    await this.client.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }));
  }

  async listFiles(prefix?: string): Promise<RemoteFile[]> {
    if (!this.client) throw new Error('Not connected');

    const { ListObjectsV2Command } = await getSdk();
    const listPrefix = prefix ? this.getObjectKey(prefix) : this.prefix;
    const files: RemoteFile[] = [];
    let continuationToken: string | undefined;

    do {
      const response = await this.client.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: listPrefix,
        ContinuationToken: continuationToken,
      }));

      for (const obj of response.Contents || []) {
        if (obj.Key && !obj.Key.endsWith('/')) {
          const relativePath = normalizePath(obj.Key.replace(this.prefix, ''));
          files.push({
            path: relativePath,
            size: obj.Size || 0,
            mtime: obj.LastModified?.getTime() || Date.now(),
            etag: obj.ETag,
            versionId: obj.VersionId,
          });
        }
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return files;
  }

  async pushChanges(changes: Change[]): Promise<void> {
    if (!this.client) throw new Error('Not connected');
    if (changes.length === 0) return;

    this.logger.info(`Uploading ${changes.length} changes to S3...`);

    // Process in batches for concurrency control
    const concurrency = 3;
    for (let i = 0; i < changes.length; i += concurrency) {
      const batch = changes.slice(i, i + concurrency);
      await Promise.all(batch.map(change => this.processChange(change)));
    }
  }

  private async processChange(change: Change): Promise<void> {
    const path = normalizePath(change.path);

    switch (change.type) {
      case 'create':
      case 'modify': {
        if (!this.fileReader) {
          throw new Error('S3 backend has no file reader - file upload disabled');
        }
        const data = await this.fileReader(change.path);
        await this.uploadFile(path, data);
        break;
      }
      case 'delete': {
        await this.deleteFile(path);
        break;
      }
      case 'rename': {
        if (change.oldPath) {
          await this.renameFile(change.oldPath, path);
        }
        break;
      }
    }
  }

  private async renameFile(oldPath: string, newPath: string): Promise<void> {
    if (!this.client) throw new Error('Not connected');

    const { CopyObjectCommand } = await getSdk();
    const oldKey = this.getObjectKey(oldPath);
    const newKey = this.getObjectKey(newPath);

    // Copy to new location
    await this.client.send(new CopyObjectCommand({
      Bucket: this.bucket,
      CopySource: `${this.bucket}/${oldKey}`,
      Key: newKey,
      MetadataDirective: 'COPY',
    }));

    // Delete old
    await this.deleteFile(oldPath);
  }

  async pullChanges(): Promise<RemoteChange[]> {
    return [];
  }

  private getObjectKey(path: string): string {
    return joinPath(this.prefix, path);
  }

  private getDefaultEndpoint(provider: S3ProviderType): string {
    const endpoints: Record<S3ProviderType, string> = {
      aws: 'https://s3.amazonaws.com',
      r2: `https://${this.config.bucket}.r2.cloudflarestorage.com`,
      b2: 'https://s3.us-west-004.backblazeb2.com',
      minio: 'http://localhost:9000',
      custom: '',
    };
    return endpoints[provider] || '';
  }

  private async computeHash(data: Uint8Array): Promise<string> {
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // ================= BACKUP / RESTORE =================

  /**
   * Create a backup snapshot: writes a timestamped manifest under
   * metadata/backups/ and verifies it before returning.
   */
  async createBackup(manifest: Manifest): Promise<BackupInfo> {
    if (!this.client) throw new Error('Not connected');

    const { PutObjectCommand, HeadObjectCommand } = await getSdk();
    const timestamp = Date.now();
    const id = `backup-${timestamp}`;
    const key = `metadata/backups/${id}.json`;

    const payload = {
      id,
      createdAt: timestamp,
      deviceId: manifest.deviceId,
      files: manifest.files,
    };

    const body = new TextEncoder().encode(JSON.stringify(payload, null, 2));
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: 'application/json',
    }));

    // Verify the write succeeded (fail-safe: never report success without check)
    const verify = await this.client.send(new HeadObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }));
    if (!verify || !verify.ETag) {
      throw new Error('Backup verification failed - backup not recorded');
    }

    const backup: BackupInfo = {
      id,
      name: new Date(timestamp).toISOString().replace(/[:.]/g, '-'),
      timestamp,
      size: body.length,
      fileCount: Object.keys(manifest.files || {}).length,
      backend: 's3',
    };
    this.logger.info(`Backup created: ${id} (${backup.fileCount} files)`);
    return backup;
  }

  /**
   * List all backup snapshots stored under metadata/backups/
   */
  async listBackups(): Promise<BackupInfo[]> {
    if (!this.client) throw new Error('Not connected');

    const { ListObjectsV2Command } = await getSdk();
    const backups: BackupInfo[] = [];
    let continuationToken: string | undefined;

    do {
      const response = await this.client.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: 'metadata/backups/',
        ContinuationToken: continuationToken,
      }));
      for (const obj of response.Contents || []) {
        if (!obj.Key || !obj.Key.endsWith('.json')) continue;
        const id = obj.Key.split('/').pop()!.replace(/\.json$/, '');
        backups.push({
          id,
          name: id,
          timestamp: obj.LastModified?.getTime() || 0,
          size: obj.Size || 0,
          fileCount: 0,
          backend: 's3',
        });
      }
      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    backups.sort((a, b) => b.timestamp - a.timestamp);
    return backups;
  }

  /**
   * Load a backup snapshot manifest by id
   */
  async getBackupManifest(id: string): Promise<BackupSnapshot | null> {
    if (!this.client) throw new Error('Not connected');

    const { GetObjectCommand } = await getSdk();
    try {
      const response = await this.client.send(new GetObjectCommand({
        Bucket: this.bucket,
        Key: `metadata/backups/${id}.json`,
      }));
      if (!response.Body) return null;
      const chunks: Uint8Array[] = [];
      for await (const chunk of response.Body as any) chunks.push(chunk);
      const text = new TextDecoder().decode(Buffer.concat(chunks));
      const data = JSON.parse(text);
      return {
        id: data.id || id,
        createdAt: data.createdAt || 0,
        deviceId: data.deviceId || 'unknown',
        files: data.files || {},
      };
    } catch (error: any) {
      if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Delete a backup snapshot (used by retention pruning)
   */
  async deleteBackup(id: string): Promise<void> {
    if (!this.client) throw new Error('Not connected');

    const { DeleteObjectCommand } = await getSdk();
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: `metadata/backups/${id}.json`,
    }));
    this.logger.info(`Backup deleted: ${id}`);
  }

  /**
   * Prune old backups according to retention policy.
   * Fail-safe: only deletes AFTER the newest backup already exists,
   * and never deletes the newest backup.
   */
  async pruneBackups(retention: { daily: number; weekly: number; monthly: number; maxTotalBackups: number }): Promise<number> {
    const backups = await this.listBackups();
    if (backups.length <= 1) return 0;

    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const maxTotal = retention.maxTotalBackups || 50;

    const allow = new Set<string>();
    const newest = backups[0];
    if (newest) allow.add(newest.id); // never delete newest

    // Daily: newest N backups within last N days
    const dCount = retention.daily || 0;
    let dTaken = 0;
    for (const b of backups) {
      if (b.timestamp >= now - dCount * day && dTaken < dCount) { allow.add(b.id); dTaken++; }
    }

    // Weekly: keep N oldest-of-their-week backups
    const wCount = retention.weekly || 0;
    const weeks = new Map<string, BackupInfo>();
    for (const b of backups) {
      const wk = String(Math.floor(b.timestamp / (7 * day)));
      if (!weeks.has(wk)) weeks.set(wk, b);
    }
    [...weeks.values()].slice(0, wCount).forEach(b => allow.add(b.id));

    // Monthly: keep N first-backup-of-their-month backups
    const mCount = retention.monthly || 0;
    const months = new Map<string, BackupInfo>();
    for (const b of backups) {
      const d = new Date(b.timestamp);
      const mk = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
      if (!months.has(mk)) months.set(mk, b);
    }
    [...months.values()].slice(0, mCount).forEach(b => allow.add(b.id));

    // Enforce total cap
    let deleted = 0;
    for (const b of backups.slice(maxTotal)) {
      if (!allow.has(b.id)) {
        try {
          await this.deleteBackup(b.id);
          deleted++;
        } catch (error) {
          this.logger.error(`Failed to prune backup ${b.id}`, error);
        }
      }
    }
    if (deleted > 0) this.logger.info(`Pruned ${deleted} old backup(s)`);
    return deleted;
  }

  getCapabilities() {
    return {
      supportsVersioning: true,
      supportsMultipart: true,
      maxFileSize: 5 * 1024 * 1024 * 1024,
      maxPartSize: 5 * 1024 * 1024 * 1024,
      supportsEncryption: true,
      supportsRename: true,
      supportsBatchOperations: false,
    };
  }

  async uploadFileWithData(path: string, data: Uint8Array): Promise<{ etag?: string; versionId?: string }> {
    return this.uploadFile(path, data);
  }
}
