/**
 * Aptos-specific types
 */

import type { AccountAddress, HexInput } from '@aptos-labs/ts-sdk';

/** Network configuration */
export interface NetworkConfig {
  name: string;
  nodeUrl: string;
  faucetUrl: string | null;
}

/** Contract configuration */
export interface ContractConfig {
  address: string;
  moduleName: string;
}

/** Transaction result */
export interface TransactionResult {
  hash: string;
  success: boolean;
  vmStatus: string;
  gasUsed: bigint;
  events: ContractEvent[];
}

/** Generic contract event */
export interface ContractEvent {
  type: string;
  data: Record<string, unknown>;
  sequenceNumber: bigint;
}

/** Creator registration parameters */
export interface RegisterCreatorParams {
  metadataUri: string;
}

/** Video registration parameters */
export interface RegisterVideoParams {
  contentUri: string;
  thumbnailUri: string;
  durationSeconds: number;
  totalSegments: number;
  keyCommitmentRoot: HexInput;
  pricePerSegment: bigint;
}

/** Start session parameters */
export interface StartSessionParams {
  videoId: bigint;
  prepaidSegments: number;
  maxDurationSeconds: number;
}

/** Pay for segment parameters */
export interface PayForSegmentParams {
  sessionId: bigint;
  segmentIndex: number;
}

/** Top up session parameters */
export interface TopUpSessionParams {
  sessionId: bigint;
  additionalSegments: number;
}

/** On-chain video data */
export interface OnChainVideo {
  videoId: bigint;
  creator: string;
  contentUri: string;
  thumbnailUri: string;
  durationSeconds: number;
  totalSegments: number;
  keyCommitmentRoot: string;
  pricePerSegment: bigint;
  totalViews: number;
  totalEarnings: bigint;
  isActive: boolean;
  createdAt: number;
}

/** On-chain session data */
export interface OnChainSession {
  sessionId: bigint;
  videoId: bigint;
  viewer: string;
  creator: string;
  segmentsPaid: number;
  prepaidBalance: bigint;
  totalPaid: bigint;
  startedAt: number;
  expiresAt: number;
  isActive: boolean;
}

/** On-chain creator data */
export interface OnChainCreator {
  totalEarnings: bigint;
  pendingWithdrawal: bigint;
  totalVideos: number;
  registeredAt: number;
  metadataUri: string;
}

/** Signer interface for transactions */
export interface TransactionSigner {
  accountAddress: AccountAddress;
  signTransaction(txn: Uint8Array): Promise<Uint8Array>;
}
