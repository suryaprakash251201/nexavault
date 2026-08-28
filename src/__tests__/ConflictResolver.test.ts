import { describe, it, expect, beforeEach, vi } from 'vitest';

import { ConflictResolver } from '../core/ConflictResolver';
import { HashManager } from '../core/HashManager';

function fileState(hash: string, mtime = 1000) {
  return { path: 'a.md', hash, size: 10, mtime, lastSyncedHash: null, lastSyncedAt: null, backendStates: [] as any[] };
}

describe('ConflictResolver - first sync semantics', () => {
  let resolver: any;
  let manifestManager: any;

  beforeEach(() => {
    manifestManager = { getFileEntry: vi.fn() };
    resolver = new ConflictResolver({} as any, { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });
    resolver.setDependencies(manifestManager, new HashManager());
  });

  it('should NOT conflict on local-only files that were never synced (fresh bucket)', async () => {
    // First sync: local file exists, remote empty, manifest entry exists but never synced
    manifestManager.getFileEntry.mockReturnValue({ hash: 'h1', size: 10, mtime: 1000, lastSyncedHash: null });
    const local = new Map([['a.md', fileState('h1')]]);
    const remote = new Map();
    const result = await resolver.detectConflicts(local, remote);
    expect(result.hasConflicts).toBe(false);
    expect(result.conflicts).toHaveLength(0);
  });

  it('should conflict on local-only files that WERE synced before (remote deleted)', async () => {
    manifestManager.getFileEntry.mockReturnValue({ hash: 'h1', size: 10, mtime: 1000, lastSyncedHash: 'h1' });
    const local = new Map([['a.md', fileState('h1')]]);
    const remote = new Map();
    const result = await resolver.detectConflicts(local, remote);
    expect(result.hasConflicts).toBe(true);
    expect(result.conflicts[0].type).toBe('local_modified_remote_deleted');
  });

  it('should NOT conflict on remote-only files never seen locally (safe download)', async () => {
    manifestManager.getFileEntry.mockReturnValue(undefined);
    const local = new Map();
    const remote = new Map([['a.md', fileState('h2')]]);
    const result = await resolver.detectConflicts(local, remote);
    expect(result.hasConflicts).toBe(false);
    expect(result.safeChanges).toContain('a.md');
  });

  it('should conflict when both modified from a synced base', async () => {
    manifestManager.getFileEntry.mockReturnValue({ hash: 'h0', size: 10, mtime: 900, lastSyncedHash: 'h0' });
    const local = new Map([['a.md', fileState('h1', 2000)]]);
    const remote = new Map([['a.md', fileState('h2', 2000)]]);
    const result = await resolver.detectConflicts(local, remote);
    expect(result.hasConflicts).toBe(true);
    expect(result.conflicts[0].type).toBe('both_modified');
  });
});
