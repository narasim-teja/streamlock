/**
 * Session key types for ephemeral signing
 */

import type { Ed25519Account } from '@aptos-labs/ts-sdk';

/** Configuration for session key creation */
export interface SessionKeyConfig {
  /** Maximum amount the session key can spend (in octas) */
  spendingLimit: bigint;
  /** Optional: estimated segments to watch (helps calculate limit) */
  estimatedSegments?: number;
  /** Gas buffer percentage (default: 20%) */
  gasBufferPercent?: number;
}

/** Session key state (serializable for sessionStorage) */
export interface SessionKeyState {
  /** Address of the ephemeral account */
  address: string;
  /** Original spending limit */
  spendingLimit: string; // bigint as string for serialization
  /** Current balance (updated after transactions) */
  currentBalance: string; // bigint as string for serialization
  /** Amount spent on segments */
  segmentSpend: string; // bigint as string for serialization
  /** Amount spent on gas */
  gasSpend: string; // bigint as string for serialization
  /** When the session key was created */
  createdAt: number;
  /** The main wallet address that funded this key */
  fundingWallet: string;
  /** On-chain session ID (if session started) */
  sessionId?: string; // bigint as string
  /** Video ID this session is for */
  videoId?: string; // bigint as string
}

/** Live session key state (with Account object) */
export interface LiveSessionKeyState extends Omit<SessionKeyState,
  'spendingLimit' | 'currentBalance' | 'segmentSpend' | 'gasSpend' | 'sessionId' | 'videoId'
> {
  /** The ephemeral account */
  account: Ed25519Account;
  /** Original spending limit */
  spendingLimit: bigint;
  /** Current balance */
  currentBalance: bigint;
  /** Amount spent on segments */
  segmentSpend: bigint;
  /** Amount spent on gas */
  gasSpend: bigint;
  /** On-chain session ID */
  sessionId?: bigint;
  /** Video ID */
  videoId?: bigint;
}

/** Session key storage interface (implemented by web app) */
export interface SessionKeyStorage {
  /** Save session key to storage */
  save(privateKeyHex: string, state: SessionKeyState): void;
  /** Restore session key from storage */
  restore(): { privateKeyHex: string; state: SessionKeyState } | null;
  /** Clear session key from storage */
  clear(): void;
}

/** Storage keys for sessionStorage */
export const SESSION_KEY_STORAGE_KEY = 'sl_session_key';
export const SESSION_STATE_STORAGE_KEY = 'sl_session_state';
