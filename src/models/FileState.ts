/**
 * FileState - Represents the tracked state of a file in the vault
 */
export interface FileState {
  path: string;
  hash: string;
  size: number;
  mtime: number;
  lastSyncedHash: string | null;
  lastSyncedAt: number | null;
  backendStates: BackendFileState[];
}

export interface BackendFileState {
  backendId: string;
  hash: string;
  syncedAt: number;
  remotePath?: string;
  etag?: string;
  versionId?: string;
}

export type FileChangeType = 'create' | 'modify' | 'delete' | 'rename';

export interface FileChange {
  type: FileChangeType;
  path: string;
  oldPath?: string; // For rename operations
  hash?: string;
  size?: number;
  mtime?: number;
  timestamp: number;
}

export interface FileStateMap {
  [path: string]: FileState;
}
