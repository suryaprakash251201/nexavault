/**
 * ConflictResolver - Detects and resolves sync conflicts
 */

import { App, TFile, Vault } from 'obsidian';
import { ManifestManager } from './ManifestManager';
import { HashManager } from './HashManager';
import { Conflict, ConflictType, ConflictFileState, ConflictDetectionResult, ThreeWayMergeResult, MergeConflict, storedToConflict, conflictToStored, ConflictResolution } from '../models/Conflict';
import { FileState } from '../models/FileState';
import { Logger } from '../utils/logger';
import { normalizePath } from '../utils/pathUtils';

export class ConflictResolver {
  private app: App;
  private vault: Vault;
  private manifestManager: ManifestManager;
  private hashManager: HashManager;
  private logger: Logger;
  private conflicts: Map<string, Conflict> = new Map();

  constructor(app: App, logger: Logger) {
    this.app = app;
    this.vault = app.vault;
    this.logger = logger;
    // These will be set later
    this.manifestManager = null as any;
    this.hashManager = null as any;
  }

  setDependencies(manifestManager: ManifestManager, hashManager: HashManager): void {
    this.manifestManager = manifestManager;
    this.hashManager = hashManager;
  }

  /**
   * Detect conflicts between local and remote states
   */
  async detectConflicts(
    localFiles: Map<string, FileState>,
    remoteFiles: Map<string, FileState>
  ): Promise<ConflictDetectionResult> {
    const conflicts: Conflict[] = [];
    const safeChanges: string[] = [];
    
    const allPaths = new Set([...localFiles.keys(), ...remoteFiles.keys()]);
    
    for (const path of allPaths) {
      const normalizedPath = normalizePath(path);
      const localState = localFiles.get(normalizedPath);
      const remoteState = remoteFiles.get(normalizedPath);
      
      const conflict = await this.analyzeConflict(normalizedPath, localState, remoteState);
      
      if (conflict) {
        conflicts.push(conflict);
        this.conflicts.set(conflict.id, conflict);
      } else if (localState || remoteState) {
        // No conflict, safe to sync
        safeChanges.push(normalizedPath);
      }
    }
    
    return {
      hasConflicts: conflicts.length > 0,
      conflicts,
      safeChanges,
    };
  }

  /**
   * Analyze a single file for conflicts
   */
  private async analyzeConflict(
    path: string,
    localState: FileState | undefined,
    remoteState: FileState | undefined
  ): Promise<Conflict | null> {
    // Defensive: never crash if dependencies were not injected yet
    if (!this.manifestManager) return null;
    
    const localExists = !!localState;
    const remoteExists = !!remoteState;
    
    // Both unchanged - no conflict
    if (localExists && remoteExists && 
        localState.hash === remoteState.hash) {
      return null;
    }
    
    // Local deleted, remote unchanged
    if (!localExists && remoteExists) {
      const manifestEntry = this.manifestManager.getFileEntry(path);
      if (manifestEntry && manifestEntry.hash === remoteState.hash) {
        return this.createConflict(path, 'local_deleted_remote_modified', localState, remoteState);
      }
      // Both deleted - no conflict
      if (!manifestEntry) return null;
    }
    
    // Remote deleted, local unchanged
    if (localExists && !remoteExists) {
      const manifestEntry = this.manifestManager.getFileEntry(path);
      if (manifestEntry && manifestEntry.hash === localState.hash) {
        return this.createConflict(path, 'local_modified_remote_deleted', localState, remoteState);
      }
      // Both deleted - no conflict
      if (!manifestEntry) return null;
    }
    
    // Both exist but different
    if (localExists && remoteExists && localState.hash !== remoteState.hash) {
      // Check if it's a binary file
      const isBinary = await this.isBinaryFile(path, localState, remoteState);
      
      if (isBinary) {
        return this.createConflict(path, 'binary_conflict', localState, remoteState);
      }
      
      // Check if both were created independently (same name, different content)
      const manifestEntry = this.manifestManager.getFileEntry(path);
      if (!manifestEntry) {
        return this.createConflict(path, 'local_created_remote_created', localState, remoteState);
      }
      
      return this.createConflict(path, 'both_modified', localState, remoteState, manifestEntry);
    }
    
    // Both deleted
    if (!localExists && !remoteExists) {
      const manifestEntry = this.manifestManager.getFileEntry(path);
      if (manifestEntry) {
        return this.createConflict(path, 'both_deleted', localState, remoteState, manifestEntry);
      }
    }
    
    return null;
  }

