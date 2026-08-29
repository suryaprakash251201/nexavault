import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ManifestManager } from '../core/ManifestManager';
import { HashManager } from '../core/HashManager';
import { TFile } from 'obsidian';
import { DEFAULT_SETTINGS } from '../models/Settings';

function makeFile(path: string, content: string, mtime = 5000) {
  const f = new TFile() as any;
  f.path = path;
  f.stat = { size: Buffer.byteLength(content), mtime, ctime: mtime };
  f._content = content;
  return f;
}

function makeVault(files: any[]) {
  const map = new Map(files.map(f => [f.path, f]));
  return {
    files,
    getAllLoadedFiles: vi.fn(() => files),
    readBinary: vi.fn(async (f: any) => Buffer.from(f._content || '')),
    getAbstractFileByPath: (p: string) => map.get(p) || null,
  };
}

function makeManager(vault: any) {
  const manager = new ManifestManager({ vault } as any, new HashManager(), {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  } as any);
  manager.setSettings(DEFAULT_SETTINGS);
  return manager;
}

describe('ManifestManager.computeVaultChanges', () => {
  it('returns create changes for all files on first scan (never-synced)', async () => {
    const manager = makeManager(makeVault([
      makeFile('Notes/a.md', 'hello a', 1000),
      makeFile('Notes/b.md', 'hello b', 1000),
      makeFile('img/p.png', 'fake-image-bytes', 1000),
    ]));
    manager.updateFileEntry = vi.fn(async () => {}); // avoid persist writes
    manager.store = null as any;

    const changes = await manager.computeVaultChanges();
    const creates = changes.filter(ch => ch.type === 'create');
    expect(creates.length).toBe(3);
    expect(creates.map(ch => ch.path).sort()).toEqual(['Notes/a.md', 'Notes/b.md', 'img/p.png']);
    expect(creates.every(ch => ch.backendTargets.includes('s3'))).toBe(true);
  });

  it('returns modify only for changed content and skips unchanged files', async () => {
    const file = makeFile('Notes/a.md', 'v1', 1000);
    const vault = makeVault([file]);
    const manager = makeManager(vault);
    manager.updateFileEntry = vi.fn(async () => {});
    manager.store = null as any;

    // Simulate an existing manifest with the OLD hash
    const oldHash = await new HashManager().hashData(new TextEncoder().encode('v1'));
    (manager as any).manifest = {
      version: 1, generatedAt: Date.now(), deviceId: 'test',
      files: { 'Notes/a.md': { hash: oldHash, size: 2, mtime: 1000 } },
      metadata: { totalFiles: 1, totalSize: 2, schemaVersion: 1 },
    };

    // Unchanged: size+mtime same, no stat change -> no changes
    let changes = await manager.computeVaultChanges();
    expect(changes.length).toBe(0);

    // Change content (size differs) -> modify
    file._content = 'v2 changed';
    file.stat.size = Buffer.byteLength(file._content);
    changes = await manager.computeVaultChanges();
    expect(changes.length).toBe(1);
    expect(changes[0].type).toBe('modify');
    expect(changes[0].path).toBe('Notes/a.md');
  });

  it('reports deletions for manifest paths missing from the vault', async () => {
    const file = makeFile('Notes/a.md', 'v1', 1000);
    const manager = makeManager(makeVault([file]));
    manager.updateFileEntry = vi.fn(async () => {});
    manager.store = null as any;
    const oldHash = await new HashManager().hashData(new TextEncoder().encode('v1'));
    (manager as any).manifest = {
      version: 1, generatedAt: Date.now(), deviceId: 'test',
      files: {
        'Notes/a.md': { hash: oldHash, size: 2, mtime: 1000 },
        'Notes/gone.md': { hash: 'deadbeef', size: 2, mtime: 1000 },
      },
      metadata: { totalFiles: 2, totalSize: 4, schemaVersion: 1 },
    };

    const changes = await manager.computeVaultChanges();
    const deletes = changes.filter(ch => ch.type === 'delete');
    expect(deletes.map(ch => ch.path)).toEqual(['Notes/gone.md']);
  });
});
