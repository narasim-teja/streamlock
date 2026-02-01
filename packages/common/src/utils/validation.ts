/**
 * Input validation utilities
 */

import { isValidHex } from './hex';

/** Validate Aptos address format */
export function isValidAptosAddress(address: string): boolean {
  if (!address.startsWith('0x')) return false;
  const hex = address.slice(2);
  return hex.length === 64 && isValidHex(address);
}

/** Validate video ID format */
export function isValidVideoId(videoId: string): boolean {
  // Video IDs are hex strings (32 bytes = 64 characters)
  return isValidHex(videoId) && videoId.length === 64;
}

/** Validate session ID format */
export function isValidSessionId(sessionId: string): boolean {
  // Session IDs are numeric strings (u128)
  return /^\d+$/.test(sessionId);
}

/** Validate segment index */
export function isValidSegmentIndex(index: number, totalSegments: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < totalSegments;
}

/** Validate price (in octas) */
export function isValidPrice(price: bigint, minPrice: bigint): boolean {
  return price >= minPrice;
}

/** Validate URI format */
export function isValidUri(uri: string): boolean {
  try {
    new URL(uri);
    return true;
  } catch {
    return false;
  }
}

/** Validate segment duration */
export function isValidSegmentDuration(duration: number): boolean {
  return Number.isFinite(duration) && duration > 0 && duration <= 30;
}
