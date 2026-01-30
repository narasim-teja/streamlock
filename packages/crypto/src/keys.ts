/**
 * Key derivation using HKDF
 */

import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import {
  HKDF_SALT,
  HKDF_INFO_KEY,
  HKDF_INFO_IV,
  AES_KEY_LENGTH,
  AES_IV_LENGTH,
  MASTER_SECRET_LENGTH,
} from '@streamlock/common';
import { generateSecureRandom } from './random.js';

/**
 * Generate a cryptographically secure master secret
 * @returns 32-byte master secret
 */
export function generateMasterSecret(): Buffer {
  return generateSecureRandom(MASTER_SECRET_LENGTH);
}

/**
 * Derive segment encryption key using HKDF
 * @param masterSecret - 32-byte master secret
 * @param videoId - Unique video identifier
 * @param segmentIndex - Segment index
 * @returns 16-byte AES key
 */
export function deriveSegmentKey(
  masterSecret: Buffer,
  videoId: string,
  segmentIndex: number
): Buffer {
  const info = `${HKDF_INFO_KEY}:${videoId}:${segmentIndex}`;
  const key = hkdf(sha256, masterSecret, HKDF_SALT, info, AES_KEY_LENGTH);
  return Buffer.from(key);
}

/**
 * Derive segment IV using HKDF
 * @param masterSecret - 32-byte master secret
 * @param videoId - Unique video identifier
 * @param segmentIndex - Segment index
 * @returns 16-byte IV
 */
export function deriveSegmentIV(
  masterSecret: Buffer,
  videoId: string,
  segmentIndex: number
): Buffer {
  const info = `${HKDF_INFO_IV}:${videoId}:${segmentIndex}`;
  const iv = hkdf(sha256, masterSecret, HKDF_SALT, info, AES_IV_LENGTH);
  return Buffer.from(iv);
}

/**
 * Derive all segment keys for a video
 * @param masterSecret - 32-byte master secret
 * @param videoId - Unique video identifier
 * @param totalSegments - Total number of segments
 * @returns Array of 16-byte AES keys
 */
export function deriveAllSegmentKeys(
  masterSecret: Buffer,
  videoId: string,
  totalSegments: number
): Buffer[] {
  const keys: Buffer[] = [];
  for (let i = 0; i < totalSegments; i++) {
    keys.push(deriveSegmentKey(masterSecret, videoId, i));
  }
  return keys;
}

/**
 * Derive key and IV pair for a segment
 * @param masterSecret - 32-byte master secret
 * @param videoId - Unique video identifier
 * @param segmentIndex - Segment index
 * @returns Object with key and iv buffers
 */
export function deriveSegmentKeyPair(
  masterSecret: Buffer,
  videoId: string,
  segmentIndex: number
): { key: Buffer; iv: Buffer } {
  return {
    key: deriveSegmentKey(masterSecret, videoId, segmentIndex),
    iv: deriveSegmentIV(masterSecret, videoId, segmentIndex),
  };
}
