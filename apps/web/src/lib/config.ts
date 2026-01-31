/**
 * Client-side configuration
 * These values are exposed to the browser at build time
 */

export const config = {
  contractAddress: process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || '',
  aptosNetwork: process.env.NEXT_PUBLIC_APTOS_NETWORK || 'testnet',
  keyServerUrl: process.env.NEXT_PUBLIC_KEY_SERVER_URL || '/api',
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
} as const;

// Validate required config at import time (development warning)
if (typeof window !== 'undefined' && !config.contractAddress) {
  console.warn('NEXT_PUBLIC_CONTRACT_ADDRESS is not set');
}
