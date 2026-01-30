/**
 * Key release endpoint handler
 */

import type { KeyResponse } from '@streamlock/common';
import { deriveSegmentKeyPair, generateMerkleProof, type MerkleTree } from '@streamlock/crypto';

/** Key handler configuration */
export interface KeyHandlerConfig {
  getMasterSecret: (videoId: string) => Promise<Buffer | null>;
  getMerkleTree: (videoId: string) => Promise<MerkleTree | null>;
}

/** Key handler function type */
export type KeyHandler = (
  videoId: string,
  segmentIndex: number
) => Promise<KeyResponse | null>;

/**
 * Create key handler for releasing decryption keys
 */
export function createKeyHandler(config: KeyHandlerConfig): KeyHandler {
  return async (videoId: string, segmentIndex: number): Promise<KeyResponse | null> => {
    // Get master secret
    const masterSecret = await config.getMasterSecret(videoId);
    if (!masterSecret) {
      return null;
    }

    // Get Merkle tree
    const tree = await config.getMerkleTree(videoId);
    if (!tree) {
      return null;
    }

    // Derive key and IV
    const { key, iv } = deriveSegmentKeyPair(masterSecret, videoId, segmentIndex);

    // Generate Merkle proof
    const proof = generateMerkleProof(tree, segmentIndex);

    return {
      key: key.toString('base64'),
      iv: iv.toString('base64'),
      proof,
      segmentIndex,
    };
  };
}

/**
 * Validate that a key response matches the on-chain commitment
 */
export function validateKeyResponse(
  response: KeyResponse,
  expectedRoot: string
): boolean {
  return response.proof.root === expectedRoot;
}
