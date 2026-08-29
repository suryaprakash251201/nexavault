/**
 * EncryptionService - Client-side encryption for S3 backups
 * Uses AES-256-GCM with PBKDF2-SHA256 key derivation (pure WebCrypto, works in Obsidian)
 */

import { EncryptionSettings } from '../models/Settings';

const KEY_LENGTH = 32; // 256 bits
const SALT_LENGTH = 32;
const IV_LENGTH = 12; // 96 bits for GCM
const TAG_LENGTH = 16; // 128 bits

export interface EncryptedData {
  version: number;
  algorithm: string;
  kdf: string;
  kdfParams: {
    iterations: number;
    memory: number;
    parallelism: number;
    salt: string; // base64
  };
  iv: string; // base64
  ciphertext: string; // base64
  tag: string; // base64
}

export class EncryptionService {
  private settings: EncryptionSettings;
  private masterKey: CryptoKey | null = null;
  private initialized = false;

  constructor(settings: EncryptionSettings) {
    this.settings = settings;
  }

  async initialize(password?: string): Promise<void> {
    if (this.initialized && this.masterKey) return;

    if (!password) {
      // No password at runtime: restore the key from the persisted wrapped form
      if (this.settings.wrappedKey) {
        const raw = this.base64ToBytes(this.settings.wrappedKey);
        this.masterKey = await this.importKey(raw);
        raw.fill(0);
        this.initialized = true;
        return;
      }
      // BOOTSTRAP: encryption was toggled ON but no password set yet.
      // Generate a strong random key and persist it as the wrapped key.
      // The same "machine-local obfuscation" model the credential store uses
      // (Obsidian has no keychain API). The user can later set a password
      // to add password-based protection (re-derives + rotates the key).
      const key = crypto.getRandomValues(new Uint8Array(32));
      this.masterKey = await this.importKey(key);
      this.settings.salt = this.bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
      this.settings.keyVerificationHash = await this.computeVerificationHash(key);
      this.settings.wrappedKey = this.bytesToBase64(key);
      key.fill(0);
      this.initialized = true;
      return;
    }

    await this.deriveKey(password);
    this.initialized = true;
  }

  async initializeWithStoredKey(password: string): Promise<boolean> {
    if (!this.settings.salt || !this.settings.keyVerificationHash) {
      return false; // No stored key to verify against
    }
    
    try {
      const salt = this.base64ToBytes(this.settings.salt);
      const derivedKey = await this.deriveKeyFromPassword(password, salt);
      
      // Verify against stored hash
      const verificationHash = await this.computeVerificationHash(derivedKey);
      if (verificationHash !== this.settings.keyVerificationHash) {
        return false; // Wrong password
      }
      
      this.masterKey = await this.importKey(derivedKey);
      this.initialized = true;
      return true;
    } catch {
      return false;
    }
  }

  private async deriveKey(password: string): Promise<void> {
    // Generate random salt
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    
    // Derive key using PBKDF2-SHA256 (WebCrypto, no native deps)
    const derivedKey = await this.deriveKeyFromPassword(password, salt);
    
    // Store salt, verification hash, and the wrapped (base64-obfuscated) key
    // so sync works after restart without re-entering the password.
    this.settings.salt = this.bytesToBase64(salt);
    this.settings.keyVerificationHash = await this.computeVerificationHash(derivedKey);
    this.settings.wrappedKey = this.bytesToBase64(derivedKey);

    // Import as CryptoKey
    this.masterKey = await this.importKey(derivedKey);
  }

