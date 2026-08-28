import { Change } from './Change';
import { Conflict } from './Conflict';
import { SyncStatus } from './SyncStatus';

/**
 * SyncResult - Result of a sync operation
 */
export interface SyncResult {
  success: boolean;
  timestamp: number;
  duration: number;
  changesProcessed: number;
  filesUploaded: number;
  filesDownloaded: number;
  filesDeleted: number;
  conflictsDetected: number;
  errors: SyncError[];
  backendResults: BackendSyncResult[];
}

export interface BackendSyncResult {
  backendId: string;
  success: boolean;
  changesProcessed: number;
  filesUploaded: number;
  filesDownloaded: number;
  filesDeleted: number;
  errors: SyncError[];
  commitHash?: string; // For GitHub
  backupId?: string; // For S3
}

export interface SyncError {
  changeId?: string;
  path?: string;
  backendId: string;
  error: string;
  code?: string;
  retryable: boolean;
  timestamp: number;
}

export interface PullResult {
  success: boolean;
  changes: RemoteChange[];
  conflicts: Conflict[];
  errors: SyncError[];
}

export interface PushResult {
  success: boolean;
  changesPushed: Change[];
  conflicts: Conflict[];
  errors: SyncError[];
}

export interface RemoteChange {
  path: string;
  hash: string;
  size: number;
  mtime: number;
  type: 'create' | 'modify' | 'delete' | 'rename';
  oldPath?: string;
  backendId: string;
  remotePath?: string;
  etag?: string;
  versionId?: string;
}

export interface SyncSummary {
  lastSync: number | null;
  lastSuccessfulSync: number | null;
  pendingChanges: number;
  pendingConflicts: number;
  status: SyncStatus;
  backendStatuses: BackendStatus[];
}

export interface BackendStatus {
  backendId: string;
  connected: boolean;
  lastSync: number | null;
  lastError?: string;
  pendingChanges: number;
}
