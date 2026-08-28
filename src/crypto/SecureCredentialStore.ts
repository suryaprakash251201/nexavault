/**
 * SecureCredentialStore - Secure storage for credentials using Obsidian's plugin data
 * In a real implementation, this would use the system keychain/credential manager
 */

import { App, Plugin } from 'obsidian';
import { Logger } from '../utils/logger';
import { KeyDerivation } from './KeyDerivation';

const CREDENTIALS_KEY = 'vaultsync_credentials';

export class SecureCredentialStore {
  private app: App;
  private plugin: Plugin;
  private logger: Logger;
  private masterKey: CryptoKey | null = null;
  private initialized = false;
  private credentials: Map<string, string> = new Map();

  constructor(app: App, plugin: Plugin) {
    this.app = app;
    this.plugin = plugin;
    this.logger = new Logger('SecureCredentialStore');
  }

  async initialize(masterPassword?: string): Promise<void> {
    if (this.initialized) return;
    
    // Load encrypted credentials
    const data = await this.plugin.loadData();
    const encryptedCreds = data?.[CREDENTIALS_KEY];
    
    if (encryptedCreds && masterPassword) {
      // Try to decrypt with provided password
      await this.unlock(masterPassword, encryptedCreds);
    } else if (encryptedCreds) {
      // Store encrypted, will unlock later
      this.logger.debug('Credentials stored encrypted, awaiting unlock');
    }
    
    this.initialized = true;
  }

  async unlock(password: string, encryptedData?: string): Promise<boolean> {
    try {
      const data = encryptedData || (await this.plugin.loadData())?.[CREDENTIALS_KEY];
      if (!data) {
        this.logger.debug('No credentials to unlock');
        return true; // No credentials stored
      }
      
      // Derive key from password
      const keyMaterial = await KeyDerivation.deriveKeyArgon2id(password);
      this.masterKey = await crypto.subtle.importKey(
        'raw',
        keyMaterial.key,
        { name: 'AES-GCM' },
        false,
        ['encrypt', 'decrypt']
      );
      
      // Decrypt credentials
      const decrypted = await this.decryptData(data, keyMaterial.salt);
      const creds = JSON.parse(new TextDecoder().decode(decrypted));
      
      this.credentials = new Map(Object.entries(creds));
      this.initialized = true;
      
      this.logger.info('Credential store unlocked');
      return true;
    } catch (error) {
      this.logger.error('Failed to unlock credential store', error);
      return false;
    }
  }

  async lock(): Promise<void> {
    this.masterKey = null;
    this.credentials.clear();
    this.logger.info('Credential store locked');
  }

  isUnlocked(): boolean {
    return this.masterKey !== null;
  }

  async set(key: string, value: string): Promise<void> {
    if (!this.masterKey) {
      throw new Error('Credential store is locked');
    }
    
    this.credentials.set(key, value);
    await this.persist();
  }

  async get(key: string): Promise<string | undefined> {
    if (!this.masterKey) {
      throw new Error('Credential store is locked');
    }
    
    return this.credentials.get(key);
  }

  async delete(key: string): Promise<boolean> {
    if (!this.masterKey) {
      throw new Error('Credential store is locked');
    }
    
    const existed = this.credentials.delete(key);
    if (existed) {
      await this.persist();
    }
    return existed;
  }

  async has(key: string): Promise<boolean> {
    if (!this.masterKey) {
      throw new Error('Credential store is locked');
    }
    
    return this.credentials.has(key);
  }

  async listKeys(): Promise<string[]> {
    if (!this.masterKey) {
      throw new Error('Credential store is locked');
    }
    
    return Array.from(this.credentials.keys());
  }

  private async persist(): Promise<void> {
    if (!this.masterKey) {
      throw new Error('Credential store is locked');
    }
    
    const credsObj = Object.fromEntries(this.credentials);
    const data = new TextEncoder().encode(JSON.stringify(credsObj));
    const encrypted = await this.encryptData(data);
    
    const pluginData = await this.plugin.loadData() || {};
    pluginData[CREDENTIALS_KEY] = encrypted;
    await this.plugin.saveData(pluginData);
  }

  private async encryptData(data: Uint8Array): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const salt = crypto.getRandomValues(new Uint8Array(32));
    