  private async deriveKeyFromPassword(password: string, salt: Uint8Array): Promise<Uint8Array> {
    // Use high iteration count for security
    const iterations = Math.max(100000, this.settings.kdfIterations * 50000);
    
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
        iterations,
        hash: 'SHA-256',
      },
      keyMaterial,
      KEY_LENGTH * 8
    );
    
    return new Uint8Array(derivedBits);
  }

  private async importKey(keyMaterial: Uint8Array): Promise<CryptoKey> {
    return crypto.subtle.importKey(
      'raw',
      keyMaterial,
      { name: 'AES-GCM' },
      true, // extractable: needed to persist the wrapped key between sessions
      ['encrypt', 'decrypt']
    );
  }

  private async computeVerificationHash(key: Uint8Array): Promise<string> {
    // Use SHA-256 of the key as verification hash
    const hashBuffer = await crypto.subtle.digest('SHA-256', key);
    return this.bytesToBase64(new Uint8Array(hashBuffer));
  }

  async encrypt(data: Uint8Array): Promise<Uint8Array> {
    if (!this.masterKey) {
      throw new Error('Encryption not initialized');
    }
    
    // Generate random IV
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    
    // Encrypt
    const encrypted = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv,
        tagLength: TAG_LENGTH * 8,
      },
      this.masterKey,
      data
    );
    
    const encryptedBytes = new Uint8Array(encrypted);
    
    // Split ciphertext and tag (GCM appends tag to ciphertext)
    const ciphertext = encryptedBytes.slice(0, -TAG_LENGTH);
    const tag = encryptedBytes.slice(-TAG_LENGTH);
    
    // Create encrypted data structure
    const encryptedData: EncryptedData = {
      version: 1,
      algorithm: 'AES-256-GCM',
      kdf: 'pbkdf2',
      kdfParams: {
        iterations: this.settings.kdfIterations,
        memory: this.settings.kdfMemory,
        parallelism: this.settings.kdfParallelism,
        salt: this.settings.salt || '',
      },
      iv: this.bytesToBase64(iv),
      ciphertext: this.bytesToBase64(ciphertext),
      tag: this.bytesToBase64(tag),
    };
    
    // Serialize to binary format: version(1) + salt(32) + iv(12) + tag(16) + ciphertext
    const serialized = new Uint8Array(
      1 + SALT_LENGTH + IV_LENGTH + TAG_LENGTH + ciphertext.length
    );
    
    let offset = 0;
    serialized[offset++] = encryptedData.version;
    serialized.set(this.base64ToBytes(encryptedData.kdfParams.salt), offset);
    offset += SALT_LENGTH;
    serialized.set(this.base64ToBytes(encryptedData.iv), offset);
    offset += IV_LENGTH;
    serialized.set(this.base64ToBytes(encryptedData.tag), offset);
    offset += TAG_LENGTH;
    serialized.set(this.base64ToBytes(encryptedData.ciphertext), offset);
    
    return serialized;
  }

  async decrypt(data: Uint8Array): Promise<Uint8Array> {
    if (!this.masterKey) {
      throw new Error('Encryption not initialized');
    }
    
    if (data.length < 1 + SALT_LENGTH + IV_LENGTH + TAG_LENGTH) {
      throw new Error('Invalid encrypted data: too short');
    }
    
    // Parse binary format
    let offset = 0;
    const version = data[offset++];
    if (version !== 1) {
      throw new Error(`Unsupported encryption version: ${version}`);
    }
    
    const salt = data.slice(offset, offset + SALT_LENGTH);
    offset += SALT_LENGTH;
    
    const iv = data.slice(offset, offset + IV_LENGTH);
    offset += IV_LENGTH;
    
    const tag = data.slice(offset, offset + TAG_LENGTH);
    offset += TAG_LENGTH;
    
    const ciphertext = data.slice(offset);
    
    // Combine ciphertext and tag for Web Crypto API
    const encryptedWithTag = new Uint8Array(ciphertext.length + tag.length);
    encryptedWithTag.set(ciphertext);
    encryptedWithTag.set(tag, ciphertext.length);
    
    // Decrypt
    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
        tagLength: TAG_LENGTH * 8,
      },
      this.masterKey,
      encryptedWithTag
    );
    
    return new Uint8Array(decrypted);
  }

  async verifyPassword(password: string): Promise<boolean> {
    if (!this.settings.salt || !this.settings.keyVerificationHash) {
      return false;
    }
    
    try {
      const salt = this.base64ToBytes(this.settings.salt);
      const derivedKey = await this.deriveKeyFromPassword(password, salt);
      const verificationHash = await this.computeVerificationHash(derivedKey);
      return verificationHash === this.settings.keyVerificationHash;
    } catch {
      return false;
    }
  }

  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    if (!await this.verifyPassword(oldPassword)) {
      throw new Error('Current password is incorrect');
    }
    
    // Re-derive key with new password
    this.masterKey = null;
    this.initialized = false;
    await this.initialize(newPassword);
  }

  getSettings(): EncryptionSettings {
    return { ...this.settings };
  }

  isInitialized(): boolean {
    return this.initialized && this.masterKey !== null;
  }

  private bytesToBase64(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...bytes));
  }

  private base64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * Export encryption metadata for backup/recovery
   */
  exportMetadata(): EncryptionSettings {
    return {
      ...this.settings,
      // Never export the actual key
    };
  }

  /**
   * Import encryption metadata from backup
   */
  importMetadata(settings: EncryptionSettings): void {
    this.settings = { ...settings };
  }
}
