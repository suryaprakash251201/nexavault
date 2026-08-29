/**
 * ManifestManager - Manages the vault manifest with incremental updates
 */

import { App, TFile, Vault } from 'obsidian';
import { HashManager } from './HashManager';
import { ManifestStore } from '../storage/StateStore';
import { Manifest, ManifestFileEntry, ManifestFileMap, ManifestDiff, RenameEntry, createEmptyManifest, calculateManifestMetadata, migrateManifest } from '../models/Manifest';
import { Logger } from '../utils/logger';
import { Change } from '../models/Change';
import { matchAnyGlob, normalizePath } from '../utils/pathUtils';
import { VaultSyncSettings } from '../models/Settings';

export class ManifestManager {
  private app: App;
  private vault: Vault;
  private hashManager: HashManager;
  private store: ManifestStore;
  private logger: Logger;
  private settings: VaultSyncSettings;
  private manifest: Manifest | null = null;
  private initialized = false;
  private deviceId: string;

  constructor(app: App, hashManager: HashManager, logger: Logger) {
    this.app = app;
    this.vault = app.vault;
    this.hashManager = hashManager;
    this.logger = logger;
    this.deviceId = this.generateDeviceId();
    // Store will be initialized later when plugin is available
    this.store = null as any;
    this.settings = {} as VaultSyncSettings;
  }

  setStore(plugin: any): void {
    this.store = new ManifestStore(this.app, plugin, this.logger);
  }

