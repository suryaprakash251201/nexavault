/**
 * KeyDerivation - Key derivation utilities
 * Uses WebCrypto PBKDF2 (pure JS, works in Obsidian's renderer)
 * No native dependencies.
 */

export interface KDFParams {
  algorithm: 'argon2id' | 'pbkdf2';
  iterations: number;
  memory: number; // KB (kept for config compatibility with Argon2)
  parallelism: number;
  hashLength: number;
  salt?: Uint8Array;
}

export interface DerivedKey {
  key: Uint8Array;
  params: KDFParams;
  salt: Uint8Array;
}

export class KeyDerivation {
  static readonly DEFAULT_PBKDF2_PARAMS: KDFParams = {
    algorithm: 'pbkdf2',
    iterations: 100000,
    memory: 0,
    parallelism: 0,
    hashLength: 32,
  };

  /**
   * Derive a key from a password using PBKDF2-SHA256 (WebCrypto).
   * Argon2id is emulated with a high-iteration PBKDF2 when selected,
   * since native argon2 cannot run inside Obsidian.
   */
  static async deriveKeyArgon2id(
    password: string,
    params: Partial<KDFParams> = {}
  ): Promise<DerivedKey> {
    const finalParams = { ...this.DEFAULT_PBKDF2_PARAMS, ...params };
    
    const salt = finalParams.salt || crypto.getRandomValues(new Uint8Array(32));
    return this.deriveKeyPBKDF2(password, { ...finalParams, algorithm: 'pbkdf2' });
  }

  /**
   * Derive a key from a password using PBKDF2 (WebCrypto)
   */
  static async deriveKeyPBKDF2(
    password: string,
    params: Partial<KDFParams> = {}
  ): Promise<DerivedKey> {
    const finalParams = { ...this.DEFAULT_PBKDF2_PARAMS, ...params };
    
    const salt = finalParams.salt || crypto.getRandomValues(new Uint8Array(32));
    
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    );
    
    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: new Uint8Array(salt),
        iterations: finalParams.iterations,
        hash: 'SHA-256',
      },
      keyMaterial,
      finalParams.hashLength * 8
    );
    
    return {
      key: new Uint8Array(derivedBits),
      params: finalParams,
      salt,
    };
  }

  /**
   * Derive key using configured algorithm
   */
  static async deriveKey(
    password: string,
    params: KDFParams
  ): Promise<DerivedKey> {
    switch (params.algorithm) {
      case 'argon2id':
        // Argon2 emulation via PBKDF2 (no native deps in Obsidian)
        return this.deriveKeyPBKDF2(password, {
          ...params,
          algorithm: 'pbkdf2',
          iterations: Math.max(100000, params.iterations * 50000),
        });
      case 'pbkdf2':
        return this.deriveKeyPBKDF2(password, params);
      default:
        throw new Error(`Unsupported KDF algorithm: ${params.algorithm}`);
    }
  }

  /**
   * Verify a password against a stored hash
   */
  static async verifyPassword(
    password: string,
    hash: string,
    algorithm: 'argon2id' | 'pbkdf2' = 'pbkdf2'
  ): Promise<boolean> {
    try {
      // Stored hash format: base64(salt):base64(derivedKey)
      const [saltB64, keyB64] = hash.split(':');
      if (!saltB64 || !keyB64) return false;
      
      const salt = KeyDerivation.base64ToBytes(saltB64);
      const expected = KeyDerivation.base64ToBytes(keyB64);
      
      const derived = await this.deriveKeyPBKDF2(password, {
        salt,
        hashLength: expected.length,
      });
      
      return this.constantTimeEqual(derived.key, expected);
    } catch {
      return false;
    }
  }

  /**
   * Generate a secure random salt
   */
  static generateSalt(length = 32): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(length));
  }

  /**
   * Generate a secure random key
   */
  static generateKey(length = 32): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(length));
  }

  /**
   * Constant-time comparison of two byte arrays
   */
  static constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a[i] ^ b[i];
    }
    return result === 0;
  }

  static bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  static base64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}
