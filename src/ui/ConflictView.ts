/**
 * ConflictView - Conflict resolution UI
 */

import { WorkspaceLeaf, ItemView, setIcon } from 'obsidian';
import { SyncStatus, SYNC_STATUS_LABELS, SYNC_STATUS_ICONS } from '../models/SyncStatus';
import { Logger } from '../utils/logger';

export class ConflictView extends ItemView {
  private plugin: any;
  private logger: Logger;
  private conflictsListEl!: HTMLElement;
  private emptyStateEl!: HTMLElement;
  private refreshInterval: NodeJS.Timeout | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: any) {
    super(leaf);
    this.plugin = plugin;
    this.logger = plugin.getLogger();
  }

  getViewType(): string {
    return 'nexavault-conflicts';
  }

  getDisplayText(): string {
    return 'Sync Conflicts';
  }

  getIcon(): string {
    return 'alert-triangle';
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('nexavault-conflict-view');
    
    this.buildUI(container);
    this.loadConflicts();
    
    this.refreshInterval = setInterval(() => this.loadConflicts(), 10000);
  }

  async onClose(): Promise<void> {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
  }

  private buildUI(container: HTMLElement): void {
    // Header
    const header = container.createDiv({ cls: 'nexavault-conflict-header' });
    header.style.cssText = 'padding: 16px; border-bottom: 1px solid var(--background-modifier-border); display: flex; justify-content: space-between; align-items: center;';
    
    header.createEl('h2', { text: 'Sync Conflicts', style: 'margin: 0;' });
    
    const refreshBtn = header.createEl('button', { text: 'Refresh', cls: 'mod-cta' });
    refreshBtn.style.fontSize = '11px';
    refreshBtn.style.padding = '4px 12px';
    refreshBtn.onclick = () => this.loadConflicts();
    
    // Conflicts list
    this.conflictsListEl = container.createDiv({ cls: 'nexavault-conflicts-list' });
    this.conflictsListEl.style.padding = '16px';
    this.conflictsListEl.style.maxHeight = 'calc(100vh - 200px)';
    this.conflictsListEl.style.overflowY = 'auto';
    
    // Empty state
    this.emptyStateEl = container.createDiv({ cls: 'nexavault-empty-state' });
    this.emptyStateEl.style.cssText = 'display: none; padding: 48px; text-align: center; color: var(--text-muted);';
    this.emptyStateEl.innerHTML = `
      <div style="font-size: 48px; margin-bottom: 16px;">✓</div>
      <div style="font-size: 16px; font-weight: 500;">No conflicts detected</div>
      <div style="font-size: 12px; margin-top: 8px;">All files are in sync</div>
    `;
  }

  private async loadConflicts(): Promise<void> {
    const conflictResolver = this.plugin.getConflictResolver();
    if (!conflictResolver) return;
    
    const conflicts = conflictResolver.getConflicts();
    
    if (conflicts.length === 0) {
      this.conflictsListEl.style.display = 'none';
      this.emptyStateEl.style.display = 'block';
      return;
    }
    
    this.conflictsListEl.style.display = 'block';
    this.emptyStateEl.style.display = 'none';
    
    this.conflictsListEl.empty();
    
    for (const conflict of conflicts) {
      this.renderConflict(conflict);
    }
  }

  private renderConflict(conflict: any): void {
    const card = this.conflictsListEl.createDiv({ cls: 'nexavault-conflict-card' });
    card.style.cssText = `
      background: var(--background-secondary);
      border: 1px solid var(--background-modifier-border);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 12px;
    `;
    
    // Header
    const header = card.createDiv({ cls: 'nexavault-conflict-header' });
    header.style.cssText = 'display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;';
    
    const pathEl = header.createDiv({ cls: 'nexavault-conflict-path' });
    pathEl.style.fontWeight = '500';
    pathEl.style.fontFamily = 'var(--font-monospace)';
    pathEl.style.fontSize = '14px';
    pathEl.textContent = conflict.path;
    
    const typeEl = header.createDiv({ cls: 'nexavault-conflict-type' });
    typeEl.style.fontSize = '11px';
    typeEl.style.padding = '2px 8px';
    typeEl.style.background = 'var(--background-modifier-hover)';
    typeEl.style.borderRadius = '4px';
    typeEl.textContent = this.formatConflictType(conflict.type);
    
    // Details
    const details = card.createDiv({ cls: 'nexavault-conflict-details' });
    details.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; font-size: 12px;';
    
    // Local
    const localEl = details.createDiv({ cls: 'nexavault-conflict-local' });
    localEl.style.padding = '12px';
    localEl.style.background = 'rgba(59, 130, 246, 0.1)';
    localEl.style.borderRadius = '6px';
    localEl.style.border = '1px solid rgba(59, 130, 246, 0.2)';
    
    localEl.createDiv({ text: 'Local', style: 'font-weight: 600; color: #3b82f6; margin-bottom: 8px;' });
    localEl.createDiv({ text: `Modified: ${new Date(conflict.localState.mtime).toLocaleString()}` });
    localEl.createDiv({ text: `Size: ${this.formatBytes(conflict.localState.size)}` });
    localEl.createDiv({ text: `Hash: ${conflict.localState.hash.slice(0, 16)}...` });
    
    // Remote
    const remoteEl = details.createDiv({ cls: 'nexavault-conflict-remote' });
    remoteEl.style.padding = '12px';
    remoteEl.style.background = 'rgba(168, 85, 247, 0.1)';
    remoteEl.style.borderRadius = '6px';
    remoteEl.style.border = '1px solid rgba(168, 85, 247, 0.2)';
    
    remoteEl.createDiv({ text: 'Remote', style: 'font-weight: 600; color: #a855f7; margin-bottom: 8px;' });
    remoteEl.createDiv({ text: `Modified: ${new Date(conflict.remoteState.mtime).toLocaleString()}` });
    remoteEl.createDiv({ text: `Size: ${this.formatBytes(conflict.remoteState.size)}` });
    remoteEl.createDiv({ text: `Hash: ${conflict.remoteState.hash.slice(0, 16)}...` });
    
    // Actions
    const actions = card.createDiv({ cls: 'nexavault-conflict-actions' });
    actions.style.cssText = 'display: flex; gap: 8px; flex-wrap: wrap;';
    
    this.createConflictButton(actions, 'Keep Local', 'check', 'var(--text-success)', () => 
      this.resolveConflict(conflict.id, 'keep_local')
    );
    this.createConflictButton(actions, 'Keep Remote', 'download', 'var(--text-accent)', () => 
      this.resolveConflict(conflict.id, 'keep_remote')
    );
    this.createConflictButton(actions, 'Merge', 'git-merge', 'var(--text-warning)', () => 
      this.resolveConflict(conflict.id, 'merge')
    );
    this.createConflictButton(actions, 'Save Both', 'copy', 'var(--text-muted)', () => 
      this.resolveConflict(conflict.id, 'save_both')
    );
    this.createConflictButton(actions, 'View Diff', 'file-text', 'var(--text-muted)', () => 
      this.viewDiff(conflict)
    );
  }

  private createConflictButton(container: HTMLElement, text: string, icon: string, color: string, onClick: () => void): void {
    const btn = container.createEl('button', { cls: 'mod-cta' });
    btn.style.display = 'flex';
    btn.style.alignItems = 'center';
    btn.style.gap = '6px';
    btn.style.padding = '6px 12px';
    btn.style.fontSize = '12px';
    btn.style.background = 'transparent';
    btn.style.color = color;
    btn.style.border = `1px solid ${color}`;
    btn.onclick = onClick;
    
    const iconEl = btn.createSpan();
    setIcon(iconEl, icon);
    iconEl.style.fontSize = '14px';
    
    btn.createSpan({ text });
  }

  private async resolveConflict(conflictId: string, resolution: string): Promise<void> {
    const conflictResolver = this.plugin.getConflictResolver();
    if (!conflictResolver) return;
    
    try {
      await conflictResolver.resolveConflict(conflictId, resolution as any);
      this.loadConflicts();
    } catch (error) {
      this.logger.error('Failed to resolve conflict', error);
    }
  }

  private async viewDiff(conflict: any): Promise<void> {
    // In a real implementation, this would open a diff view
    this.logger.info('View diff for', conflict.path);
  }

  private formatConflictType(type: string): string {
    const types: Record<string, string> = {
      both_modified: 'Both Modified',
      local_modified_remote_deleted: 'Local Modified, Remote Deleted',
      local_deleted_remote_modified: 'Local Deleted, Remote Modified',
      both_deleted: 'Both Deleted',
      local_created_remote_created: 'Both Created',
      rename_conflict: 'Rename Conflict',
      binary_conflict: 'Binary Conflict',
    };
    return types[type] || type;
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
