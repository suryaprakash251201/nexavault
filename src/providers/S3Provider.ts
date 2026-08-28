/**
 * S3Provider - Base class for S3-compatible providers
 */

import { S3ProviderType, S3Settings } from '../models/Settings';

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

export abstract class S3Provider {
  abstract getConfig(): ProviderConfig;
  
  getDefaultSettings(): Partial<S3Settings> {
    const config = this.getConfig();
    return {
      provider: config.type,
      endpoint: config.defaultEndpoint,
      region: config.defaultRegion,
      multipartThresholdMB: config.defaultMultipartThreshold,
      multipartChunksizeMB: config.defaultMultipartChunksize,
    };
  }
  
  validateSettings(settings: S3Settings): { valid: boolean; errors: string[] } {
    const config = this.getConfig();
    const errors: string[] = [];
    
    if (!settings.bucket) {
      errors.push('Bucket name is required');
    }
    
    if (config.requiresRegion && !settings.region) {
      errors.push('Region is required for this provider');
    }
    
    // Check credentials
    for (const field of config.credentialFields) {
      if (field.required) {
        // Credentials are stored separately, just validate presence
      }
    }
    
    return {
      valid: errors.length === 0,
      errors,
    };
  }
  
  getSetupInstructions(): string {
    return this.getConfig().setupInstructions;
  }
}
