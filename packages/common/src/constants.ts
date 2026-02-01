/**
 * Protocol constants
 */

/** StreamLock protocol version */
export const PROTOCOL_VERSION = 1;

/** x402 version */
export const X402_VERSION = 1;

/** Default segment duration in seconds */
export const DEFAULT_SEGMENT_DURATION = 5;

/** Default prepaid segments for new sessions */
export const DEFAULT_PREPAID_SEGMENTS = 20;

/** Default top-up threshold (segments remaining before auto top-up) */
export const DEFAULT_TOPUP_THRESHOLD = 5;

/** Session expiry duration in seconds (2 hours) */
export const SESSION_EXPIRY_SECONDS = 7200;

/** Minimum segment price in USDC micro-units (0.0001 USDC = 100 units) */
export const MIN_SEGMENT_PRICE_USDC = 100n;

/** USDC micro-units per USDC (6 decimals) */
export const USDC_UNITS_PER_USDC = 1_000_000n;

/** Octas per APT (for gas calculations) */
export const OCTAS_PER_APT = 100_000_000n;

/** HKDF salt for key derivation */
export const HKDF_SALT = 'streamlock-v1';

/** HKDF info prefix for segment keys */
export const HKDF_INFO_KEY = 'segment-key';

/** HKDF info prefix for segment IVs */
export const HKDF_INFO_IV = 'segment-iv';

/** AES key length in bytes (128 bits) */
export const AES_KEY_LENGTH = 16;

/** AES IV length in bytes (128 bits) */
export const AES_IV_LENGTH = 16;

/** Master secret length in bytes (256 bits) */
export const MASTER_SECRET_LENGTH = 32;

/** Aptos coin type (for gas) */
export const APTOS_COIN = '0x1::aptos_coin::AptosCoin';

/** USDC Fungible Asset metadata address (Aptos Testnet) */
export const USDC_TESTNET_METADATA = '0x69091fbab5f7d635ee7ac5098cf0c1efbe31d68fec0f2cd565e8d168daf52832';

/** USDC Fungible Asset metadata address (Aptos Mainnet) */
export const USDC_MAINNET_METADATA = '0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b';

/** Network configurations */
export const NETWORKS = {
  mainnet: {
    name: 'mainnet',
    nodeUrl: 'https://fullnode.mainnet.aptoslabs.com/v1',
    faucetUrl: null,
  },
  testnet: {
    name: 'testnet',
    nodeUrl: 'https://fullnode.testnet.aptoslabs.com/v1',
    faucetUrl: 'https://faucet.testnet.aptoslabs.com',
  },
  devnet: {
    name: 'devnet',
    nodeUrl: 'https://fullnode.devnet.aptoslabs.com/v1',
    faucetUrl: 'https://faucet.devnet.aptoslabs.com',
  },
} as const;

export type NetworkName = keyof typeof NETWORKS;
