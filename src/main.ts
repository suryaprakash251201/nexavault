import { Plugin, Notice, TFile, TAbstractFile } from 'obsidian';

// Import core modules
import { SyncEngine } from './core/SyncEngine';
import { ChangeDetector } from './core/ChangeDetector';
import { SyncScheduler } from './core/SyncScheduler';
import { ManifestManager } from './core/ManifestManager';
import { HashManager } from './core/HashManager';
import { ChangeQueue } from './core/ChangeQueue';
import { RetryManager } from './core/RetryManager';
import { ConflictResolver } from './core/ConflictResolver';

// Import backends
import { GitHubBackend } from './backends/GitHubBackend';
import { S3Backend } from './backends/S3Backend';

// Import models
import { VaultSyncSettings, DEFAULT_SETTINGS } from './models/Settings';
import { SyncStatus } from './models/SyncStatus';

// Import UI
import { SyncStatusView } from './ui/SyncStatusView';
import { SyncDashboardView } from './ui/SyncDashboardView';
import { ConflictView } from './ui/ConflictView';
import { BackupView } from './ui/BackupView';
import { RestoreView } from './ui/RestoreView';
import { VaultSyncSettingTab } from './ui/SettingsTab';

// Import utilities
import { Logger } from './utils/logger';
import { SecureCredentialStore } from './crypto/SecureCredentialStore';

/**
 * Nexavault Plugin - Main entry point
 * Provides GitHub live sync, S3-compatible backup, incremental synchronization,
 * conflict detection and resolution, offline queue, and client-side encryption.
 */
export default class NexavaultPlugin extends Plugin {
  declare settings: VaultSyncSettings;
  
  // Core services
  syncEngine: SyncEngine | null = null;
  changeDetector: ChangeDetector | null = null;
  syncScheduler: SyncScheduler | null = null;
  manifestManager: ManifestManager | null = null;
  hashManager: HashManager | null = null;
  changeQueue: ChangeQueue | null = null;
  retryManager: RetryManager | null = null;
  conflictResolver: ConflictResolver | null = null;
  
  // Backends
  githubBackend: GitHubBackend | null = null;
  s3Backend: S3Backend | null = null;
  
  // UI
  dashboardView: SyncDashboardView | null = null;
  conflictView: ConflictView | null = null;
  backupView: BackupView | null = null;
  restoreView: RestoreView | null = null;
  
  // Credential store
  credentialStore: SecureCredentialStore | null = null;
  
  // Pending restore selection (set by openRestore, consumed by view)
  private pendingRestoreId: string | null = null;
  
  // Logger
  logger!: Logger;

  async onload() {
    try {
    await this.onloadInternal();
    } catch (error) {
      console.error('[Nexavault] Failed to load plugin:', error);
      try {
        new Notice(`Nexavault failed to load: ${error instanceof Error ? error.message : String(error)}. See Help › Show debug console.`);
      } catch { /* notice may fail too */ }
      throw error;
    }
  }

  private async onloadInternal() {
    this.logger = new Logger('Nexavault');
    this.logger.info('Loading Nexavault plugin...');

    // Load settings
    await this.loadSettings();
    
    // Initialize credential store
    this.credentialStore = new SecureCredentialStore(this.app, this);
    
    // Initialize core services
    this.hashManager = new HashManager();
    this.manifestManager = new ManifestManager(this.app, this.hashManager, this.logger);
    this.changeQueue = new ChangeQueue(this.app, this.logger);
    this.retryManager = new RetryManager(this.logger);
    this.conflictResolver = new ConflictResolver(this.app, this.logger);
    
    // Initialize backends
    this.githubBackend = new GitHubBackend(this.settings.github, this.logger, this.credentialStore);
    this.s3Backend = new S3Backend(this.settings.s3, this.logger, this.credentialStore);
    
    // Initialize sync engine
    this.syncEngine = new SyncEngine(
      this.app,
      this.settings,
      this.manifestManager,
      this.changeQueue,
      this.retryManager,
      this.conflictResolver,
      this.githubBackend,
      this.s3Backend,
      this.logger
    );
    
    // Initialize change detector
    this.changeDetector = new ChangeDetector(
      this.app,
      this.settings,
      this.manifestManager,
      this.changeQueue,
      this.syncEngine,
      this.logger
    );
    
    // Initialize sync scheduler
    this.syncScheduler = new SyncScheduler(
      this.settings,
      this.syncEngine,
      this.changeDetector,
      this.logger
    );
    
    // Register views
    this.registerViews();
    
    // Register settings tab
    this.addSettingTab(new VaultSyncSettingTab(this.app, this));
    
    // Register commands
    this.registerCommands();
    
    // Register event listeners
    this.registerEventListeners();
    
    // Initialize UI
    this.initializeUI();
    
    // Start services
    await this.startServices();
    
    this.logger.info('Nexavault plugin loaded successfully');
  }

