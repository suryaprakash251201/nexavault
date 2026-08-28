import { FileState } from './FileState';

/**
 * Manifest - Represents the complete state of the vault at a point in time
 */
export interface Manifest {
  version: number;
  generatedAt: number;
  deviceId: string;
  files: ManifestFileMap;
  metadata: ManifestMetadata;
}

export interface ManifestFileMap {
  [path: string]: ManifestFileEntry;
}

export interface ManifestFileEntry {
  hash: string;
  size: number;
  mtime: number;
  lastSyncedHash?: string;
  lastSyncedAt?: number;
  backendStates?: BackendFileState[];
}

export interface BackendFileState {
  backendId: string;
  hash: string;
  syncedAt: number;
  remotePath?: string;
  etag?: string;
  versionId?: string;
}

export interface ManifestMetadata {
  totalFiles: number;
  totalSize: number;
  lastFullSync?: number;
  schemaVersion: number;
}

export const MANIFEST_SCHEMA_VERSION = 1;
export const MANIFEST_CURRENT_VERSION = 1;

/**
 * RemoteManifest - Manifest fetched from a remote backend
 */
export interface RemoteManifest {
  backendId: string;
  manifest: Manifest;
  fetchedAt: number;
}

/**
 * ManifestDiff - Difference between two manifests
 */
export interface ManifestDiff {
  created: string[];
  modified: string[];
  deleted: string[];
  renamed: RenameEntry[];
  unchanged: string[];
}

export interface RenameEntry {
  oldPath: string;
  newPath: string;
  hash: string;
}

/**
 * ManifestMigration - For future schema migrations
 */
export interface ManifestMigration {
  fromVersion: number;
  toVersion: number;
  migrate: (manifest: any) => Manifest;
}

export const MANIFEST_MIGRATIONS: ManifestMigration[] = [
  // Future migrations will be added here
];

export function migrateManifest(manifest: any): Manifest {
  let current = manifest;
  for (const migration of MANIFEST_MIGRATIONS) {
    if (current.version === migration.fromVersion) {
      current = migration.migrate(current);
    }
  }
  return current as Manifest;
}

export function createEmptyManifest(deviceId: string): Manifest {
  return {
    version: MANIFEST_CURRENT_VERSION,
    generatedAt: Date.now(),
    deviceId,
    files: {},
    metadata: {
      totalFiles: 0,
      totalSize: 0,
      schemaVersion: MANIFEST_SCHEMA_VERSION,
    },
  };
}

export function calculateManifestMetadata(files: ManifestFileMap): ManifestMetadata {
  let totalFiles = 0;
  let totalSize = 0;
  
  for (const entry of Object.values(files)) {
    totalFiles++;
    totalSize += entry.size;
  }
  
  return {
    totalFiles,
    totalSize,
    schemaVersion: MANIFEST_SCHEMA_VERSION,
  };
}
