/**
 * Client-side Merkle proof verification
 */

import type { MerkleProof } from '@streamlock/common';
import { verifyMerkleProof as verify } from '@streamlock/crypto';

/**
 * Verify a Merkle proof (client-side)
 */
export function verifyMerkleProof(key: Buffer, proof: MerkleProof): boolean {
  return verify(key, proof);
}

/**
 * Verify key matches expected hash
 */
export function verifyKeyHash(key: Buffer, expectedLeafHash: string): boolean {
  const { sha256 } = require('@noble/hashes/sha256');
  const keyHash = Buffer.from(sha256(key)).toString('hex');
  return keyHash === expectedLeafHash;
}