  async onunload() {
    try {
      await this.onunloadInternal();
    } catch (error) {
      console.error('[Nexavault] Error during unload:', error);
    }
  }

  private async onunloadInternal() {
    this.logger.info('Unloading Nexavault plugin...');
    
    // Stop services
    await this.stopServices();
    
    // Clean up views
    this.cleanupViews();
    
    this.logger.info('Nexavault plugin unloaded');
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    
    // Update services with new settings
    if (this.githubBackend) {
      this.githubBackend.updateConfig(this.settings.github);
    }
    if (this.s3Backend) {
      this.s3Backend.updateConfig(this.settings.s3);
    }
    if (this.changeDetector) {
      this.changeDetector.updateSettings(this.settings);
    }
    if (this.syncScheduler) {
      this.syncScheduler.updateSettings(this.settings);
    }
    if (this.syncEngine) {
      this.syncEngine.updateSettings(this.settings);
    }
  }

  private registerViews() {
    // Dashboard view
    this.registerView(
      'nexavault-dashboard',
      (leaf) => (this.dashboardView = new SyncDashboardView(leaf, this))
    );
    
    // Conflict view
    this.registerView(
      'nexavault-conflicts',
      (leaf) => (this.conflictView = new ConflictView(leaf, this))
    );
    
    // Backup view
    this.registerView(
      'nexavault-backup',
      (leaf) => (this.backupView = new BackupView(leaf, this))
    );
    
    // Restore view
    this.registerView(
      'nexavault-restore',
      (leaf) => {
        const view = new RestoreView(leaf, this, this.pendingRestoreId || undefined);
        this.pendingRestoreId = null;
        return (this.restoreView = view);
      }
    );
  }

  private cleanupViews() {
    this.app.workspace.detachLeavesOfType('nexavault-dashboard');
    this.app.workspace.detachLeavesOfType('nexavault-conflicts');
    this.app.workspace.detachLeavesOfType('nexavault-backup');
    this.app.workspace.detachLeavesOfType('nexavault-restore');
  }

  private registerCommands() {
    this.addCommand({
      id: 'sync-now',
      name: 'Sync now',
      callback: () => this.syncEngine?.syncNow(),
    });
    
    this.addCommand({
      id: 'pull-changes',
      name: 'Pull changes',
      callback: () => this.syncEngine?.pullChanges(),
    });
    
    this.addCommand({
      id: 'push-changes',
      name: 'Push changes',
      callback: () => this.syncEngine?.pushChanges(),
    });
    
    this.addCommand({
      id: 'open-sync-dashboard',
      name: 'Open sync dashboard',
      callback: () => this.openDashboard(),
    });
    
    this.addCommand({
      id: 'resolve-conflicts',
      name: 'Resolve conflicts',
      callback: () => this.openConflicts(),
    });
    
    this.addCommand({
      id: 'backup-now',
      name: 'Backup now',
      callback: () => this.syncEngine?.backupNow(),
    });
    
    this.addCommand({
      id: 'restore-backup',
      name: 'Restore backup',
      callback: () => this.openRestore(),
    });
    
    this.addCommand({
      id: 'pause-sync',
      name: 'Pause sync',
      callback: () => this.syncEngine?.pause(),
    });
    
    this.addCommand({
      id: 'resume-sync',
      name: 'Resume sync',
      callback: () => this.syncEngine?.resume(),
    });
  }

