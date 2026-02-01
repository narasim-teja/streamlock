/**
 * Supabase client configuration
 * Uses lazy initialization to avoid build-time errors on Vercel
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Cached client instances
let supabaseClient: SupabaseClient | null = null;
let serviceRoleClient: SupabaseClient | null = null;

function getSupabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not configured');
  }
  return url;
}

function getSupabaseAnonKey(): string {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is not configured');
  }
  return key;
}

// Client-side Supabase client (uses anon key) - lazily initialized
export function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    supabaseClient = createClient(getSupabaseUrl(), getSupabaseAnonKey());
  }
  return supabaseClient;
}

// For backwards compatibility - lazy proxy
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return getSupabaseClient()[prop as keyof SupabaseClient];
  },
});

// Server-side Supabase client with service role key (for admin operations)
export function getServiceRoleClient(): SupabaseClient {
  if (serviceRoleClient) return serviceRoleClient;

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  }

  serviceRoleClient = createClient(getSupabaseUrl(), serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return serviceRoleClient;
}

// Storage bucket name for videos - lazily accessed
export function getStorageBucket(): string {
  return process.env.SUPABASE_STORAGE_BUCKET || 'videos';
}

// For backwards compatibility
export const STORAGE_BUCKET = new Proxy({ value: '' }, {
  get(_target, prop) {
    if (prop === 'toString' || prop === Symbol.toPrimitive) {
      return () => getStorageBucket();
    }
    return getStorageBucket();
  },
}) as unknown as string;

// Helper to get public URL for a storage path
export function getPublicUrl(path: string): string {
  const { data } = getSupabaseClient().storage.from(getStorageBucket()).getPublicUrl(path);
  return data.publicUrl;
}
