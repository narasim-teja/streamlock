/**
 * Hashing utilities
 */

import { sha256 } from '@noble/hashes/sha256';

/**
 * Hash data using SHA-256
 * @param data - Data to hash
 * @returns 32-byte hash
 */
export function sha256Hash(data: Buffer | Uint8Array | string): Buffer {
  const input = typeof data === 'string' ? Buffer.from(data) : data;
  return Buffer.from(sha256(input));
}

/**
 * Double SHA-256 hash (for extra security)
 * @param data - Data to hash
 * @returns 32-byte hash
 */
export function doubleSha256(data: Buffer | Uint8Array | string): Buffer {
  return sha256Hash(sha256Hash(data));
}

/**
 * Hash multiple buffers concatenated
 * @param buffers - Array of buffers to concatenate and hash
 * @returns 32-byte hash
 */
export function hashConcat(...buffers: (Buffer | Uint8Array)[]): Buffer {
  return sha256Hash(Buffer.concat(buffers));
}

/**
 * Hash data and return as hex string
 * @param data - Data to hash
 * @returns Hex-encoded hash
 */
export function sha256Hex(data: Buffer | Uint8Array | string): string {
  return sha256Hash(data).toString('hex');
}
