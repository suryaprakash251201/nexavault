/**
 * ChangeDetector - Monitors vault changes with debouncing
 */

import { App, TFile, Vault } from 'obsidian';
import { VaultSyncSettings } from '../models/Settings';
import { ManifestManager } from './ManifestManager';
import { ChangeQueue } from './ChangeQueue';
import { SyncEngine } from './SyncEngine';
import { HashManager } from './HashManager';
import { Logger } from '../utils/logger';
import { Change } from '../models/Change';
import { matchAnyGlob, normalizePath } from '../utils/pathUtils';

interface PendingChange {
  path: string;
  type: 'create' | 'modify' | 'delete' | 'rename';
  oldPath?: string;
  timer: NodeJS.Timeout;
  resolve: () => void;
}

export class ChangeDetector {
  private app: App;
  private vault: Vault;
  private settings: VaultSyncSettings;
  private manifestManager: ManifestManager;
  private changeQueue: ChangeQueue;
  private syncEngine: SyncEngine;
  private hashManager: HashManager;
  private logger: Logger;
  
  private pendingChanges: Map<string, PendingChange> = new Map();
  private isRunning = false;

  constructor(
    app: App,
    settings: VaultSyncSettings,
    manifestManager: ManifestManager,
    changeQueue: ChangeQueue,
    syncEngine: SyncEngine,
    logger: Logger
  ) {
    this.app = app;
    this.vault = app.vault;
    this.settings = settings;
    this.manifestManager = manifestManager;
    this.changeQueue = changeQueue;
    this.syncEngine = syncEngine;
    this.logger = logger;
    this.hashManager = null as any; // Will be set later
  }

  setHashManager(hashManager: HashManager): void {
    this.hashManager = hashManager;
  }

  updateSettings(settings: VaultSyncSettings): void {
    this.settings = settings;
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.logger.info('ChangeDetector started');
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    
    // Flush all pending changes
    for (const [path, pending] of this.pendingChanges.entries()) {
      clearTimeout(pending.timer);
      pending.resolve();
    }
    this.pendingChanges.clear();
    
    this.logger.info('ChangeDetector stopped');
  }

  /**
   * Handle file creation
   */
  async onFileCreate(file: TFile): Promise<void> {
    if (!this.shouldProcess(file.path)) return;
    
    this.debounceChange(file.path, 'create', async () => {
      await this.processCreate(file);
    });
  }

  /**
   * Handle file modification
   */
  async onFileModify(file: TFile): Promise<void> {
    if (!this.shouldProcess(file.path)) return;
    
    this.debounceChange(file.path, 'modify', async () => {
      await this.processModify(file);
    });
  }

  /**
   * Handle file deletion
   */
  async onFileDelete(file: TFile): Promise<void> {
    if (!this.shouldProcess(file.path)) return;
    
    // Deletions are processed immediately (no debounce)
    await this.processDelete(file.path);
  }

  /**
   * Handle file rename
   */
  async onFileRename(file: TFile, oldPath: string): Promise<void> {
    if (!this.shouldProcess(file.path) && !this.shouldProcess(oldPath)) return;
    
    // Renames are processed immediately
    await this.processRename(file, oldPath);
  }

  /**
   * Debounce a change event
   */
  private debounceChange(
    path: string,
    type: 'create' | 'modify' | 'delete' | 'rename',
    handler: () => Promise<void>
  ): void {
    const normalizedPath = normalizePath(path);
    const existing = this.pendingChanges.get(normalizedPath);
    
    if (existing) {
      // Clear existing timer
      clearTimeout(existing.timer);
      
      // If it's the same type, just extend the timer
      if (existing.type === type) {
        existing.timer = setTimeout(() => {
          this.pendingChanges.delete(normalizedPath);
          handler();
        }, this.settings.general.debounceMs);
        return;
      }
      
      // Different type - execute immediately and queue new
      existing.resolve();
    }
    
    // Create new pending change
    const timer = setTimeout(() => {
      this.pendingChanges.delete(normalizedPath);
      handler();
    }, this.settings.general.debounceMs);
    
    this.pendingChanges.set(normalizedPath, {
      path: normalizedPath,
      type,
      timer,
      resolve: () => {},
    });
  }

  /**
   * Process file creation
   */
  private async processCreate(file: TFile): Promise<void> {
    try {
      const path = normalizePath(file.path);
      const data = await this.vault.readBinary(file);
      const hash = await this.hashManager.hashData(new Uint8Array(data));
      
      // Update manifest
      await this.manifestManager.updateFileEntry(path, hash, file.stat.size, file.stat.mtime);
      
      // Determine backend targets
      const backendTargets = this.getBackendTargets();
      
      // Queue change
      const change = Change.create(path, hash, file.stat.size, file.stat.mtime, backendTargets);
      this.changeQueue.enqueue(change);
      
      // Trigger sync
      this.syncEngine.triggerSync('create');
      
      this.logger.debug(`Processed create: ${path}`);
    } catch (error) {
      this.logger.error(`Failed to process create: ${file.path}`, error);
    }
  }

