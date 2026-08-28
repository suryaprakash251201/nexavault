/**
 * RestoreView - Restore backup with preview
 */

import { WorkspaceLeaf, ItemView, setIcon } from 'obsidian';
import { Logger } from '../utils/logger';

export class RestoreView extends ItemView {
  private plugin: any;
  private logger: Logger;
  private backupsListEl!: HTMLElement;
  private previewEl!: HTMLElement;
  private selectedBackupId: string | null = null;
  private previewFiles: string[] = [];
  private restoreBtn!: HTMLButtonElement;

  constructor(leaf: WorkspaceLeaf, plugin: any) {
    super(leaf);
    this.plugin = plugin;
    this.logger = plugin.getLogger();
  }

  getViewType(): string {
    return 'nexavault-restore';
  }

  getDisplayText(): string {
    return 'Restore Backup';
  }

  getIcon(): string {
    return 'rotate-ccw';
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('nexavault-restore-view');
    
    this.buildUI(container);
    this.loadBackups();
  }

  async onClose(): Promise<void> {
    // Cleanup
  }

  private buildUI(container: HTMLElement): void {
    // Header
    const header = container.createDiv({ cls: 'nexavault-restore-header' });
    header.style.cssText = 'padding: 16px; border-bottom: 1px solid var(--background-modifier-border);';
    
    header.createEl('h2', { text: 'Restore Backup', style: 'margin: 0 0 8px 0;' });
    header.createEl('p', { 
      text: 'Select a backup to preview and restore. This will overwrite local files.', 
      style: 'margin: 0; font-size: 13px; color: var(--text-muted);' 
    });
    
    // Main content - split view
    const mainContent = container.createDiv({ cls: 'nexavault-restore-content' });
    mainContent.style.cssText = 'display: flex; flex: 1; overflow: hidden;';
    
    // Left panel - backup list
    const leftPanel = mainContent.createDiv({ cls: 'nexavault-restore-left' });
    leftPanel.style.cssText = 'width: 350px; border-right: 1px solid var(--background-modifier-border); overflow-y: auto;';
    
    leftPanel.createEl('h3', { text: 'Available Backups', style: 'padding: 16px; margin: 0; border-bottom: 1px solid var(--background-modifier-border);' });
    
    this.backupsListEl = leftPanel.createDiv({ cls: 'nexavault-restore-backups' });
    this.backupsListEl.style.padding = '8px';
    
    // Right panel - preview
    const rightPanel = mainContent.createDiv({ cls: 'nexavault-restore-right' });
    rightPanel.style.cssText = 'flex: 1; overflow-y: auto; padding: 16px;';
    
    rightPanel.createEl('h3', { text: 'Preview', style: 'margin: 0 0 16px 0;' });
    
    this.previewEl = rightPanel.createDiv({ cls: 'nexavault-restore-preview' });
    this.previewEl.style.minHeight = '200px';
    this.showEmptyPreview();
    
    // Bottom actions
    const actionsBar = container.createDiv({ cls: 'nexavault-restore-actions' });
    actionsBar.style.cssText = 'padding: 16px; border-top: 1px solid var(--background-modifier-border); display: flex; justify-content: flex-end; gap: 12px;';
    
    const cancelBtn = actionsBar.createEl('button', { text: 'Cancel', cls: 'mod-cta' });
    cancelBtn.style.background = 'transparent';
    cancelBtn.style.color = 'var(--text-muted)';
    cancelBtn.style.border = '1px solid var(--background-modifier-border)';
    cancelBtn.onclick = () => this.close();
    
    this.restoreBtn = actionsBar.createEl('button', { text: 'Restore Selected', cls: 'mod-cta' });
    this.restoreBtn.disabled = true;
    this.restoreBtn.onclick = () => this.confirmRestore();
  }

