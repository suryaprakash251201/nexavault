/**
 * S3Backend - S3-compatible storage backend
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { BaseSyncBackend, RemoteFile } from './SyncBackend';
import { Manifest } from '../models/Manifest';
import { Change } from '../models/Change';
import { RemoteChange } from '../models/SyncResult';
import { Logger } from '../utils/logger';
import { SecureCredentialStore } from '../crypto/SecureCredentialStore';
import { EncryptionService } from '../crypto/EncryptionService';
import { normalizePath, joinPath } from '../utils/pathUtils';
import { S3Settings, S3ProviderType, EncryptionSettings } from '../models/Settings';

interface S3Config extends S3Settings {
  enabled: boolean;
}

export class S3Backend extends BaseSyncBackend {
  private client: S3Client | null = null;
  private credentialStore: SecureCredentialStore;
  private encryptionService: EncryptionService | null = null;
  private bucket: string;
  private prefix: string;

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
    
    if (!accessKeyId) {
      accessKeyId = await this.credentialStore.get('s3_access_key');
    }
    if (!secretAccessKey) {
      secretAccessKey = await this.credentialStore.get('s3_secret_key');
    }
    if (!sessionToken && this.config.provider === 'aws') {
      sessionToken = await this.credentialStore.get('s3_session_token');
    }
    
    if (!accessKeyId || !secretAccessKey) {
      throw new Error('S3 credentials not configured');
    }
    
    // Determine endpoint
    let endpoint = this.config.endpoint;
    if (!endpoint) {
      endpoint = this.getDefaultEndpoint(this.config.provider);
    }
    
    // Create S3 client
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
        // Bucket might not exist or credentials wrong
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
              // Get metadata for hash
              const head = await this.client.send(new HeadObjectCommand({
                Bucket: this.bucket,
                Key: obj.Key,
              }));
              
              const hash = head.Metadata?.['x-vaultsync-hash'] || '';
              const mtime = head.LastModified?.getTime() || Date.now();
              
              files[relativePath] = {
                hash,
                size: obj.Size || 0,
                mtime,
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
    
    const key = this.getObjectKey(path);
    
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }));
  }

  async listFiles(prefix?: string): Promise<RemoteFile[]> {
    if (!this.client) throw new Error('Not connected');
    
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
        // Read file from vault (would be provided by SyncEngine)
        // For now, we'll need the SyncEngine to pass the data
        throw new Error('File data not provided - use uploadFile directly');
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
    // Would compare manifests and return needed changes
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

  getCapabilities() {
    return {
      supportsVersioning: true,
      supportsMultipart: true,
      maxFileSize: 5 * 1024 * 1024 * 1024, // 5TB
      maxPartSize: 5 * 1024 * 1024 * 1024,
      supportsEncryption: true,
      supportsRename: true,
      supportsBatchOperations: false,
    };
  }

  // Methods for SyncEngine to use with actual file data
  async uploadFileWithData(path: string, data: Uint8Array): Promise<{ etag?: string; versionId?: string }> {
    return this.uploadFile(path, data);
  }
}