    const encrypted = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv,
        tagLength: 128,
      },
      this.masterKey!,
      data as ArrayBufferView
    );
    
    const encryptedBytes = new Uint8Array(encrypted);
    const ciphertext = encryptedBytes.slice(0, -16);
    const tag = encryptedBytes.slice(-16);
    
    // Format: salt(32) + iv(12) + tag(16) + ciphertext
    const combined = new Uint8Array(salt.length + iv.length + tag.length + ciphertext.length);
    let offset = 0;
    combined.set(salt, offset); offset += salt.length;
    combined.set(iv, offset); offset += iv.length;
    combined.set(tag, offset); offset += tag.length;
    combined.set(ciphertext, offset);
    
    return btoa(String.fromCharCode(...combined));
  }

  private async decryptData(encryptedBase64: string, salt: Uint8Array): Promise<Uint8Array> {
    const combined = new Uint8Array(
      atob(encryptedBase64).split('').map(c => c.charCodeAt(0))
    );
    
    let offset = 0;
    const storedSalt = combined.slice(offset, offset + 32); offset += 32;
    const iv = combined.slice(offset, offset + 12); offset += 12;
    const tag = combined.slice(offset, offset + 16); offset += 16;
    const ciphertext = combined.slice(offset);
    
    // Verify salt matches
    if (!KeyDerivation.constantTimeEqual(storedSalt, salt)) {
      throw new Error('Salt mismatch - wrong password?');
    }
    
    const encryptedWithTag = new Uint8Array(ciphertext.length + tag.length);
    encryptedWithTag.set(ciphertext);
    encryptedWithTag.set(tag, ciphertext.length);
    
    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
        tagLength: 128,
      },
      this.masterKey!,
      encryptedWithTag as ArrayBufferView
    );
    
    return new Uint8Array(decrypted);
  }

  /**
   * Export credentials for backup (encrypted with a separate backup password)
   */
  async exportForBackup(backupPassword: string): Promise<string> {
    if (!this.masterKey) {
      throw new Error('Credential store is locked');
    }
    
    const credsObj = Object.fromEntries(this.credentials);
    const data = new TextEncoder().encode(JSON.stringify(credsObj));
    
    // Encrypt with backup password
    const keyMaterial = await KeyDerivation.deriveKeyArgon2id(backupPassword);
    const backupKey = await crypto.subtle.importKey(
      'raw',
      keyMaterial.key,
      { name: 'AES-GCM' },
      false,
      ['encrypt']
    );
    
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, tagLength: 128 },
      backupKey,
      data as ArrayBufferView
    );
    
    const encryptedBytes = new Uint8Array(encrypted);
    const ciphertext = encryptedBytes.slice(0, -16);
    const tag = encryptedBytes.slice(-16);
    
    const combined = new Uint8Array(
      keyMaterial.salt.length + iv.length + tag.length + ciphertext.length
    );
    let offset = 0;
    combined.set(keyMaterial.salt, offset); offset += keyMaterial.salt.length;
    combined.set(iv, offset); offset += iv.length;
    combined.set(tag, offset); offset += tag.length;
    combined.set(ciphertext, offset);
    
    return btoa(String.fromCharCode(...combined));
  }

  /**
   * Import credentials from backup
   */
  async importFromBackup(backupData: string, backupPassword: string): Promise<void> {
    const combined = new Uint8Array(
      atob(backupData).split('').map(c => c.charCodeAt(0))
    );
    
    let offset = 0;
    const salt = combined.slice(offset, offset + 32); offset += 32;
    const iv = combined.slice(offset, offset + 12); offset += 12;
    const tag = combined.slice(offset, offset + 16); offset += 16;
    const ciphertext = combined.slice(offset);
    
    const keyMaterial = await KeyDerivation.deriveKeyArgon2id(backupPassword, { salt });
    const backupKey = await crypto.subtle.importKey(
      'raw',
      keyMaterial.key,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );
    
    const encryptedWithTag = new Uint8Array(ciphertext.length + tag.length);
    encryptedWithTag.set(ciphertext);
    encryptedWithTag.set(tag, ciphertext.length);
    
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, tagLength: 128 },
      backupKey,
      encryptedWithTag as ArrayBufferView
    );
    
    const creds = JSON.parse(new TextDecoder().decode(decrypted));
    this.credentials = new Map(Object.entries(creds));
    
    // Re-encrypt with current master key if unlocked
    if (this.masterKey) {
      await this.persist();
    }
  }
}
