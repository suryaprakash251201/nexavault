/**
 * SyncStatus - Enumeration of possible sync states
 */
export enum SyncStatus {
  IDLE = 'idle',
  SCANNING = 'scanning',
  QUEUED = 'queued',
  SYNCING = 'syncing',
  OFFLINE = 'offline',
  CONFLICT = 'conflict',
  ERROR = 'error',
  PAUSED = 'paused',
}

export const SYNC_STATUS_LABELS: Record<SyncStatus, string> = {
  [SyncStatus.IDLE]: 'Synced',
  [SyncStatus.SCANNING]: 'Scanning...',
  [SyncStatus.QUEUED]: 'Queued',
  [SyncStatus.SYNCING]: 'Syncing...',
  [SyncStatus.OFFLINE]: 'Offline — queued',
  [SyncStatus.CONFLICT]: 'Conflict',
  [SyncStatus.ERROR]: 'Sync error',
  [SyncStatus.PAUSED]: 'Paused',
};

export const SYNC_STATUS_ICONS: Record<SyncStatus, string> = {
  [SyncStatus.IDLE]: '✓',
  [SyncStatus.SCANNING]: '⟳',
  [SyncStatus.QUEUED]: '⏳',
  [SyncStatus.SYNCING]: '↑↓',
  [SyncStatus.OFFLINE]: '⟳',
  [SyncStatus.CONFLICT]: '⚠',
  [SyncStatus.ERROR]: '✕',
  [SyncStatus.PAUSED]: '⏸',
};

export type SyncDirection = 'push' | 'pull' | 'bidirectional';

export interface SyncProgress {
  status: SyncStatus;
  direction?: SyncDirection;
  totalFiles: number;
  processedFiles: number;
  currentFile?: string;
  bytesTransferred: number;
  totalBytes: number;
  startTime: number;
  estimatedTimeRemaining?: number;
}

export interface DeviceInfo {
  deviceId: string;
  name: string;
  lastSeen: number;
  isCurrentDevice: boolean;
}

export interface SyncActivityEntry {
  timestamp: number;
  type: 'push' | 'pull' | 'backup' | 'restore' | 'conflict' | 'error';
  backendId: string;
  fileCount: number;
  details?: string;
  success: boolean;
}
