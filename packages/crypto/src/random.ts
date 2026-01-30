/**
 * Secure random number generation
 */

import { randomBytes } from 'crypto';

/**
 * Generate cryptographically secure random bytes
 * @param length - Number of bytes to generate
 * @returns Buffer with random bytes
 */
export function generateSecureRandom(length: number): Buffer {
  return randomBytes(length);
}

/**
 * Generate a random video ID (32 bytes / 256 bits)
 * @returns 64-character hex string
 */
export function generateVideoId(): string {
  return generateSecureRandom(32).toString('hex');
}

/**
 * Generate a random session ID
 * @returns Numeric string suitable for u128
 */
export function generateSessionId(): string {
  // Generate 16 bytes and convert to bigint
  const bytes = generateSecureRandom(16);
  let result = 0n;
  for (let i = 0; i < bytes.length; i++) {
    result = (result << 8n) | BigInt(bytes[i]);
  }
  return result.toString();
}
