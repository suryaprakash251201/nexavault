/**
 * StateStore - Persistent key-value storage using Obsidian's plugin data
 */

import { App, Plugin } from 'obsidian';
import { Logger } from '../utils/logger';

export interface StoredState {
  [key: string]: any;
}

export class StateStore {
  private app: App;
  private plugin: Plugin;
  private logger: Logger;
  private prefix: string;
  private cache: Map<string, any> = new Map();
  private dirty: Set<string> = new Set();
  private saveDebounce: NodeJS.Timeout | null = null;
  private readonly SAVE_DELAY = 1000;

  constructor(app: App, plugin: Plugin, prefix: string, logger: Logger) {
    this.app = app;
    this.plugin = plugin;
    this.prefix = prefix;
    this.logger = logger;
  }

  async initialize(): Promise<void> {
    // Load from plugin data
    const data = await this.plugin.loadData();
    if (data && data[this.prefix]) {
      this.cache = new Map(Object.entries(data[this.prefix]));
      this.logger.debug(`StateStore ${this.prefix}: Loaded ${this.cache.size} entries`);
    }
  }

  get<T>(key: string, defaultValue?: T): T | undefined {
    const fullKey = this.getFullKey(key);
    if (this.cache.has(fullKey)) {
      return this.cache.get(fullKey);
    }
    return defaultValue;
  }

  set(key: string, value: any): void {
    const fullKey = this.getFullKey(key);
    this.cache.set(fullKey, value);
    this.dirty.add(fullKey);
    this.scheduleSave();
  }

  delete(key: string): boolean {
    const fullKey = this.getFullKey(key);
    const existed = this.cache.delete(fullKey);
    if (existed) {
      this.dirty.add(fullKey);
      this.scheduleSave();
    }
    return existed;
  }

  has(key: string): boolean {
    const fullKey = this.getFullKey(key);
    return this.cache.has(fullKey);
  }

  keys(): string[] {
    const prefix = this.prefix + ':';
    return Array.from(this.cache.keys())
      .filter(k => k.startsWith(prefix))
      .map(k => k.slice(prefix.length));
  }

  clear(): void {
    const prefix = this.prefix + ':';
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        this.dirty.add(key);
      }
    }
    this.scheduleSave();
  }

  async persist(): Promise<void> {
    if (this.saveDebounce) {
      clearTimeout(this.saveDebounce);
      this.saveDebounce = null;
    }
    
    if (this.dirty.size === 0) return;
    
    try {
      const data = await this.plugin.loadData() || {};
      data[this.prefix] = Object.fromEntries(this.cache);
      await this.plugin.saveData(data);
      this.dirty.clear();
      this.logger.debug(`StateStore ${this.prefix}: Persisted ${this.cache.size} entries`);
    } catch (error) {
      this.logger.error(`StateStore ${this.prefix}: Failed to persist`, error);
      throw error;
    }
  }

  private scheduleSave(): void {
    if (this.saveDebounce) return;
    
    this.saveDebounce = setTimeout(() => {
      this.saveDebounce = null;
      this.persist().catch(err => this.logger.error('StateStore: Debounced save failed', err));
    }, this.SAVE_DELAY);
  }

  private getFullKey(key: string): string {
    return `${this.prefix}:${key}`;
  }

  // Batch operations
  setMultiple(entries: [string, any][]): void {
    for (const [key, value] of entries) {
      this.set(key, value);
    }
  }

  getMultiple<T>(keys: string[]): Map<string, T> {
    const result = new Map<string, T>();
    for (const key of keys) {
      const value = this.get<T>(key);
      if (value !== undefined) {
        result.set(key, value);
      }
    }
    return result;
  }
}

/**
 * ManifestStore - Specialized store for manifest data
 */
import { Manifest, ManifestFileEntry } from '../models/Manifest';

export class ManifestStore extends StateStore {
  private manifestKey = 'manifest';
  private deviceIdKey = 'deviceId';

  constructor(app: App, plugin: Plugin, logger: Logger) {
    super(app, plugin, 'manifest', logger);
  }

  async getManifest(): Promise<Manifest | null> {
    const data = this.get<any>(this.manifestKey);
    if (!data) return null;
    
    // Validate manifest structure
    if (!data.version || !data.files) {
      this.logger.warn('ManifestStore: Invalid manifest structure');
      return null;
    }
    
    return data as Manifest;
  }

  async setManifest(manifest: Manifest): Promise<void> {
    this.set(this.manifestKey, manifest);
  }

  async getDeviceId(): Promise<string | null> {
    return this.get<string>(this.deviceIdKey) || null;
  }

  async setDeviceId(deviceId: string): Promise<void> {
    this.set(this.deviceIdKey, deviceId);
  }

  async getFileEntry(path: string): Promise<ManifestFileEntry | null> {
    const manifest = await this.getManifest();
    if (!manifest) return null;
    return manifest.files[path] || null;
  }

  async setFileEntry(path: string, entry: ManifestFileEntry): Promise<void> {
    const manifest = await this.getManifest() || {
      version: 1,
      generatedAt: Date.now(),
      deviceId: await this.getDeviceId() || 'unknown',
      files: {},
      metadata: { totalFiles: 0, totalSize: 0, schemaVersion: 1 },
    };
    
    manifest.files[path] = entry;
    manifest.generatedAt = Date.now();
    await this.setManifest(manifest);
  }

  async deleteFileEntry(path: string): Promise<void> {
    const manifest = await this.getManifest();
    if (!manifest) return;
    
    delete manifest.files[path];
    manifest.generatedAt = Date.now();
    await this.setManifest(manifest);
  }
}
