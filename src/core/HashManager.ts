/**
 * HashManager - SHA-256 hashing utility for file content
 */

export class HashManager {
  private cache = new Map<string, { hash: string; mtime: number; size: number }>();
  private maxCacheSize = 10000;

  /**
   * Compute SHA-256 hash of a Uint8Array
   */
  async hashData(data: Uint8Array): Promise<string> {
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    return this.bufferToHex(hashBuffer);
  }

  /**
   * Compute SHA-256 hash of a string
   */
  async hashString(str: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    return this.hashData(data);
  }

  /**
   * Compute SHA-256 hash of a file from Obsidian vault
   */
  async hashFile(file: File): Promise<string> {
    const arrayBuffer = await file.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);
    return this.hashData(data);
  }

  /**
   * Compute hash with caching based on mtime and size
   */
  async hashFileWithCache(
    path: string,
    data: Uint8Array,
    mtime: number,
    size: number
  ): Promise<string> {
    const cached = this.cache.get(path);
    
    if (cached && cached.mtime === mtime && cached.size === size) {
      return cached.hash;
    }
    
    const hash = await this.hashData(data);
    
    // Add to cache
    if (this.cache.size >= this.maxCacheSize) {
      // Remove oldest entries (simple LRU approximation)
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    
    this.cache.set(path, { hash, mtime, size });
    return hash;
  }

  /**
   * Verify data matches expected hash
   */
  async verifyHash(data: Uint8Array, expectedHash: string): Promise<boolean> {
    const actualHash = await this.hashData(data);
    return this.constantTimeCompare(actualHash, expectedHash);
  }

  /**
   * Constant-time string comparison to prevent timing attacks
   */
  private constantTimeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }

  /**
   * Convert ArrayBuffer to hex string
   */
  private bufferToHex(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let hex = '';
    for (const byte of bytes) {
      hex += byte.toString(16).padStart(2, '0');
    }
    return hex;
  }

  /**
   * Clear the hash cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Remove a specific path from cache
   */
  invalidateCache(path: string): void {
    this.cache.delete(path);
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; maxSize: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxCacheSize,
    };
  }
}

/**
 * Streaming hash for large files (if needed in future)
 */
export class StreamingHashManager {
  private hashManager: HashManager;
  private chunkSize: number;

  constructor(hashManager: HashManager, chunkSize = 1024 * 1024) { // 1MB chunks
    this.hashManager = hashManager;
    this.chunkSize = chunkSize;
  }

  async hashLargeFile(file: File, onProgress?: (progress: number) => void): Promise<string> {
    // For now, use regular hash - can be extended for true streaming
    return this.hashManager.hashFile(file);
  }
}
