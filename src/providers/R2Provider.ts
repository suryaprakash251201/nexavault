/**
 * R2Provider - Cloudflare R2 provider configuration
 */

import { S3Provider } from './S3Provider';
import { ProviderConfig } from './S3Provider';
import { S3ProviderType } from '../models/Settings';

export class R2Provider extends S3Provider {
  getConfig(): ProviderConfig {
    return {
      name: 'Cloudflare R2',
      type: 'r2' as S3ProviderType,
      defaultEndpoint: '', // Will be constructed from account ID
      defaultRegion: 'auto',
      requiresRegion: false,
      supportsPathStyle: true,
      supportsVersioning: false,
      supportsMultipart: true,
      maxFileSize: 5 * 1024 * 1024 * 1024,
      defaultMultipartThreshold: 100,
      defaultMultipartChunksize: 50,
      credentialFields: [
        {
          key: 'accountId',
          label: 'Account ID',
          type: 'text',
          required: true,
          placeholder: 'abcdef123456',
          description: 'Your Cloudflare Account ID (found in dashboard URL)',
        },
        {
          key: 'accessKeyId',
          label: 'Access Key ID',
          type: 'text',
          required: true,
          placeholder: '********************',
          description: 'R2 API Token Access Key ID',
        },
        {
          key: 'secretAccessKey',
          label: 'Secret Access Key',
          type: 'password',
          required: true,
          placeholder: '********************',
          description: 'R2 API Token Secret Access Key',
        },
      ],
      setupInstructions: `
1. Go to Cloudflare Dashboard > R2
2. Create an API token with "Object Read & Write" permissions
3. Note your Account ID (in the dashboard URL: dash.cloudflare.com/abcdef123456/r2)
4. Enter Account ID, Access Key ID, and Secret Access Key
5. The endpoint will be automatically configured as: https://<account-id>.r2.cloudflarestorage.com
      `.trim(),
    };
  }
}
