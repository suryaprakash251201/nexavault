import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EncryptionService } from '../crypto/EncryptionService';
import { SecureCredentialStore } from '../crypto/SecureCredentialStore';
import { EncryptionSettings } from '../models/Settings';

// Minimal stub plugin (only loadData/saveData used by the store)
function makeStubPlugin() {
  let data: any = {};
  return {
    loadData: vi.fn(async () => data),
    saveData: vi.fn(async (d: any) => { data = d; }),
    _getData: () => data,
  };
}

describe('EncryptionService', () => {
  it('should persist wrappedKey after password init and restore it without password', async () => {
    const settings: EncryptionSettings = {
      enabled: true,
      algorithm: 'aes-256-gcm',
      kdf: 'pbkdf2',
      kdfIterations: 1,
      kdfMemory: 1024,
      kdfParallelism: 1,
    };

    const svc = new EncryptionService({ ...settings });
    await svc.initialize('my-strong-password');

    const persisted = svc.getSettings();
    expect(persisted.salt).toBeTruthy();
    expect(persisted.keyVerificationHash).toBeTruthy();
    expect(persisted.wrappedKey).toBeTruthy();

    // New instance (simulating restart) initializes WITHOUT password:
    const restored = new EncryptionService({ ...persisted });
    await restored.initialize();
    expect(restored.isInitialized()).toBe(true);

    // Round-trip encrypt/decrypt across both instances
    const plaintext = new TextEncoder().encode('secret vault note content');
    const encrypted = await svc.encrypt(plaintext);
    const decrypted = await restored.decrypt(encrypted);
    expect(new TextDecoder().decode(decrypted)).toBe('secret vault note content');
  });

  it('should auto-bootstrap a machine-local key when no password is set (sync never blocks)', async () => {
    const settings: EncryptionSettings = {
      enabled: true,
      algorithm: 'aes-256-gcm',
      kdf: 'pbkdf2',
      kdfIterations: 1,
      kdfMemory: 1024,
      kdfParallelism: 1,
    };
    const svc = new EncryptionService({ ...settings });
    // No password, no persisted wrappedKey -> still initializes (bootstrap)
    await expect(svc.initialize()).resolves.toBeUndefined();
    expect(svc.isInitialized()).toBe(true);
    const persisted = svc.getSettings();
    expect(persisted.wrappedKey).toBeTruthy();
    expect(persisted.salt).toBeTruthy();
    expect(persisted.keyVerificationHash).toBeTruthy();

    // After bootstrap, init() with no password restores from wrappedKey
    const svc2 = new EncryptionService({ ...persisted });
    await svc2.initialize();
    expect(svc2.isInitialized()).toBe(true);

    // The two services can decrypt each other's ciphertext
    const plaintext = new TextEncoder().encode('hello bootstrap');
    const encrypted = await svc.encrypt(plaintext);
    const decrypted = await svc2.decrypt(encrypted);
    expect(new TextDecoder().decode(decrypted)).toBe('hello bootstrap');
  });

  it('should verify the correct password', async () => {
    const settings: EncryptionSettings = {
      enabled: true,
      algorithm: 'aes-256-gcm',
      kdf: 'pbkdf2',
      kdfIterations: 1,
      kdfMemory: 1024,
      kdfParallelism: 1,
    };
    const svc = new EncryptionService({ ...settings });
    await svc.initialize('correct-password');
    expect(await svc.verifyPassword('correct-password')).toBe(true);
    expect(await svc.verifyPassword('wrong-password')).toBe(false);
  });
});

describe('SecureCredentialStore', () => {
  it('should set/get/delete credentials round-trip', async () => {
    const plugin = makeStubPlugin();
    const store = new SecureCredentialStore({} as any, plugin as any);

    await store.initialize();
    expect(store.isUnlocked()).toBe(true);

    await store.set('s3_accessKeyId', 'AKIA123');
    await store.set('s3_secretAccessKey', 'super-secret');
    await store.set('github_token', 'ghp_test');

    expect(await store.get('s3_accessKeyId')).toBe('AKIA123');
    expect(await store.get('s3_secretAccessKey')).toBe('super-secret');
    expect(await store.get('github_token')).toBe('ghp_test');

    await store.delete('s3_secretAccessKey');
    expect(await store.get('s3_secretAccessKey')).toBeUndefined();

    await store.lock();
    expect(store.isUnlocked()).toBe(false);
    await expect(store.get('github_token')).rejects.toThrow(/locked/);
  });

  it('should persist across instances (re-init with stored machine key)', async () => {
    const plugin = makeStubPlugin();
    const store1 = new SecureCredentialStore({} as any, plugin as any);
    await store1.initialize();
    await store1.set('s3_accessKeyId', 'AKIA456');

    // Simulate restart: new store instance on same plugin data
    const plugin2 = makeStubPlugin();
    plugin2.loadData.mockImplementation(plugin.loadData);
    plugin2.saveData.mockImplementation(plugin.saveData);
    const store2 = new SecureCredentialStore({} as any, plugin2 as any);
    await store2.initialize();
    expect(await store2.get('s3_accessKeyId')).toBe('AKIA456');
  });
});
