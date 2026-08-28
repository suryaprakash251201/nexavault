/**
 * SyncDashboardView - Main dashboard view
 */

import { WorkspaceLeaf, ItemView, setIcon } from 'obsidian';
import { SyncStatus, SYNC_STATUS_LABELS, SYNC_STATUS_ICONS } from '../models/SyncStatus';
import { Logger } from '../utils/logger';

export class SyncDashboardView extends ItemView {
  private plugin: any;
  private logger: Logger;
  private statusEl!: HTMLElement;
  private githubEl!: HTMLElement;
  private s3El!: HTMLElement;
  private activityEl!: HTMLElement;
  private lastSyncEl!: HTMLElement;
  private refreshInterval: NodeJS.Timeout | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: any) {
    super(leaf);
    this.plugin = plugin;
    this.logger = plugin.getLogger();
  }

  getViewType(): string {
    return 'nexavault-dashboard';
  }

  getDisplayText(): string {
    return 'Nexavault Dashboard';
  }

  getIcon(): string {
    return 'sync';
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('nexavault-dashboard');
    
    this.buildUI(container);
    this.updateUI();
    
    // Auto-refresh
    this.refreshInterval = setInterval(() => this.updateUI(), 5000);
  }

  async onClose(): Promise<void> {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  private buildUI(container: HTMLElement): void {
    // Header
    const header = container.createDiv({ cls: 'nexavault-dashboard-header' });
    header.style.cssText = 'padding: 16px; border-bottom: 1px solid var(--background-modifier-border);';
    
    const title = header.createEl('h2', { text: 'NEXAVAULT' });
    title.style.margin = '0 0 8px 0';
    
    this.statusEl = header.createDiv({ cls: 'nexavault-status-main' });
    
    this.lastSyncEl = header.createDiv({ cls: 'nexavault-last-sync' });
    this.lastSyncEl.style.fontSize = '12px';
    this.lastSyncEl.style.color = 'var(--text-muted)';
    
    // Backends section
    const backendsSection = container.createDiv({ cls: 'nexavault-section' });
    backendsSection.style.padding = '16px';
    
    const backendsTitle = backendsSection.createEl('h3', { text: 'Backends' });
    backendsTitle.style.margin = '0 0 12px 0';
    
    this.githubEl = this.createBackendCard(backendsSection, 'github', 'GitHub', 'git-branch');
    this.s3El = this.createBackendCard(backendsSection, 's3', 'S3 Backup', 'database');
    
    // Activity section
    const activitySection = container.createDiv({ cls: 'nexavault-section' });
    activitySection.style.padding = '16px';
    activitySection.style.borderTop = '1px solid var(--background-modifier-border)';
    
    const activityHeader = activitySection.createDiv({ cls: 'nexavault-activity-header' });
    activityHeader.style.display = 'flex';
    activityHeader.style.justifyContent = 'space-between';
    activityHeader.style.alignItems = 'center';
    activityHeader.style.marginBottom = '12px';
    
    activityHeader.createEl('h3', { text: 'Recent Activity' }).style.margin = '0';
    
    const refreshBtn = activityHeader.createEl('button', { text: 'Refresh', cls: 'mod-cta' });
    refreshBtn.style.fontSize = '11px';
    refreshBtn.style.padding = '4px 12px';
    refreshBtn.onclick = () => this.updateUI();
    
    this.activityEl = activitySection.createDiv({ cls: 'nexavault-activity-list' });
    this.activityEl.style.maxHeight = '300px';
    this.activityEl.style.overflowY = 'auto';
    
    // Actions section
    const actionsSection = container.createDiv({ cls: 'nexavault-section' });
    actionsSection.style.padding = '16px';
    actionsSection.style.borderTop = '1px solid var(--background-modifier-border)';
    
    const actionsTitle = actionsSection.createEl('h3', { text: 'Actions' });
    actionsTitle.style.margin = '0 0 12px 0';
    
    const buttonsContainer = actionsSection.createDiv({ cls: 'nexavault-actions' });
    buttonsContainer.style.display = 'flex';
    buttonsContainer.style.gap = '8px';
    buttonsContainer.style.flexWrap = 'wrap';
    
    this.createActionButton(buttonsContainer, 'Sync Now', 'sync', () => this.plugin.getSyncEngine()?.syncNow());
    this.createActionButton(buttonsContainer, 'Pull Changes', 'download', () => this.plugin.getSyncEngine()?.pullChanges());
    this.createActionButton(buttonsContainer, 'Push Changes', 'upload', () => this.plugin.getSyncEngine()?.pushChanges());
    this.createActionButton(buttonsContainer, 'Backup Now', 'database', () => this.plugin.getSyncEngine()?.backupNow());
    this.createActionButton(buttonsContainer, 'View Conflicts', 'alert-triangle', () => this.plugin.openConflicts());
    this.createActionButton(buttonsContainer, 'Restore Backup', 'rotate-ccw', () => this.plugin.openRestore());
  }

  private createBackendCard(container: HTMLElement, id: string, name: string, icon: string): HTMLElement {
    const card = container.createDiv({ cls: `nexavault-backend-card nexavault-${id}` });
    card.style.cssText = `
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px;
      margin-bottom: 8px;
      background: var(--background-secondary);
      border-radius: 6px;
      border: 1px solid var(--background-modifier-border);
    `;
    
    const iconEl = card.createDiv({ cls: 'nexavault-backend-icon' });
    setIcon(iconEl, icon);
    iconEl.style.fontSize = '24px';
    iconEl.style.color = 'var(--text-muted)';
    
    const infoEl = card.createDiv({ cls: 'nexavault-backend-info' });
    infoEl.style.flex = '1';
    
    const nameEl = infoEl.createDiv({ cls: 'nexavault-backend-name', text: name });
    nameEl.style.fontWeight = '500';
    
    const statusEl = infoEl.createDiv({ cls: 'nexavault-backend-status' });
    statusEl.style.fontSize = '12px';
    statusEl.style.color = 'var(--text-muted)';
    
    const detailsEl = card.createDiv({ cls: 'nexavault-backend-details' });
    detailsEl.style.fontSize = '11px';
    detailsEl.style.color = 'var(--text-muted)';
    detailsEl.style.textAlign = 'right';
    
    return card;
  }

  private createActionButton(container: HTMLElement, text: string, icon: string, onClick: () => void): void {
    const btn = container.createEl('button', { cls: 'mod-cta' });
    btn.style.display = 'flex';
    btn.style.alignItems = 'center';
    btn.style.gap = '6px';
    btn.style.padding = '8px 12px';
    btn.style.fontSize = '12px';
    btn.onclick = onClick;
    
    const iconEl = btn.createSpan();
    setIcon(iconEl, icon);
    iconEl.style.fontSize = '14px';
    
    btn.createSpan({ text });
  }

  private updateUI(): void {
    const syncEngine = this.plugin.getSyncEngine();
    const settings = this.plugin.settings;
    const manifestManager = this.plugin.getManifestManager();
    
    // Update main status
    if (syncEngine) {
      const status = syncEngine.getStatus();
      this.updateMainStatus(status);
    }
    
    // Update last sync
    this.updateLastSync(manifestManager);
    
    // Update GitHub status
    this.updateBackendStatus(this.githubEl, 'github', settings.github);
    
    // Update S3 status
    this.updateBackendStatus(this.s3El, 's3', settings.s3);
    
    // Update activity
    this.updateActivity();
  }

  private updateMainStatus(status: SyncStatus): void {
    this.statusEl.empty();
    this.statusEl.removeClass('nexavault-syncing', 'nexavault-offline', 'nexavault-error', 'nexavault-conflict');
    if (status === SyncStatus.SYNCING || status === SyncStatus.SCANNING || status === SyncStatus.QUEUED) {
      this.statusEl.addClass('nexavault-syncing');
    } else if (status === SyncStatus.OFFLINE) {
      this.statusEl.addClass('nexavault-offline');
    } else if (status === SyncStatus.ERROR) {
      this.statusEl.addClass('nexavault-error');
    } else if (status === SyncStatus.CONFLICT) {
      this.statusEl.addClass('nexavault-conflict');
    }
    
    const icon = SYNC_STATUS_ICONS[status] || '?';
    const label = SYNC_STATUS_LABELS[status] || 'Unknown';
    
    const iconEl = this.statusEl.createSpan({ cls: 'nexavault-main-icon' });
    iconEl.textContent = icon;
    iconEl.style.fontSize = '24px';
    iconEl.style.marginRight = '12px';
    
    const textEl = this.statusEl.createSpan({ cls: 'nexavault-main-text' });
    textEl.textContent = label;
    textEl.style.fontSize = '18px';
    textEl.style.fontWeight = '500';
    
    // Color based on status
    switch (status) {
      case SyncStatus.IDLE:
        textEl.style.color = 'var(--text-success)';
        break;
      case SyncStatus.SYNCING:
      case SyncStatus.SCANNING:
      case SyncStatus.QUEUED:
        textEl.style.color = 'var(--text-accent)';
        iconEl.style.animation = 'spin 1s linear infinite';
        break;
      case SyncStatus.CONFLICT:
        textEl.style.color = 'var(--text-warning)';
        break;
      case SyncStatus.ERROR:
        textEl.style.color = 'var(--text-error)';
        break;
      default:
        textEl.style.color = 'var(--text-muted)';
    }
  }

  private updateLastSync(manifestManager: any): void {
    const manifest = manifestManager?.getManifest();
    if (manifest) {
      const date = new Date(manifest.generatedAt);
      this.lastSyncEl.textContent = `Last scan: ${date.toLocaleString()}`;
    } else {
      this.lastSyncEl.textContent = 'No sync performed yet';
    }
  }

  private updateBackendStatus(card: HTMLElement, backendId: string, settings: any): void {
    const statusEl = card.querySelector('.nexavault-backend-status');
    const detailsEl = card.querySelector('.nexavault-backend-details');
    const iconEl = card.querySelector('.nexavault-backend-icon');
    
    if (!settings.enabled) {
      if (statusEl) statusEl.textContent = 'Disabled';
      if (detailsEl) detailsEl.textContent = '';
      if (iconEl) (iconEl as HTMLElement).style.opacity = '0.4';
      return;
    }
    
    if (iconEl) (iconEl as HTMLElement).style.opacity = '1';
    
    // In a real implementation, we'd get actual backend status
    if (statusEl) statusEl.textContent = 'Connected';
    if (detailsEl) {
      if (backendId === 'github') {
        detailsEl.textContent = `${settings.repository} • ${settings.branch}`;
      } else {
        detailsEl.textContent = `${settings.bucket} • ${settings.region}`;
      }
    }
  }

  private updateActivity(): void {
    // In a real implementation, this would show actual activity log
    this.activityEl.empty();
    
    const activities = [
      { time: '08:24', type: 'push', count: 4, backend: 'github', success: true },
      { time: '08:20', type: 'push', count: 12, backend: 'github', success: true },
      { time: '08:10', type: 'pull', count: 2, backend: 'github', success: true },
      { time: '08:05', type: 'backup', count: 45, backend: 's3', success: true },
    ];
    
    for (const activity of activities) {
      const item = this.activityEl.createDiv({ cls: 'nexavault-activity-item' });
      item.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px;
        font-size: 12px;
        border-bottom: 1px solid var(--background-modifier-border);
      `;
      
      const timeEl = item.createSpan({ text: activity.time });
      timeEl.style.color = 'var(--text-muted)';
      timeEl.style.minWidth = '50px';
      
      const iconEl = item.createSpan();
      const icons: Record<string, string> = { push: 'upload', pull: 'download', backup: 'database', restore: 'rotate-ccw' };
      setIcon(iconEl, icons[activity.type] || 'activity');
      iconEl.style.color = activity.success ? 'var(--text-success)' : 'var(--text-error)';
      
      const descEl = item.createSpan({ text: `${activity.type} ${activity.count} files` });
      descEl.style.flex = '1';
      
      const backendEl = item.createSpan({ text: activity.backend });
      backendEl.style.color = 'var(--text-muted)';
      backendEl.style.fontSize = '11px';
    }
  }
}
