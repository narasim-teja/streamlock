/**
 * Storage providers for video content
 */

export type { StorageProvider, UploadFile } from './provider';
export { LocalStorageProvider, type LocalStorageConfig } from './local';
export { SupabaseStorageProvider, type SupabaseStorageConfig } from './supabase';
