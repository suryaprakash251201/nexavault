/**
 * VaultSyncSettings - Complete plugin settings
 */
export interface VaultSyncSettings {
  general: GeneralSettings;
  github: GitHubSettings;
  s3: S3Settings;
  encryption: EncryptionSettings;
  exclusions: ExclusionSettings;
  advanced: AdvancedSettings;
}

export interface GeneralSettings {
  enabled: boolean;
  autoSync: boolean;
  debounceMs: number;
  syncOnStartup: boolean;
  syncOnNetworkReconnect: boolean;
  periodicSyncEnabled: boolean;
  periodicSyncIntervalMinutes: number;
  maxConcurrentOperations: number;
  largeFileThresholdMB: number;
  showNotifications: boolean;
}

export interface GitHubSettings {
  enabled: boolean;
  repository: string; // "owner/repo"
  branch: string;
  syncPath: string; // Path within repo
  authMethod: 'token' | 'oauth';
  personalAccessToken?: string; // Encrypted
  commitMessageTemplate: string;
  pushIntervalMinutes: number;
  pullBeforePush: boolean;
  createPrForConflicts: boolean;
}

export interface S3Settings {
  enabled: boolean;
  provider: S3ProviderType;
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string; // Path prefix within bucket
  accessKeyId?: string; // Encrypted
  secretAccessKey?: string; // Encrypted
  sessionToken?: string; // Encrypted
  backupIntervalHours: number;
  retention: RetentionSettings;
  multipartThresholdMB: number;
  multipartChunksizeMB: number;
  /** Use path-style addressing (endpoint/bucket/key) instead of virtual-hosted (bucket.endpoint/key) */
  forcePathStyle: boolean;
  encryption?: EncryptionSettings;
}

export type S3ProviderType = 'aws' | 'r2' | 'b2' | 'minio' | 'custom';

export interface RetentionSettings {
  daily: number;
  weekly: number;
  monthly: number;
  maxTotalBackups: number;
}

export interface EncryptionSettings {
  enabled: boolean;
  algorithm: 'aes-256-gcm' | 'chacha20-poly1305';
  kdf: 'argon2id' | 'pbkdf2';
  kdfIterations: number;
  kdfMemory: number; // KB for Argon2
  kdfParallelism: number;
  // Password is never stored, only derived key verification hash
  keyVerificationHash?: string;
  salt?: string;
}

export interface ExclusionSettings {
  paths: string[]; // Exact paths or glob patterns
  patterns: string[]; // Glob patterns like "*.tmp", ".DS_Store"
  excludeObsidianWorkspace: boolean;
  excludeObsidianPlugins: boolean;
  excludeObsidianThemes: boolean;
}

export interface AdvancedSettings {
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  maxRetryAttempts: number;
  baseRetryDelayMs: number;
  maxRetryDelayMs: number;
  retryJitter: boolean;
  bandwidthLimitKbps: number; // 0 = unlimited
  verifyHashesAfterUpload: boolean;
  verifyHashesAfterDownload: boolean;
  enableRenameDetection: boolean;
  renameDetectionThreshold: number; // Similarity threshold 0-1
  deleteSafetyThreshold: number; // Warn if more than this many files deleted
  crashRecoveryEnabled: boolean;
  telemetryEnabled: boolean;
}

export interface ProviderConfig {
  name: string;
  type: S3ProviderType;
  defaultEndpoint: string;
  defaultRegion: string;
  requiresRegion: boolean;
  supportsPathStyle: boolean;
  supportsVersioning: boolean;
  supportsMultipart: boolean;
  maxFileSize: number;
  defaultMultipartThreshold: number;
  defaultMultipartChunksize: number;
  credentialFields: CredentialField[];
  setupInstructions: string;
}

export interface CredentialField {
  key: string;
  label: string;
  type: 'text' | 'password';
  required: boolean;
  placeholder?: string;
  description?: string;
}

export const DEFAULT_SETTINGS: VaultSyncSettings = {
  general: {
    enabled: true,
    autoSync: true,
    debounceMs: 3000,
    syncOnStartup: true,
    syncOnNetworkReconnect: true,
    periodicSyncEnabled: true,
    periodicSyncIntervalMinutes: 30,
    maxConcurrentOperations: 3,
    largeFileThresholdMB: 100,
    showNotifications: true,
  },
  github: {
    enabled: false,
    repository: '',
    branch: 'main',
    syncPath: 'vault',
    authMethod: 'token',
    commitMessageTemplate: 'vault: sync {count} files ({action})',
    pushIntervalMinutes: 10,
    pullBeforePush: true,
    createPrForConflicts: false,
  },
  s3: {
    enabled: false,
    provider: 'aws',
    endpoint: '',
    region: 'us-east-1',
    bucket: '',
    prefix: 'vault/',
    backupIntervalHours: 24,
    retention: {
      daily: 7,
      weekly: 4,
      monthly: 6,
      maxTotalBackups: 50,
    },
    multipartThresholdMB: 100,
    multipartChunksizeMB: 50,
    forcePathStyle: false,
  },
  encryption: {
    enabled: false,
    algorithm: 'aes-256-gcm',
    kdf: 'argon2id',
    kdfIterations: 3,
    kdfMemory: 65536, // 64 MB
    kdfParallelism: 4,
  },
  exclusions: {
    paths: [],
    patterns: ['*.tmp', '.DS_Store', 'Thumbs.db', '*.bak', '*.swp'],
    excludeObsidianWorkspace: true,
    excludeObsidianPlugins: false,
    excludeObsidianThemes: false,
  },
  advanced: {
    logLevel: 'info',
    maxRetryAttempts: 5,
    baseRetryDelayMs: 2000,
    maxRetryDelayMs: 60000,
    retryJitter: true,
    bandwidthLimitKbps: 0,
    verifyHashesAfterUpload: true,
    verifyHashesAfterDownload: true,
    enableRenameDetection: true,
    renameDetectionThreshold: 0.95,
    deleteSafetyThreshold: 50,
    crashRecoveryEnabled: true,
    telemetryEnabled: false,
  },
};

export const SETTINGS_VERSION = 1;

export function migrateSettings(oldSettings: any): VaultSyncSettings {
  // Future migrations will go here
  return { ...DEFAULT_SETTINGS, ...oldSettings };
}
