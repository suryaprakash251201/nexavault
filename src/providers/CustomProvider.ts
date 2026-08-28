/**
 * CustomProvider - Generic S3-compatible endpoint (e.g. CloudPE, Wasabi, OVH, Scaleway)
 */

import { S3Provider } from './S3Provider';
import { ProviderConfig } from './S3Provider';
import { S3ProviderType } from '../models/Settings';

export class CustomProvider extends S3Provider {
  getConfig(): ProviderConfig {
    return {
      name: 'Custom S3-Compatible',
      type: 'custom' as S3ProviderType,
      defaultEndpoint: '',
      defaultRegion: 'us-east-1',
      requiresRegion: false,
      supportsPathStyle: true,
      supportsVersioning: true,
      supportsMultipart: true,
      maxFileSize: 5 * 1024 * 1024 * 1024,
      defaultMultipartThreshold: 100,
      defaultMultipartChunksize: 50,
      credentialFields: [
        {
          key: 'accessKeyId',
          label: 'Access Key ID',
          type: 'text',
          required: true,
          placeholder: 'AKIA...',
          description: 'Your S3 access key ID',
        },
        {
          key: 'secretAccessKey',
          label: 'Secret Access Key',
          type: 'password',
          required: true,
          placeholder: '********************',
          description: 'Your S3 secret access key',
        },
      ],
      setupInstructions: `
1. Enter the endpoint URL of your S3-compatible service
   (e.g. https://s3.cloudpe.com or your MinIO/Wasabi/Scaleway URL)
2. Enter Access Key ID and Secret Access Key
3. Create/use a bucket, then enter its name
4. If your service requires it, enable "Path-style addressing"
   (endpoint/bucket/key format) - most non-AWS services do.
      `.trim(),
    };
  }
}