  /**
   * Process file modification
   */
  private async processModify(file: TFile): Promise<void> {
    try {
      const path = normalizePath(file.path);
      const data = await this.vault.readBinary(file);
      const hash = await this.hashManager.hashData(new Uint8Array(data));
      
      // Check if content actually changed
      const manifestEntry = this.manifestManager.getFileEntry(path);
      if (manifestEntry && manifestEntry.hash === hash) {
        this.logger.debug(`File ${path} modified but content unchanged, skipping`);
        return;
      }
      
      // Update manifest
      await this.manifestManager.updateFileEntry(path, hash, file.stat.size, file.stat.mtime);
      
      // Determine backend targets
      const backendTargets = this.getBackendTargets();
      
      // Queue change
      const change = Change.modify(path, hash, file.stat.size, file.stat.mtime, backendTargets);
      this.changeQueue.enqueue(change);
      
      // Trigger sync
      this.syncEngine.triggerSync('modify');
      
      this.logger.debug(`Processed modify: ${path}`);
    } catch (error) {
      this.logger.error(`Failed to process modify: ${file.path}`, error);
    }
  }

  /**
   * Process file deletion
   */
  private async processDelete(path: string): Promise<void> {
    try {
      const normalizedPath = normalizePath(path);
      
      // Check if file was tracked
      const manifestEntry = this.manifestManager.getFileEntry(normalizedPath);
      if (!manifestEntry) {
        this.logger.debug(`Delete for untracked file: ${normalizedPath}`);
        return;
      }
      
      // Determine backend targets
      const backendTargets = this.getBackendTargets();
      
      // Queue change
      const change = Change.delete(normalizedPath, backendTargets);
      this.changeQueue.enqueue(change);
      
      // Remove from manifest
      await this.manifestManager.removeFileEntry(normalizedPath);
      
      // Trigger sync
      this.syncEngine.triggerSync('delete');
      
      this.logger.debug(`Processed delete: ${normalizedPath}`);
    } catch (error) {
      this.logger.error(`Failed to process delete: ${path}`, error);
    }
  }

  /**
   * Process file rename
   */
  private async processRename(file: TFile, oldPath: string): Promise<void> {
    try {
      const newPath = normalizePath(file.path);
      const normalizedOldPath = normalizePath(oldPath);
      
      // Read file to get hash
      const data = await this.vault.readBinary(file);
      const hash = await this.hashManager.hashData(new Uint8Array(data));
      
      // Update manifest
      await this.manifestManager.renameFileEntry(normalizedOldPath, newPath);
      
      // Determine backend targets
      const backendTargets = this.getBackendTargets();
      
      // Queue change as rename
      const change = Change.rename(
        normalizedOldPath,
        newPath,
        hash,
        file.stat.size,
        file.stat.mtime,
        backendTargets
      );
      this.changeQueue.enqueue(change);
      
      // Trigger sync
      this.syncEngine.triggerSync('rename');
      
      this.logger.debug(`Processed rename: ${normalizedOldPath} -> ${newPath}`);
    } catch (error) {
      this.logger.error(`Failed to process rename: ${oldPath} -> ${file.path}`, error);
    }
  }

  /**
   * Check if a file should be processed (not excluded)
   */
  private shouldProcess(path: string): boolean {
    const normalizedPath = normalizePath(path);
    const exclusionSettings = this.settings.exclusions;
    
    // Check exact paths
    if (exclusionSettings.paths.some(p => normalizePath(p) === normalizedPath)) {
      return false;
    }
    
    // Check patterns
    if (matchAnyGlob(exclusionSettings.patterns, normalizedPath)) {
      return false;
    }
    
    // Check .obsidian exclusions
    if (exclusionSettings.excludeObsidianWorkspace && normalizedPath.startsWith('.obsidian/')) {
      const basename = normalizedPath.split('/').pop() || '';
      if (basename === 'workspace.json' || basename === 'workspace-mobile.json') {
        return false;
      }
    }
    
    if (exclusionSettings.excludeObsidianPlugins && normalizedPath.startsWith('.obsidian/plugins/')) {
      return false;
    }
    
    if (exclusionSettings.excludeObsidianThemes && normalizedPath.startsWith('.obsidian/themes/')) {
      return false;
    }
    
    return true;
  }

  /**
   * Get enabled backend targets
   */
  private getBackendTargets(): string[] {
    const targets: string[] = [];
    if (this.settings.github.enabled) targets.push('github');
    if (this.settings.s3.enabled) targets.push('s3');
    return targets;
  }

  /**
   * Check if there are pending changes
   */
  hasPendingChanges(): boolean {
    return this.pendingChanges.size > 0 || this.changeQueue.getStats().pending > 0;
  }

  /**
   * Flush all pending changes immediately
   */
  async flush(): Promise<void> {
    const promises: Promise<void>[] = [];
    
    for (const [path, pending] of this.pendingChanges.entries()) {
      clearTimeout(pending.timer);
      promises.push(new Promise(resolve => {
        pending.resolve = resolve;
      }));
    }
    
    await Promise.all(promises);
    this.pendingChanges.clear();
  }
}
