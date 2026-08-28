/**
 * SyncScheduler - Manages periodic and triggered sync operations
 */

import { VaultSyncSettings, GeneralSettings } from '../models/Settings';
import { SyncEngine } from './SyncEngine';
import { ChangeDetector } from './ChangeDetector';
import { Logger } from '../utils/logger';
import { isOnline, addOnlineListener, addOfflineListener } from '../utils/network';

export class SyncScheduler {
  private settings: GeneralSettings;
  private syncEngine: SyncEngine;
  private changeDetector: ChangeDetector;
  private logger: Logger;
  
  private periodicTimer: NodeJS.Timeout | null = null;
  private githubPushTimer: NodeJS.Timeout | null = null;
  private s3BackupTimer: NodeJS.Timeout | null = null;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  
  private isOnline = true;
  private isPaused = false;
  private cleanupOnlineListener: (() => void) | null = null;
  private cleanupOfflineListener: (() => void) | null = null;

  constructor(
    settings: VaultSyncSettings,
    syncEngine: SyncEngine,
    changeDetector: ChangeDetector,
    logger: Logger
  ) {
    this.settings = settings.general;
    this.syncEngine = syncEngine;
    this.changeDetector = changeDetector;
    this.logger = logger;
  }

  async start(): Promise<void> {
    this.logger.info('Starting SyncScheduler...');
    
    // Check initial network status
    this.isOnline = isOnline();
    
    // Set up network listeners
    this.cleanupOnlineListener = addOnlineListener(() => this.onNetworkReconnect());
    this.cleanupOfflineListener = addOfflineListener(() => this.onNetworkDisconnect());
    
    // Start periodic sync if enabled
    if (this.settings.periodicSyncEnabled) {
      this.startPeriodicSync();
    }
    
    this.logger.info('SyncScheduler started');
  }

  async stop(): Promise<void> {
    this.logger.info('Stopping SyncScheduler...');
    
    this.clearAllTimers();
    
    if (this.cleanupOnlineListener) {
      this.cleanupOnlineListener();
      this.cleanupOnlineListener = null;
    }
    if (this.cleanupOfflineListener) {
      this.cleanupOfflineListener();
      this.cleanupOfflineListener = null;
    }
    
    this.logger.info('SyncScheduler stopped');
  }

  updateSettings(settings: VaultSyncSettings): void {
    this.settings = settings.general;
    
    // Restart periodic sync with new interval
    if (this.settings.periodicSyncEnabled) {
      this.startPeriodicSync();
    } else {
      this.stopPeriodicSync();
    }
  }

  /**
   * Start periodic full sync
   */
  private startPeriodicSync(): void {
    this.stopPeriodicSync();
    
    const intervalMs = this.settings.periodicSyncIntervalMinutes * 60 * 1000;
    this.periodicTimer = setInterval(() => {
      if (!this.isPaused && this.isOnline) {
        this.logger.debug('Periodic sync triggered');
        this.syncEngine.syncNow().catch(err => 
          this.logger.error('Periodic sync failed', err)
        );
      }
    }, intervalMs);
    
    this.logger.debug(`Periodic sync started: every ${this.settings.periodicSyncIntervalMinutes} minutes`);
  }

  private stopPeriodicSync(): void {
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
  }

  /**
   * Trigger sync with debouncing
   */
  triggerSync(source: string = 'change'): void {
    if (this.isPaused) return;
    
    // Clear existing debounce for this source
    const existing = this.debounceTimers.get(source);
    if (existing) {
      clearTimeout(existing);
    }
    
    // Debounce the sync
    const timer = setTimeout(() => {
      this.debounceTimers.delete(source);
      if (!this.isPaused && this.isOnline) {
        this.logger.debug(`Debounced sync triggered by: ${source}`);
        this.syncEngine.syncNow().catch(err => 
          this.logger.error('Debounced sync failed', err)
        );
      }
    }, this.settings.debounceMs);
    
    this.debounceTimers.set(source, timer);
  }

  /**
   * Trigger GitHub push with debouncing
   */
  triggerGitHubPush(): void {
    if (this.githubPushTimer) {
      clearTimeout(this.githubPushTimer);
    }
    
    // Use GitHub-specific push interval
    const githubSettings = (this.syncEngine as any).settings?.github;
    const intervalMs = (githubSettings?.pushIntervalMinutes || 10) * 60 * 1000;
    
    this.githubPushTimer = setTimeout(() => {
      this.githubPushTimer = null;
      if (!this.isPaused && this.isOnline) {
        this.logger.debug('GitHub push triggered');
        this.syncEngine.pushChanges().catch(err => 
          this.logger.error('GitHub push failed', err)
        );
      }
    }, intervalMs);
  }

  /**
   * Trigger S3 backup
   */
  triggerS3Backup(): void {
    if (this.s3BackupTimer) {
      clearTimeout(this.s3BackupTimer);
    }
    
    const s3Settings = (this.syncEngine as any).settings?.s3;
    const intervalMs = (s3Settings?.backupIntervalHours || 24) * 60 * 60 * 1000;
    
    this.s3BackupTimer = setTimeout(() => {
      this.s3BackupTimer = null;
      if (!this.isPaused && this.isOnline) {
        this.logger.debug('S3 backup triggered');
        this.syncEngine.backupNow().catch(err => 
          this.logger.error('S3 backup failed', err)
        );
      }
    }, intervalMs);
  }

  /**
   * Called when network comes back online
   */
  onNetworkReconnect(): void {
    this.logger.info('Network reconnected');
    this.isOnline = true;
    
    if (this.settings.syncOnNetworkReconnect && !this.isPaused) {
      // Small delay to let network stabilize
      setTimeout(() => {
        this.syncEngine.syncNow().catch(err => 
          this.logger.error('Reconnect sync failed', err)
        );
      }, 2000);
    }
  }

  /**
   * Called when network goes offline
   */
  onNetworkDisconnect(): void {
    this.logger.info('Network disconnected');
    this.isOnline = false;
  }

  /**
   * Pause all sync operations
   */
  pause(): void {
    this.isPaused = true;
    this.logger.info('SyncScheduler paused');
  }

  /**
   * Resume sync operations
   */
  resume(): void {
    this.isPaused = false;
    this.logger.info('SyncScheduler resumed');
    
    // Trigger immediate sync if there are pending changes
    if (this.changeDetector.hasPendingChanges()) {
      this.triggerSync('resume');
    }
  }

  /**
   * Check if scheduler is paused
   */
  isPausedState(): boolean {
    return this.isPaused;
  }

  /**
   * Check if online
   */
  isOnlineState(): boolean {
    return this.isOnline;
  }

  /**
   * Force immediate sync (bypass debounce)
   */
  async forceSync(): Promise<void> {
    this.clearDebounceTimers();
    await this.syncEngine.syncNow();
  }

  private clearDebounceTimers(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  private clearAllTimers(): void {
    this.clearDebounceTimers();
    this.stopPeriodicSync();
    
    if (this.githubPushTimer) {
      clearTimeout(this.githubPushTimer);
      this.githubPushTimer = null;
    }
    if (this.s3BackupTimer) {
      clearTimeout(this.s3BackupTimer);
      this.s3BackupTimer = null;
    }
  }
}