  private showEmptyPreview(): void {
    this.previewEl.empty();
    this.previewEl.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 200px; color: var(--text-muted); text-align: center;">
        <div style="font-size: 48px; margin-bottom: 16px;">🔍</div>
        <div style="font-size: 16px; font-weight: 500;">Select a backup to preview</div>
        <div style="font-size: 12px; margin-top: 8px;">Choose a backup from the list to see what would be restored</div>
      </div>
    `;
  }

  private async loadBackups(): Promise<void> {
    // Mock data - in reality would fetch from S3
    const backups = [
      { id: 'backup-1', name: 'Daily Backup', timestamp: Date.now() - 3600000, size: 1024 * 1024 * 50, fileCount: 1234 },
      { id: 'backup-2', name: 'Weekly Backup', timestamp: Date.now() - 86400000 * 3, size: 1024 * 1024 * 48, fileCount: 1200 },
      { id: 'backup-3', name: 'Monthly Backup', timestamp: Date.now() - 86400000 * 15, size: 1024 * 1024 * 45, fileCount: 1150 },
    ];
    
    this.backupsListEl.empty();
    
    for (const backup of backups) {
      const item = this.backupsListEl.createDiv({ cls: 'nexavault-restore-backup-item' });
      item.style.cssText = `
        padding: 12px;
        margin: 4px;
        border-radius: 6px;
        cursor: pointer;
        transition: background 0.15s;
        border: 2px solid transparent;
      `;
      
      item.innerHTML = `
        <div style="font-weight: 500; font-size: 13px;">${backup.name}</div>
        <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
          ${this.formatDate(backup.timestamp)} • ${this.formatBytes(backup.size)} • ${backup.fileCount} files
        </div>
      `;
      
      item.addEventListener('mouseenter', () => {
        item.style.background = 'var(--background-modifier-hover)';
      });
      item.addEventListener('mouseleave', () => {
        if (this.selectedBackupId !== backup.id) {
          item.style.background = 'transparent';
        }
      });
      
      item.onclick = () => this.selectBackup(backup.id, item);
    }
  }

  private selectBackup(backupId: string, element: HTMLElement): void {
    // Update selection
    this.backupsListEl.querySelectorAll('.nexavault-restore-backup-item').forEach(el => {
      el.style.background = 'transparent';
      el.style.borderColor = 'transparent';
    });
    
    element.style.background = 'var(--background-modifier-hover)';
    element.style.borderColor = 'var(--interactive-accent)';
    
    this.selectedBackupId = backupId;
    this.restoreBtn.disabled = false;
    
    // Load preview
    this.loadPreview(backupId);
  }

  private async loadPreview(backupId: string): Promise<void> {
    this.previewEl.empty();
    this.previewEl.createEl('p', { text: 'Loading preview...', style: 'color: var(--text-muted);' });
    
    // Simulate loading
    await new Promise(r => setTimeout(r, 500));
    
    // Mock preview data
    this.previewFiles = [
      'Notes/new-note.md',
      'Projects/updated.md',
      'Attachments/image.png',
      'README.md',
    ];
    
    this.renderPreview();
  }

  private renderPreview(): void {
    this.previewEl.empty();
    
    const summary = this.previewEl.createDiv({ cls: 'nexavault-preview-summary' });
    summary.style.cssText = 'margin-bottom: 16px; padding: 12px; background: var(--background-secondary); border-radius: 6px;';
    summary.innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; text-align: center;">
        <div>
          <div style="font-size: 24px; font-weight: 600; color: var(--text-accent);">12</div>
          <div style="font-size: 11px; color: var(--text-muted);">New Files</div>
        </div>
        <div>
          <div style="font-size: 24px; font-weight: 600; color: var(--text-warning);">8</div>
          <div style="font-size: 11px; color: var(--text-muted);">Modified</div>
        </div>
        <div>
          <div style="font-size: 24px; font-weight: 600; color: var(--text-error);">3</div>
          <div style="font-size: 11px; color: var(--text-muted);">Deleted</div>
        </div>
      </div>
    `;
    
    const filesList = this.previewEl.createDiv({ cls: 'nexavault-preview-files' });
    filesList.style.maxHeight = '300px';
    filesList.style.overflowY = 'auto';
    
    for (const file of this.previewFiles) {
      const item = filesList.createDiv({ cls: 'nexavault-preview-file' });
      item.style.cssText = 'display: flex; align-items: center; gap: 8px; padding: 8px; font-size: 12px; font-family: var(--font-monospace); border-bottom: 1px solid var(--background-modifier-border);';
      
      const icon = file.endsWith('.md') ? 'file-text' : file.endsWith('.png') ? 'image' : 'file';
      const iconEl = item.createSpan();
      setIcon(iconEl, icon);
      iconEl.style.fontSize = '14px';
      iconEl.style.color = 'var(--text-muted)';
      
      item.createSpan({ text: file }).style.flex = '1';
    }
    
    // Warning
    const warning = this.previewEl.createDiv({ cls: 'nexavault-preview-warning' });
    warning.style.cssText = 'margin-top: 16px; padding: 12px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 6px; color: var(--text-error); font-size: 12px;';
    warning.innerHTML = `
      <strong>⚠ Warning:</strong> Restoring will overwrite local files. 
      Make sure you have no unsaved changes. 
      This action cannot be undone.
    `;
  }

  private async confirmRestore(): Promise<void> {
    if (!this.selectedBackupId) return;
    
    const confirmed = confirm(
      `Are you sure you want to restore backup ${this.selectedBackupId}?\n\n` +
      `This will overwrite ${this.previewFiles.length} files in your vault.\n\n` +
      `This action cannot be undone.`
    );
    
    if (confirmed) {
      this.logger.info('Restoring backup', this.selectedBackupId);
      // In reality, would call syncEngine.restoreBackup(this.selectedBackupId)
      this.close();
    }
  }

  private close(): void {
    this.leaf.detach();
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
