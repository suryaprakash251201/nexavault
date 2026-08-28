/**
 * SyncBackend - Abstract interface for sync backends
 */

import { Manifest } from '../models/Manifest';
import { Change } from '../models/Change';
import { RemoteChange } from '../models/SyncResult';

export interface SyncBackend {
  getId(): string;
  getName(): string;
  
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  testConnection(): Promise<boolean>;
  
  getRemoteManifest(): Promise<Manifest>;
  
  uploadFile(path: string, data: Uint8Array): Promise<{ etag?: string; versionId?: string }>;
  downloadFile(path: string): Promise<Uint8Array>;
  deleteFile(path: string): Promise<void>;
  listFiles(prefix?: string): Promise<RemoteFile[]>;
  
  pushChanges(changes: Change[]): Promise<void>;
  pullChanges(): Promise<RemoteChange[]>;
  
  // Configuration
  updateConfig(config: any): void;
  getConfig(): any;
}

export interface RemoteFile {
  path: string;
  size: number;
  mtime: number;
  etag?: string;
  versionId?: string;
  isDirectory?: boolean;
}

export interface BackendCapabilities {
  supportsVersioning: boolean;
  supportsMultipart: boolean;
  maxFileSize: number;
  maxPartSize: number;
  supportsEncryption: boolean;
  supportsRename: boolean;
  supportsBatchOperations: boolean;
}

export abstract class BaseSyncBackend implements SyncBackend {
  protected config: any;
  protected logger: any;
  protected connected = false;

  constructor(config: any, logger: any) {
    this.config = config;
    this.logger = logger;
  }

  abstract getId(): string;
  abstract getName(): string;
  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract testConnection(): Promise<boolean>;
  abstract getRemoteManifest(): Promise<Manifest>;
  abstract uploadFile(path: string, data: Uint8Array): Promise<{ etag?: string; versionId?: string }>;
  abstract downloadFile(path: string): Promise<Uint8Array>;
  abstract deleteFile(path: string): Promise<void>;
  abstract listFiles(prefix?: string): Promise<RemoteFile[]>;
  abstract pushChanges(changes: Change[]): Promise<void>;
  abstract pullChanges(): Promise<RemoteChange[]>;

  updateConfig(config: any): void {
    this.config = config;
  }

  getConfig(): any {
    return this.config;
  }

  isConnected(): boolean {
    return this.connected;
  }

  protected setConnected(connected: boolean): void {
    this.connected = connected;
  }

  getCapabilities(): BackendCapabilities {
    return {
      supportsVersioning: false,
      supportsMultipart: false,
      maxFileSize: 5 * 1024 * 1024 * 1024, // 5GB default
      maxPartSize: 5 * 1024 * 1024 * 1024,
      supportsEncryption: false,
      supportsRename: false,
      supportsBatchOperations: false,
    };
  }
}
