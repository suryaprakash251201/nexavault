/**
 * BackupView - Backup listing and management
 */

import { WorkspaceLeaf, ItemView, setIcon } from 'obsidian';
import { Logger } from '../utils/logger';

export interface BackupInfo {
  id: string;
  name: string;
  timestamp: number;
  size: number;
  fileCount: number;
  backend: string;
}

export class BackupView extends ItemView {
  private plugin: any;
  private logger: Logger;
  private backupsListEl!: HTMLElement;
  private emptyStateEl!: HTMLElement;
  private refreshInterval: NodeJS.Timeout | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: any) {
    super(leaf);
    this.plugin = plugin;
    this.logger = plugin.getLogger();
  }

  getViewType(): string {
    return 'nexavault-backup';
  }

  getDisplayText(): string {
    return 'Backups';
  }

  getIcon(): string {
    return 'database';
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('nexavault-backup-view');
    
    this.buildUI(container);
    this.loadBackups();
    
    this.refreshInterval = setInterval(() => this.loadBackups(), 30000);
  }

  async onClose(): Promise<void> {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
  }

  private buildUI(container: HTMLElement): void {
    // Header
    const header = container.createDiv({ cls: 'nexavault-backup-header' });
    header.style.cssText = 'padding: 16px; border-bottom: 1px solid var(--background-modifier-border); display: flex; justify-content: space-between; align-items: center;';
    
    header.createEl('h2', { text: 'S3 Backups', style: 'margin: 0;' });
    
    const actions = header.createDiv({ cls: 'nexavault-backup-actions' });
    actions.style.display = 'flex';
    actions.style.gap = '8px';
    
    const refreshBtn = actions.createEl('button', { text: 'Refresh', cls: 'mod-cta' });
    refreshBtn.style.fontSize = '11px';
    refreshBtn.style.padding = '4px 12px';
    refreshBtn.onclick = () => this.loadBackups();
    
    const backupNowBtn = actions.createEl('button', { text: 'Backup Now', cls: 'mod-cta' });
    backupNowBtn.style.fontSize = '11px';
    backupNowBtn.style.padding = '4px 12px';
    backupNowBtn.onclick = () => this.plugin.getSyncEngine()?.backupNow();
    
    // Backups list
    this.backupsListEl = container.createDiv({ cls: 'nexavault-backups-list' });
    this.backupsListEl.style.padding = '16px';
    this.backupsListEl.style.maxHeight = 'calc(100vh - 200px)';
    this.backupsListEl.style.overflowY = 'auto';
    
    // Empty state
    this.emptyStateEl = container.createDiv({ cls: 'nexavault-empty-state' });
    this.emptyStateEl.style.cssText = 'display: none; padding: 48px; text-align: center; color: var(--text-muted);';
    this.emptyStateEl.innerHTML = `
      <div style="font-size: 48px; margin-bottom: 16px;">📦</div>
      <div style="font-size: 16px; font-weight: 500;">No backups found</div>
      <div style="font-size: 12px; margin-top: 8px;">Create your first backup to get started</div>
    `;
  }

  private async loadBackups(): Promise<void> {
    // In a real implementation, this would fetch from S3
    // For now, show mock data
    const backups: BackupInfo[] = [
      { id: 'backup-1', name: 'Daily Backup', timestamp: Date.now() - 3600000, size: 1024 * 1024 * 50, fileCount: 1234, backend: 's3' },
      { id: 'backup-2', name: 'Weekly Backup', timestamp: Date.now() - 86400000 * 3, size: 1024 * 1024 * 48, fileCount: 1200, backend: 's3' },
      { id: 'backup-3', name: 'Monthly Backup', timestamp: Date.now() - 86400000 * 15, size: 1024 * 1024 * 45, fileCount: 1150, backend: 's3' },
    ];
    
    if (backups.length === 0) {
      this.backupsListEl.style.display = 'none';
      this.emptyStateEl.style.display = 'block';
      return;
    }
    
    this.backupsListEl.style.display = 'block';
    this.emptyStateEl.style.display = 'none';
    
    this.backupsListEl.empty();
    
    for (const backup of backups) {
      this.renderBackup(backup);
    }
  }

  private renderBackup(backup: BackupInfo): void {
    const card = this.backupsListEl.createDiv({ cls: 'nexavault-backup-card' });
    card.style.cssText = `
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 16px;
      margin-bottom: 12px;
      background: var(--background-secondary);
      border: 1px solid var(--background-modifier-border);
      border-radius: 8px;
    `;
    
    // Icon
    const iconEl = card.createDiv({ cls: 'nexavault-backup-icon' });
    setIcon(iconEl, 'database');
    iconEl.style.fontSize = '32px';
    iconEl.style.color = 'var(--text-accent)';
    iconEl.style.flexShrink = '0';
    
    // Info
    const infoEl = card.createDiv({ cls: 'nexavault-backup-info' });
    infoEl.style.flex = '1';
    
    const nameEl = infoEl.createDiv({ cls: 'nexavault-backup-name' });
    nameEl.style.fontWeight = '500';
    nameEl.style.fontSize = '14px';
    nameEl.textContent = backup.name;
    
    const metaEl = infoEl.createDiv({ cls: 'nexavault-backup-meta' });
    metaEl.style.fontSize = '12px';
    metaEl.style.color = 'var(--text-muted)';
    metaEl.style.marginTop = '4px';
    metaEl.textContent = `${this.formatDate(backup.timestamp)} • ${this.formatBytes(backup.size)} • ${backup.fileCount} files`;
    
    // Actions
    const actionsEl = card.createDiv({ cls: 'nexavault-backup-actions' });
    actionsEl.style.display = 'flex';
    actionsEl.style.gap = '8px';
    
    const restoreBtn = actionsEl.createEl('button', { text: 'Restore', cls: 'mod-cta' });
    restoreBtn.style.fontSize = '11px';
    restoreBtn.style.padding = '6px 12px';
    restoreBtn.onclick = () => this.restoreBackup(backup);
    
    const previewBtn = actionsEl.createEl('button', { text: 'Preview', cls: 'mod-cta' });
    previewBtn.style.fontSize = '11px';
    previewBtn.style.padding = '6px 12px';
    previewBtn.style.background = 'transparent';
    previewBtn.style.color = 'var(--text-accent)';
    previewBtn.style.border = '1px solid var(--text-accent)';
    previewBtn.onclick = () => this.previewBackup(backup);
  }

  private async restoreBackup(backup: BackupInfo): Promise<void> {
    // Open restore view with this backup selected
    this.plugin.openRestore();
    this.logger.info('Restore backup', backup.id);
  }

  private async previewBackup(backup: BackupInfo): Promise<void> {
    this.logger.info('Preview backup', backup.id);
  }

  private formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - timestamp;
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
    return date.toLocaleDateString();
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
}
