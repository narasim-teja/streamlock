/**
 * Core types for StreamLock protocol
 */

/** Video metadata stored on-chain and in database */
export interface Video {
  videoId: string;
  creator: string;
  title: string;
  description?: string;
  contentUri: string;
  thumbnailUri?: string;
  durationSeconds: number;
  totalSegments: number;
  pricePerSegment: bigint;
  merkleRoot: string;
  isActive: boolean;
  createdAt: number;
}

/** Creator profile */
export interface Creator {
  address: string;
  totalEarnings: bigint;
  pendingWithdrawal: bigint;
  totalVideos: number;
  registeredAt: number;
  metadataUri?: string;
}

/** Viewing session with escrow */
export interface ViewingSession {
  sessionId: string;
  videoId: string;
  viewer: string;
  creator: string;
  segmentsPaid: number;
  prepaidBalance: bigint;
  totalPaid: bigint;
  startedAt: number;
  expiresAt: number;
  isActive: boolean;
}

/** Merkle proof for key verification */
export interface MerkleProof {
  leaf: string;
  proof: string[];
  root: string;
  index: number;
}

/** Key response from server */
export interface KeyResponse {
  key: string;
  iv: string;
  proof: MerkleProof;
  segmentIndex: number;
}

/** x402 payment request */
export interface X402PaymentRequest {
  x402Version: number;
  accepts: X402PaymentOption[];
}

/** x402 payment option */
export interface X402PaymentOption {
  scheme: 'exact';
  network: string;
  maxAmountRequired: string;
  resource: string;
  payTo: string;
  extra: {
    videoId: string;
    segmentIndex: number;
    sessionId: string;
    contractAddress: string;
    function: string;
  };
}

/** Payment header sent after on-chain payment */
export interface X402PaymentHeader {
  txHash: string;
  network: string;
}

/** Video upload options */
export interface UploadVideoOptions {
  file: File | Buffer | string;
  title: string;
  description?: string;
  thumbnail?: File | Buffer | string;
  pricePerSegment: number;
  segmentDuration?: number;
}

/** Upload result */
export interface UploadResult {
  videoId: string;
  contentUri: string;
  thumbnailUri?: string;
  totalSegments: number;
  merkleRoot: string;
  transactionHash: string;
}

/** Session info for viewers */
export interface SessionInfo {
  sessionId: string;
  videoId: string;
  prepaidBalance: bigint;
  segmentsPaid: number;
  expiresAt: number;
}

/** Session summary after ending */
export interface SessionSummary {
  segmentsWatched: number;
  totalPaid: bigint;
  refunded: bigint;
  transactionHash: string;
}

/** Payment event emitted during playback */
export interface PaymentEvent {
  segmentIndex: number;
  amount: bigint;
  txHash: string;
  timestamp: number;
}

/** Video segment */
export interface Segment {
  index: number;
  duration: number;
  data: Buffer;
}

/** Encrypted segment */
export interface EncryptedSegment {
  index: number;
  data: Buffer;
  iv: Buffer;
}