  /**
   * Create a conflict object
   */
  private createConflict(
    path: string,
    type: ConflictType,
    localState: FileState | undefined,
    remoteState: FileState | undefined,
    baseEntry?: ManifestFileEntry
  ): Conflict {
    const now = Date.now();
    const id = `conflict-${now}-${Math.random().toString(36).substr(2, 9)}`;
    
    const localFileState: ConflictFileState = {
      hash: localState?.hash || '',
      size: localState?.size || 0,
      mtime: localState?.mtime || 0,
      exists: !!localState,
    };
    
    const remoteFileState: ConflictFileState = {
      hash: remoteState?.hash || '',
      size: remoteState?.size || 0,
      mtime: remoteState?.mtime || 0,
      exists: !!remoteState,
    };
    
    let baseState: ConflictFileState | undefined;
    if (baseEntry) {
      baseState = {
        hash: baseEntry.hash,
        size: baseEntry.size,
        mtime: baseEntry.mtime,
        exists: true,
      };
    }
    
    return {
      id,
      path,
      type,
      localState: localFileState,
      remoteState: remoteFileState,
      baseState,
      detectedAt: now,
    };
  }

  /**
   * Check if a file is binary
   */
  private async isBinaryFile(
    path: string,
    localState: FileState | undefined,
    remoteState: FileState | undefined
  ): Promise<boolean> {
    // Check extension first
    const binaryExtensions = [
      'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'ico',
      'pdf', 'zip', 'gz', 'tar', 'rar', '7z',
      'mp3', 'mp4', 'wav', 'avi', 'mov', 'mkv',
      'ttf', 'otf', 'woff', 'woff2', 'eot',
      'exe', 'dll', 'so', 'dylib',
      'db', 'sqlite', 'sqlite3',
    ];
    
    const ext = path.split('.').pop()?.toLowerCase();
    if (ext && binaryExtensions.includes(ext)) {
      return true;
    }
    
    // For text files, we could check content but that requires reading
    // For now, rely on extension
    return false;
  }

  /**
   * Perform three-way merge for text files
   */
  async threeWayMerge(
    conflict: Conflict,
    localContent: string,
    remoteContent: string,
    baseContent?: string
  ): Promise<ThreeWayMergeResult> {
    if (!baseContent) {
      // No base, try two-way merge
      return this.twoWayMerge(localContent, remoteContent);
    }
    
    const localLines = localContent.split('\n');
    const remoteLines = remoteContent.split('\n');
    const baseLines = baseContent.split('\n');
    
    const mergedLines: string[] = [];
    const conflicts: MergeConflict[] = [];
    
    let i = 0, j = 0, k = 0;
    
    while (i < localLines.length || j < remoteLines.length || k < baseLines.length) {
      const localLine = localLines[i];
      const remoteLine = remoteLines[j];
      const baseLine = baseLines[k];
      
      // All three match
      if (localLine === remoteLine && localLine === baseLine) {
        if (localLine !== undefined) {
          mergedLines.push(localLine);
        }
        i++; j++; k++;
        continue;
      }
      
      // Local and base match, remote changed
      if (localLine === baseLine && remoteLine !== baseLine) {
        if (remoteLine !== undefined) {
          mergedLines.push(remoteLine);
        }
        i++; j++; k++;
        continue;
      }
      
      // Remote and base match, local changed
      if (remoteLine === baseLine && localLine !== baseLine) {
        if (localLine !== undefined) {
          mergedLines.push(localLine);
        }
        i++; j++; k++;
        continue;
      }
      
      // Both changed differently - conflict
      if (localLine !== baseLine && remoteLine !== baseLine && localLine !== remoteLine) {
        conflicts.push({
          startLine: mergedLines.length,
          endLine: mergedLines.length,
          localContent: localLine || '',
          remoteContent: remoteLine || '',
          baseContent: baseLine || '',
        });
        
        // For now, mark as conflict - user must resolve
        // In a real implementation, we'd include conflict markers
        mergedLines.push(`<<<<<<< LOCAL\n${localLine || ''}\n=======\n${remoteLine || ''}\n>>>>>>> REMOTE`);
        
        i++; j++; k++;
        continue;
      }
      
      // Handle end of file cases
      if (k >= baseLines.length) {
        // Base exhausted, append remaining
        if (i < localLines.length) {
          mergedLines.push(localLines[i++]);
        } else if (j < remoteLines.length) {
          mergedLines.push(remoteLines[j++]);
        }
      }
    }
    
    if (conflicts.length > 0) {
      return {
        success: false,
        mergedContent: new TextEncoder().encode(mergedLines.join('\n')),
        conflicts,
      };
    }
    
    return {
      success: true,
      mergedContent: new TextEncoder().encode(mergedLines.join('\n')),
    };
  }

