export * from './S3Provider';
export { AWSProvider } from './AWSProvider';
export { R2Provider } from './R2Provider';
export { B2Provider } from './B2Provider';
export { MinIOProvider } from './MinIOProvider';

import { S3Provider } from './S3Provider';
import { AWSProvider } from './AWSProvider';
import { R2Provider } from './R2Provider';
import { B2Provider } from './B2Provider';
import { MinIOProvider } from './MinIOProvider';
import { S3ProviderType, ProviderConfig } from '../models/Settings';

const providers = new Map<S3ProviderType, S3Provider>([
  ['aws', new AWSProvider()],
  ['r2', new R2Provider()],
  ['b2', new B2Provider()],
  ['minio', new MinIOProvider()],
]);

export function getProvider(type: S3ProviderType): S3Provider {
  return providers.get(type) || providers.get('aws')!;
}

export function getAllProviders(): S3Provider[] {
  return Array.from(providers.values());
}

export function getProviderConfigs(): ProviderConfig[] {
  return Array.from(providers.values()).map(p => p.getConfig());
}
