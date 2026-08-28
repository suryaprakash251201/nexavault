/**
 * SyncEngine - Core synchronization orchestration
 */

import { App, Vault, TFile } from 'obsidian';
import { VaultSyncSettings } from '../models/Settings';
import { ManifestManager } from './ManifestManager';
import { ChangeQueue } from './ChangeQueue';
import { RetryManager } from './RetryManager';
import { ConflictResolver } from './ConflictResolver';
import { SyncBackend } from '../backends/SyncBackend';
import { GitHubBackend } from '../backends/GitHubBackend';
import { S3Backend, BackupInfo, BackupSnapshot } from '../backends/S3Backend';
import { Logger } from '../utils/logger';
import { Change, ChangeSet } from '../models/Change';
import { Conflict, ConflictDetectionResult } from '../models/Conflict';
import { SyncResult, SyncError, RemoteChange, PullResult, PushResult } from '../models/SyncResult';
import { SyncStatus } from '../models/SyncStatus';
import { FileState } from '../models/FileState';
import { normalizePath } from '../utils/pathUtils';

export class SyncEngine {
  private app: App;
  private vault: Vault;
  private settings: VaultSyncSettings;
  private manifestManager: ManifestManager;
  private changeQueue: ChangeQueue;
  private retryManager: RetryManager;
  private conflictResolver: ConflictResolver;
  private githubBackend: GitHubBackend;
  private s3Backend: S3Backend;
  private logger: Logger;
  
  private status: SyncStatus = SyncStatus.IDLE;
  private statusListeners: Set<(status: SyncStatus) => void> = new Set();
  private isSyncing = false;
  private isPaused = false;

  constructor(
    app: App,
    settings: VaultSyncSettings,
    manifestManager: ManifestManager,
    changeQueue: ChangeQueue,
    retryManager: RetryManager,
    conflictResolver: ConflictResolver,
    githubBackend: GitHubBackend,
    s3Backend: S3Backend,
    logger: Logger
  ) {
    this.app = app;
    this.vault = app.vault;
    this.settings = settings;
    this.manifestManager = manifestManager;
    this.changeQueue = changeQueue;
    this.retryManager = retryManager;
    this.conflictResolver = conflictResolver;
    this.githubBackend = githubBackend;
    this.s3Backend = s3Backend;
    this.logger = logger;

    // Inject vault readers so backends can read file contents directly
    const vaultReader = async (path: string): Promise<Uint8Array> => {
      const file = this.vault.getAbstractFileByPath(normalizePath(path));
      if (file instanceof TFile) {
        return new Uint8Array(await this.vault.readBinary(file));
      }
      throw new Error(`File not found in vault: ${path}`);
    };
    this.githubBackend.setFileReader(vaultReader);
    this.s3Backend.setFileReader(vaultReader);
  }

  updateSettings(settings: VaultSyncSettings): void {
    this.settings = settings;
  }

