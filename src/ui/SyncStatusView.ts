/**
 * SyncStatusView - Status bar indicator and click handler
 */

import { setIcon } from 'obsidian';
import { SyncStatus, SYNC_STATUS_LABELS, SYNC_STATUS_ICONS } from '../models/SyncStatus';

export class SyncStatusView {
  private plugin: any;
  private statusElement: HTMLElement;
  private currentStatus: SyncStatus = SyncStatus.IDLE;
  private clickHandler: (() => void) | null = null;

  constructor(container: HTMLElement, plugin: any) {
    this.plugin = plugin;
    this.statusElement = container;
    
    this.setupStatusElement();
    this.registerClickHandler();
    
    // Listen for status changes
    const syncEngine = plugin.getSyncEngine();
    if (syncEngine) {
      syncEngine.onStatusChange((status: SyncStatus) => this.updateStatus(status));
    }
  }

  private setupStatusElement(): void {
    this.statusElement.addClass('nexavault-status');
    this.statusElement.style.cssText = `
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 0 8px;
      cursor: pointer;
      opacity: 0.8;
      transition: opacity 0.2s;
    `;
    
    this.statusElement.addEventListener('mouseenter', () => {
      this.statusElement.style.opacity = '1';
    });
    
    this.statusElement.addEventListener('mouseleave', () => {
      this.statusElement.style.opacity = '0.8';
    });
  }

  private registerClickHandler(): void {
    this.clickHandler = () => {
      this.plugin.openDashboard();
    };
    
    this.statusElement.addEventListener('click', this.clickHandler);
  }

  updateStatus(status: SyncStatus): void {
    this.currentStatus = status;
    this.render();
  }

  private render(): void {
    this.statusElement.empty();
    
    const icon = SYNC_STATUS_ICONS[this.currentStatus] || '?';
    const label = SYNC_STATUS_LABELS[this.currentStatus] || 'Unknown';
    
    const iconEl = this.statusElement.createSpan({ cls: 'nexavault-status-icon' });
    iconEl.textContent = icon;
    iconEl.style.fontSize = '14px';
    
    const labelEl = this.statusElement.createSpan({ cls: 'nexavault-status-label' });
    labelEl.textContent = label;
    labelEl.style.fontSize = '12px';
    
    // Add status-specific classes
    this.statusElement.removeClass('nexavault-idle', 'nexavault-syncing', 'nexavault-conflict', 'nexavault-error', 'nexavault-offline', 'nexavault-paused');
    
    switch (this.currentStatus) {
      case SyncStatus.IDLE:
        this.statusElement.addClass('nexavault-idle');
        this.statusElement.style.color = 'var(--text-success)';
        break;
      case SyncStatus.SYNCING:
      case SyncStatus.SCANNING:
      case SyncStatus.QUEUED:
        this.statusElement.addClass('nexavault-syncing');
        this.statusElement.style.color = 'var(--text-accent)';
        // Add animation
        iconEl.style.animation = 'spin 1s linear infinite';
        break;
      case SyncStatus.CONFLICT:
        this.statusElement.addClass('nexavault-conflict');
        this.statusElement.style.color = 'var(--text-warning)';
        break;
      case SyncStatus.ERROR:
        this.statusElement.addClass('nexavault-error');
        this.statusElement.style.color = 'var(--text-error)';
        break;
      case SyncStatus.OFFLINE:
        this.statusElement.addClass('nexavault-offline');
        this.statusElement.style.color = 'var(--text-muted)';
        break;
      case SyncStatus.PAUSED:
        this.statusElement.addClass('nexavault-paused');
        this.statusElement.style.color = 'var(--text-muted)';
        break;
    }
  }

  getCurrentStatus(): SyncStatus {
    return this.currentStatus;
  }

  destroy(): void {
    if (this.clickHandler) {
      this.statusElement.removeEventListener('click', this.clickHandler);
    }
    this.statusElement.empty();
  }
}
