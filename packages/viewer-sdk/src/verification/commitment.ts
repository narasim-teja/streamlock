/**
 * On-chain commitment verification
 */

import type { Aptos } from '@aptos-labs/ts-sdk';
import type { MerkleProof } from '@streamlock/common';
import { createStreamLockContract } from '@streamlock/aptos';
import { verifyMerkleProof } from './merkle.js';

/**
 * Get on-chain commitment (Merkle root) for a video
 */
export async function getOnChainCommitment(
  client: Aptos,
  contractAddress: string,
  videoId: bigint
): Promise<string | null> {
  const contract = createStreamLockContract(client, {
    address: contractAddress,
    moduleName: 'protocol',
  });

  const video = await contract.getVideo(videoId);

  if (!video) {
    return null;
  }

  return video.keyCommitmentRoot;
}

/**
 * Verify a key against the on-chain commitment
 */
export async function verifyKeyAgainstCommitment(
  key: Buffer,
  proof: MerkleProof,
  client: Aptos,
  contractAddress: string,
  videoId: bigint
): Promise<boolean> {
  // First verify the Merkle proof locally
  const proofValid = verifyMerkleProof(key, proof);
  if (!proofValid) {
    return false;
  }

  // Then verify the root matches on-chain commitment
  const onChainRoot = await getOnChainCommitment(client, contractAddress, videoId);

  if (!onChainRoot) {
    return false;
  }

  return proof.root === onChainRoot;
}

/**
 * Verify that a proof's root matches expected value
 */
export function verifyProofRoot(proof: MerkleProof, expectedRoot: string): boolean {
  return proof.root === expectedRoot;
}