  /**
   * Subscribe to status changes
   */
  onStatusChange(listener: (status: SyncStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private setStatus(status: SyncStatus): void {
    this.status = status;
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  /**
   * Trigger a sync (called by ChangeDetector)
   */
  triggerSync(source: string): void {
    if (this.isPaused || this.isSyncing) return;
    this.syncNow().catch(err => this.logger.error(`Sync triggered by ${source} failed`, err));
  }

  /**
   * Perform full synchronization
   */
  async syncNow(): Promise<SyncResult> {
    if (this.isSyncing) {
      this.logger.warn('Sync already in progress, skipping');
      return this.createEmptyResult(false, 'Sync already in progress');
    }
    
    if (this.isPaused) {
      return this.createEmptyResult(false, 'Sync is paused');
    }
    
    const startTime = Date.now();
    this.isSyncing = true;
    this.setStatus(SyncStatus.SYNCING);
    
    this.logger.info('Starting sync...');
    
    try {
      // Connect to backends
      await this.connectBackends();
      
      // Get remote manifests
      const remoteManifests = await this.fetchRemoteManifests();
      
      // Detect conflicts
      const localFiles = this.buildLocalFileMap();
      const conflictResult = await this.conflictResolver.detectConflicts(
        localFiles,
        this.buildRemoteFileMap(remoteManifests)
      );
      
      if (conflictResult.hasConflicts) {
        this.setStatus(SyncStatus.CONFLICT);
        this.logger.warn(`Conflicts detected: ${conflictResult.conflicts.length}`);
      }
      
      // Process safe changes
      let result: SyncResult;
      if (this.settings.github.enabled || this.settings.s3.enabled) {
        result = await this.processSync(conflictResult, remoteManifests);
      } else {
        result = this.createEmptyResult(true, 'No backends enabled');
      }
      
      result.duration = Date.now() - startTime;
      
      if (result.success) {
        this.setStatus(SyncStatus.IDLE);
        this.logger.info(`Sync completed in ${result.duration}ms: ${result.changesProcessed} changes`);
      } else {
        this.setStatus(SyncStatus.ERROR);
        this.logger.error('Sync completed with errors', { errors: result.errors });
      }
      
      return result;
    } catch (error) {
      this.logger.error('Sync failed', error);
      this.setStatus(SyncStatus.ERROR);
      return this.createEmptyResult(false, error instanceof Error ? error.message : 'Unknown error');
    } finally {
      this.isSyncing = false;
      await this.disconnectBackends();
    }
  }

  /**
   * Pull changes from remotes
   */
  async pullChanges(): Promise<PullResult> {
    this.logger.info('Pulling changes...');
    this.setStatus(SyncStatus.SYNCING);
    
    try {
      await this.connectBackends();
      
      const remoteManifests = await this.fetchRemoteManifests();
      const localFiles = this.buildLocalFileMap();
      const conflictResult = await this.conflictResolver.detectConflicts(
        localFiles,
        this.buildRemoteFileMap(remoteManifests)
      );
      
      const allChanges: RemoteChange[] = [];
      const allConflicts: Conflict[] = [];
      const allErrors: SyncError[] = [];
      
      // Process each backend
      for (const [backendId, manifest] of Object.entries(remoteManifests)) {
        const backend = this.getBackend(backendId);
        if (!backend) continue;
        
        try {
          const changes = await this.fetchChangesFromBackend(backend, manifest, localFiles);
          allChanges.push(...changes);
        } catch (error) {
          allErrors.push({
            backendId,
            error: error instanceof Error ? error.message : 'Unknown error',
            retryable: true,
            timestamp: Date.now(),
          });
        }
      }
      
      // Apply non-conflicting changes
      for (const change of allChanges) {
        if (!conflictResult.conflicts.some(c => c.path === change.path)) {
          await this.applyRemoteChange(change);
        } else {
          allConflicts.push(...conflictResult.conflicts.filter(c => c.path === change.path));
        }
      }
      
      this.setStatus(allConflicts.length > 0 ? SyncStatus.CONFLICT : SyncStatus.IDLE);
      
      return {
        success: allErrors.length === 0,
        changes: allChanges,
        conflicts: allConflicts,
        errors: allErrors,
      };
    } catch (error) {
      this.logger.error('Pull failed', error);
      this.setStatus(SyncStatus.ERROR);
      throw error;
    } finally {
      await this.disconnectBackends();
    }
  }

  /**
   * Push changes to remotes
   */
  async pushChanges(): Promise<PushResult> {
    this.logger.info('Pushing changes...');
    this.setStatus(SyncStatus.SYNCING);
    
    try {
      await this.connectBackends();
      
      const pendingChanges = this.changeQueue.getPending();
      const allPushed: Change[] = [];
      const allConflicts: Conflict[] = [];
      const allErrors: SyncError[] = [];
      
      // Group changes by backend
      const changesByBackend = this.groupChangesByBackend(pendingChanges);
      
      for (const [backendId, changes] of Object.entries(changesByBackend)) {
        const backend = this.getBackend(backendId);
        if (!backend) continue;
        
        try {
          const result = await this.pushChangesToBackend(backend, changes);
          allPushed.push(...result.pushed);
          allConflicts.push(...result.conflicts);
          allErrors.push(...result.errors);
        } catch (error) {
          allErrors.push({
            backendId,
            error: error instanceof Error ? error.message : 'Unknown error',
            retryable: true,
            timestamp: Date.now(),
          });
        }
      }
      
      this.setStatus(allConflicts.length > 0 ? SyncStatus.CONFLICT : SyncStatus.IDLE);
      
      return {
        success: allErrors.length === 0,
        changesPushed: allPushed,
        conflicts: allConflicts,
        errors: allErrors,
      };
    } catch (error) {
      this.logger.error('Push failed', error);
      this.setStatus(SyncStatus.ERROR);
      throw error;
    } finally {
      await this.disconnectBackends();
    }
  }

  /**
   * Perform a full S3 backup: sync changed files, create a verified
   * backup snapshot, then prune old backups per retention policy.
   */
  async backupNow(): Promise<SyncResult> {
    if (!this.settings.s3.enabled) {
      return this.createEmptyResult(false, 'S3 backup not enabled');
    }
    
    this.logger.info('Starting S3 backup...');
    this.setStatus(SyncStatus.SYNCING);
    const startTime = Date.now();
    
    try {
      await this.s3Backend.connect();
      
      // Step 1: upload changed files (incremental)
      const localFiles = this.buildLocalFileMap();
      const changes = this.computeBackupChanges(localFiles);
      const result = await this.pushChangesToBackend(this.s3Backend, changes);
      
      // Step 2: create the snapshot manifest (only if sync step succeeded)
      let backup: BackupInfo | null = null;
      if (result.errors.length === 0) {
        const manifest = this.manifestManager.getManifest();
        if (manifest) {
          backup = await this.s3Backend.createBackup(manifest);
        }
      }
      
      // Step 3: prune old backups (fail-safe: runs only after new backup verified)
      const pruned = backup ? await this.s3Backend.pruneBackups(this.settings.s3.retention) : 0;
      if (pruned > 0) {
        this.logger.info(`Retention: pruned ${pruned} old backup(s)`);
      }
      
      return {
        success: result.errors.length === 0 && !!backup,
        timestamp: Date.now(),
        duration: Date.now() - startTime,
        changesProcessed: result.pushed.length,
        filesUploaded: result.pushed.filter(c => c.type !== 'delete').length,
        filesDownloaded: 0,
        filesDeleted: result.pushed.filter(c => c.type === 'delete').length,
        conflictsDetected: result.conflicts.length,
        errors: result.errors,
        backendResults: [{
          backendId: 's3',
          success: result.errors.length === 0,
          changesProcessed: result.pushed.length,
          filesUploaded: result.pushed.filter(c => c.type !== 'delete').length,
          filesDownloaded: 0,
          filesDeleted: result.pushed.filter(c => c.type === 'delete').length,
          errors: result.errors,
          backupId: backup?.id || `backup-${Date.now()}`,
        }],
      };
    } catch (error) {
      this.logger.error('Backup failed', error);
      throw error;
    } finally {
      await this.s3Backend.disconnect();
      this.setStatus(SyncStatus.IDLE);
    }
  }

  /**
   * List all available backups from S3
   */
  async listBackups(): Promise<BackupInfo[]> {
    if (!this.settings.s3.enabled) return [];
    try {
      await this.s3Backend.connect();
      const backups = await this.s3Backend.listBackups();
      // Enrich with file counts (lazy: only for the first N to limit requests)
      for (let i = 0; i < Math.min(backups.length, 20); i++) {
        const snap = await this.s3Backend.getBackupManifest(backups[i].id);
        if (snap) backups[i].fileCount = Object.keys(snap.files).length;
      }
      return backups;
    } catch (error) {
      this.logger.error('Failed to list backups', error);
      return [];
    } finally {
      await this.s3Backend.disconnect();
    }
  }

  /**
   * Preview what a restore would change (no writes).
   */
  async previewRestore(backupId: string): Promise<{
    backup: BackupInfo | null;
    files: string[];
    newFiles: string[];
    modifiedFiles: string[];
    missingFiles: string[]; // in backup but not on remote vault path
    totalSize: number;
  }> {
    await this.s3Backend.connect();
    try {
      const snap = await this.s3Backend.getBackupManifest(backupId);
      if (!snap) return { backup: null, files: [], newFiles: [], modifiedFiles: [], missingFiles: [], totalSize: 0 };

      const backups = await this.s3Backend.listBackups();
      const backup = backups.find(b => b.id === backupId) || null;
      const manifest = this.manifestManager.getManifest();
      const files = Object.keys(snap.files);
      let totalSize = 0;
      const newFiles: string[] = [];
      const modifiedFiles: string[] = [];

      for (const path of files) {
        const entry = snap.files[path];
        totalSize += entry.size || 0;
        const current = manifest?.files[path];
        if (!current) newFiles.push(path);
        else if (current.hash !== entry.hash) modifiedFiles.push(path);
      }

      return { backup, files, newFiles, modifiedFiles, missingFiles: [], totalSize };
    } finally {
      await this.s3Backend.disconnect();
    }
  }

  /**
   * Restore a backup. Writes downloaded files into the vault.
   * Applies only files that exist in the backup snapshot.
   */
  async restoreBackup(backupId: string, onProgress?: (done: number, total: number, path: string) => void): Promise<{ restored: number; errors: string[] }> {
    await this.s3Backend.connect();
    const restored: string[] = [];
    const errors: string[] = [];

    try {
      const snap = await this.s3Backend.getBackupManifest(backupId);
      if (!snap) throw new Error(`Backup not found: ${backupId}`);

      const paths = Object.keys(snap.files);
      let done = 0;
      for (const path of paths) {
        try {
          const data = await this.s3Backend.downloadFile(path);
          await this.vault.adapter.writeBinary(path, data);
          restored.push(path);
        } catch (error) {
          errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
        }
        done++;
        if (onProgress) onProgress(done, paths.length, path);
      }

      if (errors.length === 0) {
        this.logger.info(`Restore complete: ${restored.length} files from ${backupId}`);
      } else {
        this.logger.error(`Restore finished with ${errors.length} error(s)`, errors);
      }
      return { restored: restored.length, errors };
    } finally {
      await this.s3Backend.disconnect();
    }
  }

  /**
   * Process sync with conflict handling
   */
  private async processSync(
    conflictResult: ConflictDetectionResult,
    remoteManifests: Record<string, any>
  ): Promise<SyncResult> {
    const allErrors: SyncError[] = [];
    const backendResults: SyncResult['backendResults'] = [];
    let totalChanges = 0;
    let totalUploaded = 0;
    let totalDownloaded = 0;
    let totalDeleted = 0;
    
    // Process each backend
    for (const backendId of ['github', 's3']) {
      const backend = this.getBackend(backendId);
      if (!backend || !this.isBackendEnabled(backendId)) continue;
      
      try {
        const remoteManifest = remoteManifests[backendId];
        const localFiles = this.buildLocalFileMap();
        
        // Get changes to push
        let pushChanges = this.changeQueue.getByBackend(backendId);

        // First-sync bootstrap: if the remote is empty and nothing is
        // queued, seed the queue with all local files (one-time).
        const remoteFileCount = remoteManifest?.files ? Object.keys(remoteManifest.files).length : 0;
        if (pushChanges.length === 0 && remoteFileCount === 0 && localFiles.size > 0) {
          pushChanges = Array.from(localFiles.entries()).map(([path, state]) =>
            Change.create(path, state.hash, state.size, state.mtime, [backendId])
          );
          this.logger.info(`Bootstrap: scheduling ${pushChanges.length} local files for first ${backendId} push`);
          this.changeQueue.enqueueBatch(pushChanges);
        }

        // Push changes
        const pushResult = await this.pushChangesToBackend(backend, pushChanges);
        
        // Pull changes
        const pullResult = await this.pullChangesFromBackend(backend, remoteManifest, localFiles);
        
        // Update manifest with synced files
        for (const change of [...pushResult.pushed, ...pullResult.applied]) {
          await this.manifestManager.markFileSynced(
            change.path,
            backendId,
            change.hash || '',
            { remotePath: change.path }
          );
        }
        
        totalChanges += pushResult.pushed.length + pullResult.applied.length;
        totalUploaded += pushResult.pushed.filter(c => c.type !== 'delete').length;
        totalDownloaded += pullResult.applied.filter(c => c.type !== 'delete').length;
        totalDeleted += pushResult.pushed.filter(c => c.type === 'delete').length;
        totalDeleted += pullResult.applied.filter(c => c.type === 'delete').length;
        
        backendResults.push({
          backendId,
          success: pushResult.errors.length === 0 && pullResult.errors.length === 0,
          changesProcessed: pushResult.pushed.length + pullResult.applied.length,
          filesUploaded: pushResult.pushed.filter(c => c.type !== 'delete').length,
          filesDownloaded: pullResult.applied.filter(c => c.type !== 'delete').length,
          filesDeleted: pushResult.pushed.filter(c => c.type === 'delete').length + 
                        pullResult.applied.filter(c => c.type === 'delete').length,
          errors: [...pushResult.errors, ...pullResult.errors],
        });
        
        allErrors.push(...pushResult.errors, ...pullResult.errors);
      } catch (error) {
        allErrors.push({
          backendId,
          error: error instanceof Error ? error.message : 'Unknown error',
          retryable: true,
          timestamp: Date.now(),
        });
        
        backendResults.push({
          backendId,
          success: false,
          changesProcessed: 0,
          filesUploaded: 0,
          filesDownloaded: 0,
          filesDeleted: 0,
          errors: [{
            backendId,
            error: error instanceof Error ? error.message : 'Unknown error',
            retryable: true,
            timestamp: Date.now(),
          }],
        });
      }
    }
    
    return {
      success: allErrors.length === 0,
      timestamp: Date.now(),
      duration: 0,
      changesProcessed: totalChanges,
      filesUploaded: totalUploaded,
      filesDownloaded: totalDownloaded,
      filesDeleted: totalDeleted,
      conflictsDetected: conflictResult.conflicts.length,
      errors: allErrors,
      backendResults,
    };
  }

  /**
   * Push changes to a specific backend
   */
  private async pushChangesToBackend(
    backend: SyncBackend,
    changes: Change[]
  ): Promise<{ pushed: Change[]; conflicts: Conflict[]; errors: SyncError[] }> {
    const pushed: Change[] = [];
    const conflicts: Conflict[] = [];
    const errors: SyncError[] = [];
    
    // Batch changes for efficiency
    const batches = this.batchChanges(changes, 50);
    
    for (const batch of batches) {
      try {
        await backend.pushChanges(batch);
        
        for (const change of batch) {
          this.changeQueue.complete(change.id);
          pushed.push(change);
        }
      } catch (error) {
        for (const change of batch) {
          const decision = this.retryManager.shouldRetry(change, error);
          
          if (decision.shouldRetry) {
            this.changeQueue.fail(change.id, error instanceof Error ? error.message : 'Unknown error');
            errors.push({
              changeId: change.id,
              path: change.path,
              backendId: backend.getId(),
              error: error instanceof Error ? error.message : 'Unknown error',
              retryable: true,
              timestamp: Date.now(),
            });
          } else {
            this.changeQueue.failPermanently(change.id, error instanceof Error ? error.message : 'Unknown error');
            errors.push({
              changeId: change.id,
              path: change.path,
              backendId: backend.getId(),
              error: error instanceof Error ? error.message : 'Unknown error',
              retryable: false,
              timestamp: Date.now(),
            });
          }
        }
      }
    }
    
    return { pushed, conflicts, errors };
  }

  /**
   * Pull changes from a specific backend (diff based)
   */
  private async pullChangesFromBackend(
    backend: SyncBackend,
    remoteManifest: any,
    localFiles: Map<string, FileState>
  ): Promise<{ applied: Change[]; errors: SyncError[] }> {
    const applied: Change[] = [];
    const errors: SyncError[] = [];

    try {
      const remoteChanges = await this.fetchChangesFromBackend(backend, remoteManifest, localFiles);

      for (const remoteChange of remoteChanges) {
        const localState = localFiles.get(normalizePath(remoteChange.path));

        // Skip paths already flagged as conflicts
        if (localState && localState.hash !== remoteChange.hash) {
          continue;
        }

        // Apply change
        try {
          await this.applyRemoteChange(remoteChange);
          if (remoteChange.type === 'delete') {
            applied.push(Change.delete(remoteChange.path));
          } else {
            applied.push(Change.modify(
              remoteChange.path,
              remoteChange.hash,
              remoteChange.size,
              remoteChange.mtime
            ));
          }
        } catch (error) {
          errors.push({
            path: remoteChange.path,
            backendId: backend.getId(),
            error: error instanceof Error ? error.message : 'Unknown error',
            retryable: true,
            timestamp: Date.now(),
          });
        }
      }
    } catch (error) {
      errors.push({
        backendId: backend.getId(),
        error: error instanceof Error ? error.message : 'Unknown error',
        retryable: true,
        timestamp: Date.now(),
      });
    }

    return { applied, errors };
  }

  /**
   * Apply a remote change to local vault
   */
  private async applyRemoteChange(change: RemoteChange): Promise<void> {
    const path = normalizePath(change.path);
    
    switch (change.type) {
      case 'create':
      case 'modify': {
        const data = await this.getBackendForChange(change).downloadFile(change.remotePath || path);
        await this.vault.adapter.writeBinary(path, data);
        break;
      }
      case 'delete': {
        const file = this.vault.getAbstractFileByPath(path);
        if (file) {
          await this.vault.delete(file);
        }
        break;
      }
      case 'rename': {
        if (change.oldPath) {
          const file = this.vault.getAbstractFileByPath(change.oldPath);
          if (file instanceof TFile) {
            await this.vault.rename(file, path);
          }
        }
        break;
      }
    }
  }

  /**
   * Diff remote manifest against local manifest to compute changes
   * that need to be pulled. Conservative about deletions.
   */
  private async fetchChangesFromBackend(
    backend: SyncBackend,
    remoteManifest: any,
    localFiles: Map<string, FileState>
  ): Promise<RemoteChange[]> {
    if (!remoteManifest?.files) return [];

    const changes: RemoteChange[] = [];
    const localManifest = this.manifestManager.getManifest();
    const remoteFiles = remoteManifest.files as Record<string, { hash: string; size: number; mtime: number }>;
    const remotePaths = new Set(Object.keys(remoteFiles));
    const localPaths = new Set(localFiles.keys());

    // New / modified remote files
    for (const [path, remoteEntry] of Object.entries(remoteFiles)) {
      const localState = localFiles.get(normalizePath(path));
      if (!localState) {
        changes.push({
          path, hash: remoteEntry.hash, size: remoteEntry.size, mtime: remoteEntry.mtime,
          type: 'create', backendId: backend.getId(),
        });
      } else if (localState.hash !== remoteEntry.hash) {
        changes.push({
          path, hash: remoteEntry.hash, size: remoteEntry.size, mtime: remoteEntry.mtime,
          type: 'modify', backendId: backend.getId(),
        });
      }
    }

    // Conservative deletions: only when the local file is unchanged since the
    // last successful sync (lastSyncedHash === hash). Otherwise the local
    // modification wins / becomes a conflict - never silently delete.
    const deletions: RemoteChange[] = [];
    for (const path of localPaths) {
      if (!remotePaths.has(path)) {
        const localState = localFiles.get(path);
        const manifestEntry = localManifest?.files[path];
        if (
          localState && manifestEntry &&
          manifestEntry.lastSyncedHash &&
          manifestEntry.lastSyncedHash === localState.hash
        ) {
          deletions.push({
            path, hash: localState.hash, size: localState.size, mtime: localState.mtime,
            type: 'delete', backendId: backend.getId(),
          });
        }
      }
    }

    // Delete-safety: if a large number of files would be deleted at once,
    // do not auto-apply - surface for review instead.
    const threshold = this.settings.advanced.deleteSafetyThreshold;
    if (deletions.length > 0 && deletions.length <= threshold) {
      changes.push(...deletions);
    } else if (deletions.length > threshold) {
      this.logger.warn(`Detected ${deletions.length} deletions (> threshold ${threshold}) - skipping auto-apply for safety`);
      this.setStatus(SyncStatus.CONFLICT);
    }

    return changes;
  }

  /**
   * Compute changes needed for backup
   */
  private computeBackupChanges(localFiles: Map<string, FileState>): Change[] {
    const changes: Change[] = [];
    
    for (const [path, state] of localFiles.entries()) {
      const manifestEntry = this.manifestManager.getFileEntry(path);
      
      if (!manifestEntry || manifestEntry.hash !== state.hash) {
        // File is new or modified
        changes.push(Change.modify(path, state.hash, state.size, state.mtime, ['s3']));
      }
    }
    
    // Check for deleted files
    const manifest = this.manifestManager.getManifest();
    if (manifest) {
      for (const path of Object.keys(manifest.files)) {
        if (!localFiles.has(path)) {
          changes.push(Change.delete(path, ['s3']));
        }
      }
    }
    
    return changes;
  }

  /**
   * Get backend by ID
   */
  private getBackend(id: string): SyncBackend | null {
    if (id === 'github') return this.githubBackend;
    if (id === 's3') return this.s3Backend;
    return null;
  }

  /**
   * Check if backend is enabled
   */
  private isBackendEnabled(id: string): boolean {
    if (id === 'github') return this.settings.github.enabled;
    if (id === 's3') return this.settings.s3.enabled;
    return false;
  }

  /**
   * Get backend for a remote change (based on backendId)
   */
  private getBackendForChange(change: RemoteChange): SyncBackend {
    return this.getBackend(change.backendId) || this.s3Backend;
  }

  /**
   * Connect to all enabled backends
   */
  private async connectBackends(): Promise<void> {
    const promises: Promise<void>[] = [];
    
    if (this.settings.github.enabled) {
      promises.push(this.githubBackend.connect());
    }
    if (this.settings.s3.enabled) {
      promises.push(this.s3Backend.connect());
    }
    
    await Promise.all(promises);
  }

  /**
   * Disconnect from all backends
   */
  private async disconnectBackends(): Promise<void> {
    const promises: Promise<void>[] = [];
    
    if (this.settings.github.enabled) {
      promises.push(this.githubBackend.disconnect());
    }
    if (this.settings.s3.enabled) {
      promises.push(this.s3Backend.disconnect());
    }
    
    await Promise.all(promises);
  }

  /**
   * Fetch remote manifests from all backends
   */
  private async fetchRemoteManifests(): Promise<Record<string, any>> {
    const manifests: Record<string, any> = {};
    
    if (this.settings.github.enabled) {
      try {
        manifests.github = await this.githubBackend.getRemoteManifest();
      } catch (error) {
        this.logger.warn('Failed to fetch GitHub manifest', error);
      }
    }
    
    if (this.settings.s3.enabled) {
      try {
        manifests.s3 = await this.s3Backend.getRemoteManifest();
      } catch (error) {
        this.logger.warn('Failed to fetch S3 manifest', error);
      }
    }
    
    return manifests;
  }

  /**
   * Build local file map from manifest
   */
  private buildLocalFileMap(): Map<string, FileState> {
    const map = new Map<string, FileState>();
    const manifest = this.manifestManager.getManifest();
    
    if (!manifest) return map;
    
    for (const [path, entry] of Object.entries(manifest.files)) {
      map.set(path, {
        path,
        hash: entry.hash,
        size: entry.size,
        mtime: entry.mtime,
        lastSyncedHash: entry.lastSyncedHash || null,
        lastSyncedAt: entry.lastSyncedAt || null,
        backendStates: entry.backendStates || [],
      });
    }
    
    return map;
  }

  /**
   * Build remote file map from manifests
   */
  private buildRemoteFileMap(manifests: Record<string, any>): Map<string, FileState> {
    const map = new Map<string, FileState>();
    
    for (const [backendId, manifest] of Object.entries(manifests)) {
      if (!manifest?.files) continue;
      
      for (const [path, entry] of Object.entries(manifest.files)) {
        const existing = map.get(path);
        const remoteEntry = entry as any;
        
        if (!existing || remoteEntry.mtime > existing.mtime) {
          map.set(path, {
            path,
            hash: remoteEntry.hash,
            size: remoteEntry.size,
            mtime: remoteEntry.mtime,
            lastSyncedHash: null,
            lastSyncedAt: null,
            backendStates: [{
              backendId,
              hash: remoteEntry.hash,
              syncedAt: remoteEntry.mtime,
            }],
          });
        }
      }
    }
    
    return map;
  }

  /**
   * Batch changes for efficient processing
   */
  private batchChanges(changes: Change[], batchSize: number): Change[][] {
    const batches: Change[][] = [];
    for (let i = 0; i < changes.length; i += batchSize) {
      batches.push(changes.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Group changes by backend target
   */
  private groupChangesByBackend(changes: Change[]): Record<string, Change[]> {
    const grouped: Record<string, Change[]> = {};
    
    for (const change of changes) {
      for (const backendId of change.backendTargets) {
        if (!grouped[backendId]) grouped[backendId] = [];
        grouped[backendId].push(change);
      }
    }
    
    return grouped;
  }

  /**
   * Create empty sync result
   */
  private createEmptyResult(success: boolean, error?: string): SyncResult {
    return {
      success,
      timestamp: Date.now(),
      duration: 0,
      changesProcessed: 0,
      filesUploaded: 0,
      filesDownloaded: 0,
      filesDeleted: 0,
      conflictsDetected: 0,
      errors: error ? [{
        backendId: 'local',
        error,
        retryable: false,
        timestamp: Date.now(),
      }] : [],
      backendResults: [],
    };
  }

  /**
   * Pause sync engine
   */
  pause(): void {
    this.isPaused = true;
    this.setStatus(SyncStatus.PAUSED);
    this.logger.info('SyncEngine paused');
  }

  /**
   * Resume sync engine
   */
  resume(): void {
    this.isPaused = false;
    this.setStatus(SyncStatus.IDLE);
    this.logger.info('SyncEngine resumed');
  }

  /**
   * Shutdown sync engine
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down SyncEngine...');
    this.isPaused = true;
    
    // Wait for any ongoing sync
    while (this.isSyncing) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    await this.disconnectBackends();
    this.logger.info('SyncEngine shutdown complete');
  }
}
