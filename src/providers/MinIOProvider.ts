/**
 * MinIOProvider - MinIO provider configuration
 */

import { S3Provider } from './S3Provider';
import { ProviderConfig } from './S3Provider';
import { S3ProviderType } from '../models/Settings';

export class MinIOProvider extends S3Provider {
  getConfig(): ProviderConfig {
    return {
      name: 'MinIO',
      type: 'minio' as S3ProviderType,
      defaultEndpoint: 'http://localhost:9000',
      defaultRegion: 'us-east-1',
      requiresRegion: true,
      supportsPathStyle: true,
      supportsVersioning: true,
      supportsMultipart: true,
      maxFileSize: 5 * 1024 * 1024 * 1024,
      defaultMultipartThreshold: 100,
      defaultMultipartChunksize: 50,
      credentialFields: [
        {
          key: 'accessKeyId',
          label: 'Access Key',
          type: 'text',
          required: true,
          placeholder: 'minioadmin',
          description: 'MinIO Access Key (default: minioadmin)',
        },
        {
          key: 'secretAccessKey',
          label: 'Secret Key',
          type: 'password',
          required: true,
          placeholder: 'minioadmin',
          description: 'MinIO Secret Key (default: minioadmin)',
        },
      ],
      setupInstructions: `
1. Start your MinIO server
2. Access the MinIO Console (default: http://localhost:9001)
3. Create an access key or use the default (minioadmin/minioadmin)
4. Create a bucket for your vault backups
5. Enter the endpoint URL, access key, secret key, and bucket name
6. For local MinIO, ensure "Use Path Style" is enabled
      `.trim(),
    };
  }
}
