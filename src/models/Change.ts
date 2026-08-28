import { FileChange, FileChangeType } from './FileState';
import { v4 as uuidv4 } from 'uuid';

/**
 * Change - Represents a single file change operation
 */
export class Change {
  id: string;
  type: FileChangeType;
  path: string;
  oldPath?: string;
  hash?: string;
  size?: number;
  mtime?: number;
  timestamp: number;
  retryCount: number;
  lastAttempt?: number;
  error?: string;
  backendTargets: string[]; // Which backends this change should sync to

  constructor(change: FileChange, backendTargets: string[] = []) {
    this.id = uuidv4();
    this.type = change.type;
    this.path = change.path;
    this.oldPath = change.oldPath;
    this.hash = change.hash;
    this.size = change.size;
    this.mtime = change.mtime;
    this.timestamp = change.timestamp;
    this.retryCount = 0;
    this.backendTargets = backendTargets;
  }

  static create(path: string, hash: string, size: number, mtime: number, backendTargets: string[] = []): Change {
    return new Change({
      type: 'create',
      path,
      hash,
      size,
      mtime,
      timestamp: Date.now(),
    }, backendTargets);
  }

  static modify(path: string, hash: string, size: number, mtime: number, backendTargets: string[] = []): Change {
    return new Change({
      type: 'modify',
      path,
      hash,
      size,
      mtime,
      timestamp: Date.now(),
    }, backendTargets);
  }

  static delete(path: string, backendTargets: string[] = []): Change {
    return new Change({
      type: 'delete',
      path,
      timestamp: Date.now(),
    }, backendTargets);
  }

  static rename(oldPath: string, newPath: string, hash: string, size: number, mtime: number, backendTargets: string[] = []): Change {
    return new Change({
      type: 'rename',
      path: newPath,
      oldPath,
      hash,
      size,
      mtime,
      timestamp: Date.now(),
    }, backendTargets);
  }

  incrementRetry(): void {
    this.retryCount++;
    this.lastAttempt = Date.now();
  }

  setError(error: string): void {
    this.error = error;
  }

  clearError(): void {
    this.error = undefined;
  }

  isRetryable(): boolean {
    // Don't retry if max retries exceeded (will be checked by RetryManager)
    // Don't retry permanent errors
    if (this.error) {
      const permanentErrors = [
        'authentication',
        'permission',
        'not found',
        'invalid',
        'unauthorized',
        'forbidden',
      ];
      const lowerError = this.error.toLowerCase();
      if (permanentErrors.some(e => lowerError.includes(e))) {
        return false;
      }
    }
    return true;
  }

  toJSON(): object {
    return {
      id: this.id,
      type: this.type,
      path: this.path,
      oldPath: this.oldPath,
      hash: this.hash,
      size: this.size,
      mtime: this.mtime,
      timestamp: this.timestamp,
      retryCount: this.retryCount,
      lastAttempt: this.lastAttempt,
      error: this.error,
      backendTargets: this.backendTargets,
    };
  }

  static fromJSON(data: any): Change {
    const change = new Change({
      type: data.type,
      path: data.path,
      oldPath: data.oldPath,
      hash: data.hash,
      size: data.size,
      mtime: data.mtime,
      timestamp: data.timestamp,
    }, data.backendTargets);
    
    change.id = data.id;
    change.retryCount = data.retryCount || 0;
    change.lastAttempt = data.lastAttempt;
    change.error = data.error;
    
    return change;
  }
}

/**
 * ChangeSet - A batch of changes to be synced together
 */
export interface ChangeSet {
  changes: Change[];
  timestamp: number;
  source: 'local' | 'remote';
  deviceId: string;
}

export function createChangeSet(changes: Change[], deviceId: string): ChangeSet {
  return {
    changes,
    timestamp: Date.now(),
    source: 'local',
    deviceId,
  };
}
