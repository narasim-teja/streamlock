/**
 * Video segment encryption
 */

import type { Segment, EncryptedSegment } from '@streamlock/common';
import { encryptSegment } from '@streamlock/crypto';

/** Encryption result */
export interface EncryptionResult {
  encryptedSegments: EncryptedSegment[];
  ivs: Buffer[];
}

/**
 * Encrypt video segments using AES-128-CBC
 */
export async function encryptVideoSegments(
  segments: Segment[],
  keys: Buffer[],
  videoId: string
): Promise<EncryptionResult> {
  if (segments.length !== keys.length) {
    throw new Error('Segments and keys arrays must have same length');
  }

  const encryptedSegments: EncryptedSegment[] = [];
  const ivs: Buffer[] = [];

  // We need master secret to derive IVs
  // For now, use a deterministic IV based on videoId and segment index
  // In production, IVs should be derived from master secret

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const key = keys[i];

    // Generate IV deterministically from videoId and segment index
    // This is safe because each key is unique per segment
    const iv = generateSegmentIV(videoId, i);

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
 * Generate IV for a segment
 * In production, this should use HKDF from master secret
 */
function generateSegmentIV(videoId: string, segmentIndex: number): Buffer {
  const { sha256 } = require('@noble/hashes/sha256');
  const input = `${videoId}:iv:${segmentIndex}`;
  const hash = sha256(Buffer.from(input));
  return Buffer.from(hash.slice(0, 16));
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
    videoId
  );

  return {
    encryptedSegments,
    ivs,
    keys,
  };
}
