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

/**
 * Get the Aptos fullnode URL for the configured network
 */
export function getAptosFullnodeUrl(): string {
  switch (config.aptosNetwork) {
    case 'mainnet':
      return 'https://fullnode.mainnet.aptoslabs.com/v1';
    case 'devnet':
      return 'https://fullnode.devnet.aptoslabs.com/v1';
    case 'testnet':
    default:
      return 'https://fullnode.testnet.aptoslabs.com/v1';
  }
}

// Validate required config at import time
if (typeof window !== 'undefined') {
  if (!config.contractAddress) {
    throw new Error('NEXT_PUBLIC_CONTRACT_ADDRESS environment variable is required');
  }
}
