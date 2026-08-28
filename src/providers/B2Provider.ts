/**
 * B2Provider - Backblaze B2 provider configuration
 */

import { S3Provider } from './S3Provider';
import { ProviderConfig } from './S3Provider';
import { S3ProviderType } from '../models/Settings';

export class B2Provider extends S3Provider {
  getConfig(): ProviderConfig {
    return {
      name: 'Backblaze B2',
      type: 'b2' as S3ProviderType,
      defaultEndpoint: 'https://s3.us-west-004.backblazeb2.com',
      defaultRegion: 'us-west-004',
      requiresRegion: true,
      supportsPathStyle: true,
      supportsVersioning: true,
      supportsMultipart: true,
      maxFileSize: 5 * 1024 * 1024 * 1024,
      defaultMultipartThreshold: 100,
      defaultMultipartChunksize: 50,
      credentialFields: [
        {
          key: 'keyId',
          label: 'Key ID (applicationKeyId)',
          type: 'text',
          required: true,
          placeholder: '********************',
          description: 'Your B2 Application Key ID',
        },
        {
          key: 'applicationKey',
          label: 'Application Key',
          type: 'password',
          required: true,
          placeholder: '********************',
          description: 'Your B2 Application Key (secret)',
        },
      ],
      setupInstructions: `
1. Go to Backblaze B2 Console > App Keys
2. Create a new Application Key with "Read and Write" access to your bucket
3. Enter the Key ID (applicationKeyId) and Application Key
4. Select the appropriate region endpoint for your bucket
5. Enter your bucket name
      `.trim(),
    };
  }
}
