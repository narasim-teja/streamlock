/**
 * Video segment encryption
 */

import type { Segment, EncryptedSegment } from '@streamlock/common';
import { encryptSegment } from '@streamlock/crypto';
import { sha256 } from '@noble/hashes/sha256';
import { hkdf } from '@noble/hashes/hkdf';

/** Encryption result */
export interface EncryptionResult {
  encryptedSegments: EncryptedSegment[];
  ivs: Buffer[];
}

/**
 * Encrypt video segments using AES-128-CBC
 * @param segments - Video segments to encrypt
 * @param keys - Per-segment encryption keys
 * @param videoId - Unique video identifier
 * @param masterSecret - Master secret for IV derivation (required for security)
 */
export async function encryptVideoSegments(
  segments: Segment[],
  keys: Buffer[],
  videoId: string,
  masterSecret: Buffer
): Promise<EncryptionResult> {
  if (segments.length !== keys.length) {
    throw new Error('Segments and keys arrays must have same length');
  }

  const encryptedSegments: EncryptedSegment[] = [];
  const ivs: Buffer[] = [];

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const key = keys[i];

    // Derive IV from master secret using HKDF - cryptographically secure
    const iv = deriveSegmentIV(masterSecret, videoId, i);

    const encryptedData = encryptSegment(segment.data, key, iv);

    encryptedSegments.push({
      index: i,
      data: encryptedData,
      iv,
    });

    ivs.push(iv);
  }

  return { encryptedSegments, ivs };
}

/**
 * Derive IV for a segment using HKDF from master secret
 * This ensures IVs are cryptographically secure and unpredictable
 * without knowing the master secret
 */
function deriveSegmentIV(masterSecret: Buffer, videoId: string, segmentIndex: number): Buffer {
  // Use HKDF to derive IV from master secret
  // info = "iv:{videoId}:{segmentIndex}" ensures unique IV per segment
  const info = Buffer.from(`iv:${videoId}:${segmentIndex}`);
  const salt = sha256(Buffer.from('streamlock-iv-salt'));

  // Derive 16 bytes for AES-128 IV
  const derived = hkdf(sha256, masterSecret, salt, info, 16);
  return Buffer.from(derived);
}

/**
 * Encrypt segments with master secret (full pipeline)
 */
export async function encryptWithMasterSecret(
  segments: Segment[],
  masterSecret: Buffer,
  videoId: string
): Promise<EncryptionResult & { keys: Buffer[] }> {
  const { deriveAllSegmentKeys } = await import('@streamlock/crypto');

  const keys = deriveAllSegmentKeys(masterSecret, videoId, segments.length);
  const { encryptedSegments, ivs } = await encryptVideoSegments(
    segments,
    keys,
    videoId,
    masterSecret
  );

  return {
    encryptedSegments,
    ivs,
    keys,
  };
}
