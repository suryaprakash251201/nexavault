/**
 * AWSProvider - AWS S3 provider configuration
 */

import { S3Provider } from './S3Provider';
import { ProviderConfig, CredentialField } from './S3Provider';
import { S3ProviderType } from '../models/Settings';

export class AWSProvider extends S3Provider {
  getConfig(): ProviderConfig {
    return {
      name: 'AWS S3',
      type: 'aws' as S3ProviderType,
      defaultEndpoint: 'https://s3.amazonaws.com',
      defaultRegion: 'us-east-1',
      requiresRegion: true,
      supportsPathStyle: false,
      supportsVersioning: true,
      supportsMultipart: true,
      maxFileSize: 5 * 1024 * 1024 * 1024, // 5TB
      defaultMultipartThreshold: 100,
      defaultMultipartChunksize: 50,
      credentialFields: [
        {
          key: 'accessKeyId',
          label: 'Access Key ID',
          type: 'text',
          required: true,
          placeholder: 'AKIA...',
          description: 'Your AWS Access Key ID',
        },
        {
          key: 'secretAccessKey',
          label: 'Secret Access Key',
          type: 'password',
          required: true,
          placeholder: '********************',
          description: 'Your AWS Secret Access Key',
        },
        {
          key: 'sessionToken',
          label: 'Session Token (optional)',
          type: 'password',
          required: false,
          placeholder: 'Optional session token for temporary credentials',
          description: 'Required only for temporary credentials (STS)',
        },
      ],
      setupInstructions: `
1. Create an IAM user or role with S3 permissions
2. Attach a policy with at least these permissions:
   - s3:GetObject
   - s3:PutObject
   - s3:DeleteObject
   - s3:ListBucket
3. Generate Access Keys for the user
4. Enter the Access Key ID and Secret Access Key above
5. Optionally specify a bucket prefix to organize backups
      `.trim(),
    };
  }
}