  setSettings(settings: VaultSyncSettings): void {
    this.settings = settings;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    this.logger.info('Initializing ManifestManager...');
    
    // Initialize store
    await this.store.initialize();
    
    // Get or create device ID
    let deviceId = await this.store.getDeviceId();
    if (!deviceId) {
      deviceId = this.deviceId;
      await this.store.setDeviceId(deviceId);
    }
    this.deviceId = deviceId;
    
    // Load existing manifest
    this.manifest = await this.store.getManifest();
    
    if (!this.manifest) {
      this.logger.info('No existing manifest, creating new one');
      this.manifest = createEmptyManifest(this.deviceId);
    } else {
      this.logger.info(`Loaded manifest with ${Object.keys(this.manifest.files).length} files`);
      // Migrate if needed
      this.manifest = migrateManifest(this.manifest);
    }
    
    this.initialized = true;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getManifest(): Manifest | null {
    return this.manifest;
  }

  getDeviceId(): string {
    return this.deviceId;
  }

  /**
   * Get file entry from manifest
   */
  getFileEntry(path: string): ManifestFileEntry | undefined {
    if (!this.manifest) return undefined;
    return this.manifest.files[normalizePath(path)];
  }

  /**
   * Check if file exists in manifest
   */
  hasFile(path: string): boolean {
    return !!this.getFileEntry(path);
  }

  /**
   * Update file entry in manifest after local change
   */
  async updateFileEntry(path: string, hash: string, size: number, mtime: number): Promise<void> {
    if (!this.manifest) return;
    
    const normalizedPath = normalizePath(path);
    const existingEntry = this.manifest.files[normalizedPath];
    
    this.manifest.files[normalizedPath] = {
      hash,
      size,
      mtime,
      lastSyncedHash: existingEntry?.lastSyncedHash,
      lastSyncedAt: existingEntry?.lastSyncedAt,
      backendStates: existingEntry?.backendStates,
    };
    
    this.manifest.generatedAt = Date.now();
    this.manifest.metadata = calculateManifestMetadata(this.manifest.files);
    
    await this.store.setFileEntry(normalizedPath, this.manifest.files[normalizedPath]);
  }

  /**
   * Mark file as synced for a specific backend
   */
  async markFileSynced(path: string, backendId: string, hash: string, remoteInfo?: { remotePath?: string; etag?: string; versionId?: string }): Promise<void> {
    if (!this.manifest) return;
    
    const normalizedPath = normalizePath(path);
    const entry = this.manifest.files[normalizedPath];
    if (!entry) return;
    
    entry.lastSyncedHash = hash;
    entry.lastSyncedAt = Date.now();
    
    // Update backend state
    const backendStates = entry.backendStates || [];
    const existingIndex = backendStates.findIndex(s => s.backendId === backendId);
    
    const backendState = {
      backendId,
      hash,
      syncedAt: Date.now(),
      ...remoteInfo,
    };
    
    if (existingIndex >= 0) {
      backendStates[existingIndex] = backendState;
    } else {
      backendStates.push(backendState);
    }
    
    entry.backendStates = backendStates;
    
    await this.store.setFileEntry(normalizedPath, entry);
  }

  /**
   * Remove file from manifest
   */
  async removeFileEntry(path: string): Promise<void> {
    if (!this.manifest) return;
    
    const normalizedPath = normalizePath(path);
    delete this.manifest.files[normalizedPath];
    this.manifest.generatedAt = Date.now();
    this.manifest.metadata = calculateManifestMetadata(this.manifest.files);
    
    await this.store.deleteFileEntry(normalizedPath);
  }

  /**
   * Rename file in manifest
   */
  async renameFileEntry(oldPath: string, newPath: string): Promise<void> {
    if (!this.manifest) return;
    
    const normalizedOldPath = normalizePath(oldPath);
    const normalizedNewPath = normalizePath(newPath);
    
    const entry = this.manifest.files[normalizedOldPath];
    if (!entry) return;
    
    delete this.manifest.files[normalizedOldPath];
    this.manifest.files[normalizedNewPath] = entry;
    this.manifest.generatedAt = Date.now();
    
    await this.store.deleteFileEntry(normalizedOldPath);
    await this.store.setFileEntry(normalizedNewPath, entry);
  }

  /**
   * REAL vault scan for backup: read actual vault files, re-hash only
   * when stat (size/mtime) changed, and return create/modify/delete
   * Changes targeting 's3'. Manifest entries are refreshed along the way
   * so the backup snapshot is truthful.
   */
  async computeVaultChanges(): Promise<Change[]> {
    const changes: Change[] = [];
    const seen = new Set<string>();
    const allFiles = this.vault.getAllLoadedFiles();

    for (const file of allFiles) {
      if (!(file instanceof TFile)) continue;
      const path = normalizePath(file.path);
      if (this.shouldExclude(path)) continue;
      seen.add(path);

      const entry = this.manifest?.files[path];
      const statSame = !!(entry && file.stat.size === entry.size && Math.abs(file.stat.mtime - entry.mtime) < 2000);

      let hash = entry?.hash || '';
      if (!statSame) {
        const data = await this.vault.readBinary(file);
        hash = await this.hashManager.hashData(new Uint8Array(data));
      }
      if (!hash) continue;

      const size = file.stat.size;
      const mtime = file.stat.mtime;

      if (!entry) {
        changes.push(Change.create(path, hash, size, mtime, ['s3']));
      } else if (entry.hash !== hash) {
        changes.push(Change.modify(path, hash, size, mtime, ['s3']));
      }

      // Keep the manifest current so the snapshot reflects the real state
      if (!entry || entry.hash !== hash || entry.size !== size || entry.mtime !== mtime) {
        await this.updateFileEntry(path, hash, size, mtime);
      }
    }

    // Deletions: manifest paths no longer present in the vault
    if (this.manifest) {
      for (const path of Object.keys(this.manifest.files)) {
        if (!seen.has(path)) {
          changes.push(Change.delete(path, ['s3']));
        }
      }
    }

    return changes;
  }

  /**
   * Scan entire vault and rebuild manifest
   */
  async fullScan(): Promise<Manifest> {
    this.logger.info('Starting full vault scan...');
    const startTime = Date.now();
    
    const newFiles: ManifestFileMap = {};
    let scannedCount = 0;
    
    const allFiles = this.vault.getAllLoadedFiles();
    
    for (const file of allFiles) {
      if (!(file instanceof TFile)) continue;
      
      const path = normalizePath(file.path);
      
      // Check exclusions
      if (this.shouldExclude(path)) {
        continue;
      }
      
      try {
        const data = await this.vault.readBinary(file);
        const hash = await this.hashManager.hashData(new Uint8Array(data));
        
        newFiles[path] = {
          hash,
          size: file.stat.size,
          mtime: file.stat.mtime,
        };
        
        scannedCount++;
        
        if (scannedCount % 100 === 0) {
          this.logger.debug(`Scanned ${scannedCount} files...`);
        }
      } catch (error) {
        this.logger.warn(`Failed to hash file: ${path}`, error);
      }
    }
    
    // Create new manifest
    this.manifest = {
      version: 1,
      generatedAt: Date.now(),
      deviceId: this.deviceId,
      files: newFiles,
      metadata: calculateManifestMetadata(newFiles),
    };
    
    // Persist
    await this.store.setManifest(this.manifest);
    
    const duration = Date.now() - startTime;
    this.logger.info(`Full scan completed: ${scannedCount} files in ${duration}ms`);
    
    return this.manifest;
  }

  /**
   * Compare current manifest with remote manifest
   */
  diffManifests(remoteManifest: Manifest): ManifestDiff {
    if (!this.manifest) {
      return {
        created: Object.keys(remoteManifest.files),
        modified: [],
        deleted: [],
        renamed: [],
        unchanged: [],
      };
    }
    
    const localFiles = this.manifest.files;
    const remoteFiles = remoteManifest.files;
    
    const created: string[] = [];
    const modified: string[] = [];
    const deleted: string[] = [];
    const renamed: RenameEntry[] = [];
    const unchanged: string[] = [];
    
    const localPaths = new Set(Object.keys(localFiles));
    const remotePaths = new Set(Object.keys(remoteFiles));
    
    // Find created and modified
    for (const [path, remoteEntry] of Object.entries(remoteFiles)) {
      const localEntry = localFiles[path];
      
      if (!localEntry) {
        created.push(path);
      } else if (localEntry.hash !== remoteEntry.hash) {
        modified.push(path);
      } else {
        unchanged.push(path);
      }
    }
    
    // Find deleted
    for (const path of localPaths) {
      if (!remotePaths.has(path)) {
        deleted.push(path);
      }
    }
    
    // Detect renames (simple hash-based detection)
    if (this.settings?.advanced?.enableRenameDetection) {
      const detectedRenames = this.detectRenames(created, deleted, localFiles, remoteFiles);
      for (const rename of detectedRenames) {
        // Remove from created/deleted
        const createdIdx = created.indexOf(rename.newPath);
        if (createdIdx >= 0) created.splice(createdIdx, 1);
        
        const deletedIdx = deleted.indexOf(rename.oldPath);
        if (deletedIdx >= 0) deleted.splice(deletedIdx, 1);
        
        renamed.push(rename);
      }
    }
    
    return { created, modified, deleted, renamed, unchanged };
  }

  /**
   * Detect renames by matching hashes between created and deleted files
   */
  private detectRenames(
    created: string[],
    deleted: string[],
    localFiles: ManifestFileMap,
    remoteFiles: ManifestFileMap
  ): RenameEntry[] {
    const renames: RenameEntry[] = [];
    const threshold = this.settings?.advanced?.renameDetectionThreshold || 0.95;
    
    for (const newPath of created) {
      const remoteEntry = remoteFiles[newPath];
      if (!remoteEntry) continue;
      
      for (const oldPath of deleted) {
        const localEntry = localFiles[oldPath];
        if (!localEntry) continue;
        
        // Hash match indicates rename
        if (localEntry.hash === remoteEntry.hash) {
          renames.push({ oldPath, newPath, hash: localEntry.hash });
          break;
        }
      }
    }
    
    return renames;
  }

  /**
   * Check if a path should be excluded
   */
  private shouldExclude(path: string): boolean {
    const normalizedPath = normalizePath(path);
    
    // Check exact paths
    if (this.settings.exclusions.paths.some(p => normalizePath(p) === normalizedPath)) {
      return true;
    }
    
    // Check patterns
    if (matchAnyGlob(this.settings.exclusions.patterns, normalizedPath)) {
      return true;
    }
    
    // Check .obsidian exclusions
    if (this.settings.exclusions.excludeObsidianWorkspace && normalizedPath.startsWith('.obsidian/')) {
      const basename = normalizedPath.split('/').pop() || '';
      if (basename === 'workspace.json' || basename === 'workspace-mobile.json') {
        return true;
      }
    }
    
    if (this.settings.exclusions.excludeObsidianPlugins && normalizedPath.startsWith('.obsidian/plugins/')) {
      return true;
    }
    
    if (this.settings.exclusions.excludeObsidianThemes && normalizedPath.startsWith('.obsidian/themes/')) {
      return true;
    }
    
    return false;
  }

  /**
   * Persist manifest to storage
   */
  async persist(): Promise<void> {
    if (!this.manifest || !this.store) return;
    await this.store.setManifest(this.manifest);
  }

  /**
   * Generate a unique device ID
   */
  private generateDeviceId(): string {
    return `device-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get manifest statistics
   */
  getStats(): { fileCount: number; totalSize: number; generatedAt: number } | null {
    if (!this.manifest) return null;
    return {
      fileCount: this.manifest.metadata.totalFiles,
      totalSize: this.manifest.metadata.totalSize,
      generatedAt: this.manifest.generatedAt,
    };
  }
}
