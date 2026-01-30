/**
 * Storage provider initialization
 */

import { LocalStorageProvider, type StorageProvider } from '@streamlock/creator-sdk';

let storageProvider: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (storageProvider) {
    return storageProvider;
  }

  const provider = process.env.STORAGE_PROVIDER || 'local';

  if (provider === 'local') {
    const basePath = process.env.LOCAL_STORAGE_PATH || './storage';
    const baseUrl = process.env.LOCAL_STORAGE_URL || 'http://localhost:3000/storage';

    storageProvider = new LocalStorageProvider({
      basePath,
      baseUrl,
    });
  } else {
    throw new Error(`Unsupported storage provider: ${provider}`);
  }

  return storageProvider;
}
