import { describe, it, expect, beforeEach } from 'vitest';
import { HashManager } from '../core/HashManager';

describe('HashManager', () => {
  let hashManager: HashManager;

  beforeEach(() => {
    hashManager = new HashManager();
  });

  it('should compute SHA-256 hash of string', async () => {
    const hash = await hashManager.hashString('hello world');
    expect(hash).toHaveLength(64); // SHA-256 = 64 hex chars
    expect(hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
  });

  it('should compute SHA-256 hash of Uint8Array', async () => {
    const data = new TextEncoder().encode('test');
    const hash = await hashManager.hashData(data);
    expect(hash).toHaveLength(64);
  });

  it('should verify hash correctly', async () => {
    const data = new TextEncoder().encode('verify test');
    const hash = await hashManager.hashData(data);
    const isValid = await hashManager.verifyHash(data, hash);
    expect(isValid).toBe(true);
  });

  it('should reject invalid hash', async () => {
    const data = new TextEncoder().encode('verify test');
    const isValid = await hashManager.verifyHash(data, 'invalid_hash');
    expect(isValid).toBe(false);
  });

  it('should cache hashes based on mtime and size', async () => {
    const path = 'test.txt';
    const data = new TextEncoder().encode('cached content');
    const mtime = Date.now();
    const size = data.length;
    
    // First call - computes hash
    const hash1 = await hashManager.hashFileWithCache(path, data, mtime, size);
    
    // Second call with same mtime/size - should use cache
    const hash2 = await hashManager.hashFileWithCache(path, data, mtime, size);
    
    expect(hash1).toBe(hash2);
    
    // Different mtime - should recompute
    const hash3 = await hashManager.hashFileWithCache(path, data, mtime + 1000, size);
    expect(hash3).toBe(hash1); // Same content, same hash
  });

  it('should clear cache', async () => {
    const path = 'test.txt';
    const data = new TextEncoder().encode('content');
    const mtime = Date.now();
    const size = data.length;
    
    await hashManager.hashFileWithCache(path, data, mtime, size);
    hashManager.clearCache();
    
    const stats = hashManager.getCacheStats();
    expect(stats.size).toBe(0);
  });
});
