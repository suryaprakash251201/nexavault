import { FileState } from './FileState';

/**
 * Conflict - Represents a sync conflict between local and remote versions
 */
export interface Conflict {
  id: string;
  path: string;
  type: ConflictType;
  localState: ConflictFileState;
  remoteState: ConflictFileState;
  baseState?: ConflictFileState; // For three-way merge
  detectedAt: number;
  resolvedAt?: number;
  resolution?: ConflictResolution;
  resolutionData?: any;
}

export type ConflictType = 
  | 'both_modified'
  | 'local_modified_remote_deleted'
  | 'local_deleted_remote_modified'
  | 'both_deleted'
  | 'local_created_remote_created'
  | 'rename_conflict'
  | 'binary_conflict';

export interface ConflictFileState {
  hash: string;
  size: number;
  mtime: number;
  content?: Uint8Array; // Loaded on demand
  exists: boolean;
}

export type ConflictResolution = 
  | 'keep_local'
  | 'keep_remote'
  | 'merge'
  | 'save_both'
  | 'manual';

export interface ConflictResolutionResult {
  resolution: ConflictResolution;
  mergedContent?: Uint8Array;
  newPath?: string; // For save_both
}

export interface ThreeWayMergeResult {
  success: boolean;
  mergedContent?: Uint8Array;
  conflicts?: MergeConflict[];
}

export interface MergeConflict {
  startLine: number;
  endLine: number;
  localContent: string;
  remoteContent: string;
  baseContent: string;
}

/**
 * Conflict detection result
 */
export interface ConflictDetectionResult {
  hasConflicts: boolean;
  conflicts: Conflict[];
  safeChanges: string[]; // Paths that can be synced without conflicts
}

/**
 * Conflict storage for persistence
 */
export interface StoredConflict {
  id: string;
  path: string;
  type: ConflictType;
  localHash: string;
  localSize: number;
  localMtime: number;
  remoteHash: string;
  remoteSize: number;
  remoteMtime: number;
  baseHash?: string;
  baseSize?: number;
  baseMtime?: number;
  detectedAt: number;
  resolvedAt?: number;
  resolution?: ConflictResolution;
  resolutionData?: any;
}

export function conflictToStored(conflict: Conflict): StoredConflict {
  return {
    id: conflict.id,
    path: conflict.path,
    type: conflict.type,
    localHash: conflict.localState.hash,
    localSize: conflict.localState.size,
    localMtime: conflict.localState.mtime,
    remoteHash: conflict.remoteState.hash,
    remoteSize: conflict.remoteState.size,
    remoteMtime: conflict.remoteState.mtime,
    baseHash: conflict.baseState?.hash,
    baseSize: conflict.baseState?.size,
    baseMtime: conflict.baseState?.mtime,
    detectedAt: conflict.detectedAt,
    resolvedAt: conflict.resolvedAt,
    resolution: conflict.resolution,
    resolutionData: conflict.resolutionData,
  };
}

export function storedToConflict(stored: StoredConflict): Conflict {
  return {
    id: stored.id,
    path: stored.path,
    type: stored.type,
    localState: {
      hash: stored.localHash,
      size: stored.localSize,
      mtime: stored.localMtime,
      exists: stored.localSize > 0,
    },
    remoteState: {
      hash: stored.remoteHash,
      size: stored.remoteSize,
      mtime: stored.remoteMtime,
      exists: stored.remoteSize > 0,
    },
    baseState: stored.baseHash ? {
      hash: stored.baseHash,
      size: stored.baseSize!,
      mtime: stored.baseMtime!,
      exists: true,
    } : undefined,
    detectedAt: stored.detectedAt,
    resolvedAt: stored.resolvedAt,
    resolution: stored.resolution,
    resolutionData: stored.resolutionData,
  };
}