  /**
   * Simple two-way merge (no base)
   */
  private twoWayMerge(localContent: string, remoteContent: string): ThreeWayMergeResult {
    if (localContent === remoteContent) {
      return {
        success: true,
        mergedContent: new TextEncoder().encode(localContent),
      };
    }
    
    // No base - cannot safely auto-merge
    return {
      success: false,
      conflicts: [{
        startLine: 0,
        endLine: Math.max(localContent.split('\n').length, remoteContent.split('\n').length),
        localContent,
        remoteContent,
        baseContent: '',
      }],
    };
  }

  /**
   * Resolve a conflict with user's choice
   */
  async resolveConflict(
    conflictId: string,
    resolution: ConflictResolution,
    customContent?: Uint8Array
  ): Promise<{ resolution: ConflictResolution; mergedContent?: Uint8Array; newPath?: string }> {
    const conflict = this.conflicts.get(conflictId);
    if (!conflict) {
      throw new Error(`Conflict not found: ${conflictId}`);
    }
    
    let result: { resolution: ConflictResolution; mergedContent?: Uint8Array; newPath?: string } = { resolution };
    
    switch (resolution) {
      case 'keep_local':
        // Local version wins - nothing to do
        break;
      case 'keep_remote':
        // Remote version wins - will be downloaded
        break;
      case 'merge':
        // Three-way merge already computed
        break;
      case 'save_both':
        // Save both versions with different names
        const ext = conflict.path.split('.').pop();
        const baseName = conflict.path.replace(`.${ext}`, '');
        result.newPath = `${baseName}.remote.${ext}`;
        break;
      case 'manual':
        if (customContent) {
          result.mergedContent = customContent;
        }
        break;
    }
    
    conflict.resolvedAt = Date.now();
    conflict.resolution = resolution;
    conflict.resolutionData = result;
    
    return result;
  }

  /**
   * Load conflict content from vault
   */
  async loadConflictContent(conflict: Conflict): Promise<{ local?: string; remote?: string; base?: string }> {
    const result: { local?: string; remote?: string; base?: string } = {};
    
    // Load local content
    if (conflict.localState.exists) {
      const file = this.vault.getAbstractFileByPath(conflict.path);
      if (file instanceof TFile) {
        try {
          result.local = await this.vault.read(file);
        } catch (error) {
          this.logger.warn(`Failed to load local content for ${conflict.path}`, error);
        }
      }
    }
    
    // Remote and base content would be loaded from backends
    // This is handled by the SyncEngine
    
    return result;
  }

  /**
   * Get all active conflicts
   */
  getConflicts(): Conflict[] {
    return Array.from(this.conflicts.values()).filter(c => !c.resolvedAt);
  }

  /**
   * Get a specific conflict
   */
  getConflict(id: string): Conflict | undefined {
    return this.conflicts.get(id);
  }

  /**
   * Clear resolved conflicts
   */
  clearResolved(): number {
    let count = 0;
    for (const [id, conflict] of this.conflicts.entries()) {
      if (conflict.resolvedAt) {
        this.conflicts.delete(id);
        count++;
      }
    }
    return count;
  }

  /**
   * Persist conflicts to storage
   */
  async persist(store: any): Promise<void> {
    const conflictsData: Record<string, any> = {};
    for (const [id, conflict] of this.conflicts.entries()) {
      conflictsData[id] = conflictToStored(conflict);
    }
    store.set('conflicts', conflictsData);
  }

  /**
   * Load conflicts from storage
   */
  async load(store: any): Promise<void> {
    const conflictsData = store.get('conflicts');
    if (conflictsData) {
      for (const [id, data] of Object.entries(conflictsData)) {
        this.conflicts.set(id, storedToConflict(data as any));
      }
    }
  }
}

interface ManifestFileEntry {
  hash: string;
  size: number;
  mtime: number;
}
