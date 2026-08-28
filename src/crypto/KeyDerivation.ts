/**
 * KeyDerivation - Key derivation utilities
 */

import * as argon2 from 'argon2';

export interface KDFParams {
  algorithm: 'argon2id' | 'pbkdf2';
  iterations: number;
  memory: number; // KB for Argon2
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
  static readonly DEFAULT_ARGON2_PARAMS: KDFParams = {
    algorithm: 'argon2id',
    iterations: 3,
    memory: 65536, // 64 MB
    parallelism: 4,
    hashLength: 32,
  };

  static readonly DEFAULT_PBKDF2_PARAMS: KDFParams = {
    algorithm: 'pbkdf2',
    iterations: 100000,
    memory: 0,
    parallelism: 0,
    hashLength: 32,
  };

  /**
   * Derive a key from a password using Argon2id
   */
  static async deriveKeyArgon2id(
    password: string,
    params: Partial<KDFParams> = {}
  ): Promise<DerivedKey> {
    const finalParams = { ...this.DEFAULT_ARGON2_PARAMS, ...params };
    
    const salt = finalParams.salt || crypto.getRandomValues(new Uint8Array(32));
    
    const hash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: finalParams.memory,
      timeCost: finalParams.iterations,
      parallelism: finalParams.parallelism,
      hashLength: finalParams.hashLength,
      salt: Buffer.from(salt),
      raw: true,
    });
    
    return {
      key: new Uint8Array(hash),
      params: finalParams,
      salt,
    };
  }

  /**
   * Derive a key from a password using PBKDF2
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
        return this.deriveKeyArgon2id(password, params);
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
    algorithm: 'argon2id' | 'pbkdf2' = 'argon2id'
  ): Promise<boolean> {
    try {
      if (algorithm === 'argon2id') {
        return await argon2.verify(hash, password);
      } else {
        // For PBKDF2, we'd need to store parameters separately
        // This is a simplified version
        return false;
      }
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
}
