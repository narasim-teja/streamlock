/**
 * Storage provider initialization
 */

import {
  LocalStorageProvider,
  SupabaseStorageProvider,
  type StorageProvider,
} from '@streamlock/creator-sdk';

let storageProvider: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (storageProvider) {
    return storageProvider;
  }

  const provider = process.env.STORAGE_PROVIDER || 'local';

  if (provider === 'supabase') {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const bucketName = process.env.SUPABASE_STORAGE_BUCKET || 'videos';

    if (!supabaseUrl || !supabaseKey) {
      throw new Error(
        'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for Supabase storage'
      );
    }

    storageProvider = new SupabaseStorageProvider({
      supabaseUrl,
      supabaseKey,
      bucketName,
    });
  } else if (provider === 'local') {
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
