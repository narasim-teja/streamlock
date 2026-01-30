/**
 * Merkle proof generation utilities
 */

import type { MerkleProof } from '@streamlock/common';
import { generateMerkleProof as generateProof, type MerkleTree } from '@streamlock/crypto';

/** Proof generator configuration */
export interface ProofGeneratorConfig {
  getMerkleTree: (videoId: string) => Promise<MerkleTree | null>;
}

/**
 * Create a proof generator
 */
export function createProofGenerator(config: ProofGeneratorConfig) {
  return async (videoId: string, segmentIndex: number): Promise<MerkleProof | null> => {
    const tree = await config.getMerkleTree(videoId);
    if (!tree) {
      return null;
    }

    try {
      return generateProof(tree, segmentIndex);
    } catch {
      return null;
    }
  };
}

/**
 * Generate proofs for multiple segments
 */
export async function generateBatchProofs(
  tree: MerkleTree,
  segmentIndices: number[]
): Promise<MerkleProof[]> {
  return segmentIndices.map((index) => generateProof(tree, index));
}

/**
 * Get the commitment root from a tree
 */
export function getCommitmentRoot(tree: MerkleTree): string {
  return tree.root.toString('hex');
}