  private registerEventListeners() {
    // Listen for vault changes
    this.registerEvent(
      this.app.vault.on('create', (file: TFile) => this.changeDetector?.onFileCreate(file))
    );
    this.registerEvent(
      this.app.vault.on('modify', (file: TFile) => this.changeDetector?.onFileModify(file))
    );
    this.registerEvent(
      this.app.vault.on('delete', (file: TAbstractFile) => {
        if (file instanceof TFile) {
          this.changeDetector?.onFileDelete(file);
        }
      })
    );
    this.registerEvent(
      this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
        if (file instanceof TFile) {
          this.changeDetector?.onFileRename(file, oldPath);
        }
      })
    );
    
    // Listen for network changes
    window.addEventListener('online', () => this.syncScheduler?.onNetworkReconnect());
    window.addEventListener('offline', () => this.syncScheduler?.onNetworkDisconnect());
  }

  private initializeUI() {
    // Add status bar item
    const statusBarItem = this.addStatusBarItem();
    statusBarItem.addClass('nexavault-status-bar');
    const statusView = new SyncStatusView(statusBarItem, this);
    statusView.updateStatus(SyncStatus.IDLE);
    
    // Add ribbon icon
    this.addRibbonIcon('sync', 'Nexavault', () => this.openDashboard());
  }

  private async startServices() {
    try {
      // Wire up dependencies (stores, hash manager)
      this.manifestManager?.setStore(this);
      this.changeQueue?.setPlugin(this);
      this.changeDetector?.setHashManager(this.hashManager!);
      
      // Initialize credential store (auto-unlock with machine-local key)
      await this.credentialStore?.initialize();
      
      // Wire conflict resolver dependencies (manifest + hash manager)
      this.conflictResolver?.setDependencies(this.manifestManager!, this.hashManager!);
      
      // Initialize manifest
      await this.manifestManager?.initialize();
      
      // Initialize change queue (restores persisted pending changes)
      await this.changeQueue?.initialize();
      
      // Start change detector
      await this.changeDetector?.start();
      
      // Start sync scheduler
      await this.syncScheduler?.start();
      
      // Perform initial sync if enabled
      if (this.settings.general.syncOnStartup) {
        setTimeout(() => this.syncEngine?.syncNow(), 2000);
      }
    } catch (error) {
      this.logger.error('Failed to start services', error);
      new Notice('Nexavault: Failed to start sync services. Check console for details.');
    }
  }

  private async stopServices() {
    try {
      await this.syncScheduler?.stop();
      await this.changeDetector?.stop();
      await this.syncEngine?.shutdown();
      await this.changeQueue?.persist();
      await this.manifestManager?.persist();
    } catch (error) {
      this.logger.error('Error stopping services', error);
    }
  }

  openDashboard() {
    this.app.workspace.getLeavesOfType('nexavault-dashboard').forEach((leaf) => leaf.detach());
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      leaf.setViewState({ type: 'nexavault-dashboard', active: true });
    }
  }

  openConflicts() {
    this.app.workspace.getLeavesOfType('nexavault-conflicts').forEach((leaf) => leaf.detach());
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      leaf.setViewState({ type: 'nexavault-conflicts', active: true });
    }
  }

  openBackup() {
    this.app.workspace.getLeavesOfType('nexavault-backup').forEach((leaf) => leaf.detach());
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      leaf.setViewState({ type: 'nexavault-backup', active: true });
    }
  }

  openRestore(backupId?: string) {
    this.pendingRestoreId = backupId || null;
    this.app.workspace.getLeavesOfType('nexavault-restore').forEach((leaf) => leaf.detach());
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      leaf.setViewState({ type: 'nexavault-restore', active: true });
    }
  }

  // Public getters for views
  getSyncEngine(): SyncEngine | null {
    return this.syncEngine;
  }

  getChangeDetector(): ChangeDetector | null {
    return this.changeDetector;
  }

  getManifestManager(): ManifestManager | null {
    return this.manifestManager;
  }

  getChangeQueue(): ChangeQueue | null {
    return this.changeQueue;
  }

  getConflictResolver(): ConflictResolver | null {
    return this.conflictResolver;
  }

  getLogger(): Logger {
    return this.logger;
  }

  getCredentialStore(): SecureCredentialStore | null {
    return this.credentialStore;
  }
}
