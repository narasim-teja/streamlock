/**
 * Supabase client configuration
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Client-side Supabase client (uses anon key)
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Server-side Supabase client with service role key (for admin operations)
let serviceRoleClient: SupabaseClient | null = null;

export function getServiceRoleClient(): SupabaseClient {
  if (serviceRoleClient) return serviceRoleClient;

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  }

  serviceRoleClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return serviceRoleClient;
}

// Storage bucket name for videos
export const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'videos';

// Helper to get public URL for a storage path
export function getPublicUrl(path: string): string {
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
