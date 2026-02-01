/**
 * Session Key Manager - manages ephemeral signing keys for popup-free payments
 */

import { Ed25519PrivateKey, Account } from '@aptos-labs/ts-sdk';
import type { Ed25519Account } from '@aptos-labs/ts-sdk';
import type {
  SessionKeyConfig,
  SessionKeyState,
  LiveSessionKeyState,
  SessionKeyStorage,
} from './sessionKeyTypes.js';
import {
  SESSION_KEY_STORAGE_KEY,
  SESSION_STATE_STORAGE_KEY,
} from './sessionKeyTypes.js';

/** Default gas buffer percentage */
const DEFAULT_GAS_BUFFER_PERCENT = 20;

/** Estimated gas per transaction in octas (0.001 APT) */
const ESTIMATED_GAS_PER_TX = 100_000n;

/** Session Key Manager */
export class SessionKeyManager {
  private account: Ed25519Account | null = null;
  private state: LiveSessionKeyState | null = null;
  private storage: SessionKeyStorage | null = null;

  constructor(storage?: SessionKeyStorage) {
    this.storage = storage ?? null;
  }

  /**
   * Generate a new ephemeral keypair
   */
  generate(): Ed25519Account {
    const privateKey = Ed25519PrivateKey.generate();
    const account = Account.fromPrivateKey({ privateKey });
    this.account = account as Ed25519Account;
    return this.account;
  }

  /**
   * Initialize session key state after generation
   */
  initialize(fundingWallet: string, spendingLimit: bigint): void {
    if (!this.account) {
      throw new Error('Session key not generated. Call generate() first.');
    }

    this.state = {
      account: this.account,
      address: this.account.accountAddress.toString(),
      spendingLimit,
      currentBalance: 0n, // Will be updated after funding
      segmentSpend: 0n,
      gasSpend: 0n,
      createdAt: Date.now(),
      fundingWallet,
    };

    // Persist to storage if available
    this.persist();
  }

  /**
   * Restore session key from storage
   * Returns true if successfully restored
   */
  restore(): boolean {
    if (!this.storage) {
      return false;
    }

    const stored = this.storage.restore();
    if (!stored) {
      return false;
    }

    try {
      // Reconstruct account from private key
      const privateKeyHex = stored.privateKeyHex.startsWith('0x')
        ? stored.privateKeyHex.slice(2)
        : stored.privateKeyHex;
      const privateKey = new Ed25519PrivateKey(privateKeyHex);
      const account = Account.fromPrivateKey({ privateKey });
      this.account = account as Ed25519Account;

      // Reconstruct live state
      this.state = {
        account: this.account,
        address: stored.state.address,
        spendingLimit: BigInt(stored.state.spendingLimit),
        currentBalance: BigInt(stored.state.currentBalance),
        segmentSpend: BigInt(stored.state.segmentSpend),
        gasSpend: BigInt(stored.state.gasSpend),
        createdAt: stored.state.createdAt,
        fundingWallet: stored.state.fundingWallet,
        sessionId: stored.state.sessionId ? BigInt(stored.state.sessionId) : undefined,
        videoId: stored.state.videoId ? BigInt(stored.state.videoId) : undefined,
      };

      return true;
    } catch (error) {
      console.error('Failed to restore session key:', error);
      this.storage.clear();
      return false;
    }
  }

  /**
   * Persist current state to storage
   */
  private persist(): void {
    if (!this.storage || !this.account || !this.state) {
      return;
    }

    const privateKeyHex = this.account.privateKey.toString();
    const serializedState: SessionKeyState = {
      address: this.state.address,
      spendingLimit: this.state.spendingLimit.toString(),
      currentBalance: this.state.currentBalance.toString(),
      segmentSpend: this.state.segmentSpend.toString(),
      gasSpend: this.state.gasSpend.toString(),
      createdAt: this.state.createdAt,
      fundingWallet: this.state.fundingWallet,
      sessionId: this.state.sessionId?.toString(),
      videoId: this.state.videoId?.toString(),
    };

    this.storage.save(privateKeyHex, serializedState);
  }

  /**
   * Get the ephemeral account for signing
   */
  getAccount(): Ed25519Account | null {
    return this.account;
  }

  /**
   * Get current session key state
   */
  getState(): LiveSessionKeyState | null {
    return this.state ? { ...this.state } : null;
  }

  /**
   * Get address
   */
  getAddress(): string | null {
    return this.state?.address ?? null;
  }

  /**
   * Update balance after funding transaction
   */
  setBalance(balance: bigint): void {
    if (!this.state) {
      throw new Error('Session key not initialized');
    }
    this.state.currentBalance = balance;
    this.persist();
  }

  /**
   * Update session info after session creation
   */
  setSessionInfo(sessionId: bigint, videoId: bigint): void {
    if (!this.state) {
      throw new Error('Session key not initialized');
    }
    this.state.sessionId = sessionId;
    this.state.videoId = videoId;
    this.persist();
  }

  /**
   * Record a payment (segment + gas)
   */
  recordPayment(segmentAmount: bigint, gasUsed: bigint): void {
    if (!this.state) {
      throw new Error('Session key not initialized');
    }

    this.state.segmentSpend += segmentAmount;
    this.state.gasSpend += gasUsed;
    this.state.currentBalance -= (segmentAmount + gasUsed);
    this.persist();
  }

  /**
   * Update balance after a transaction
   */
  deductBalance(amount: bigint): void {
    if (!this.state) {
      throw new Error('Session key not initialized');
    }
    this.state.currentBalance -= amount;
    this.persist();
  }

  /**
   * Check if session key can afford a payment
   */
  canAfford(segmentAmount: bigint, estimatedGas: bigint = ESTIMATED_GAS_PER_TX): boolean {
    if (!this.state) {
      return false;
    }
    return this.state.currentBalance >= (segmentAmount + estimatedGas);
  }

  /**
   * Get remaining balance
   */
  getRemainingBalance(): bigint {
    return this.state?.currentBalance ?? 0n;
  }

  /**
   * Get number of segments that can still be afforded
   */
  getAffordableSegments(segmentPrice: bigint): number {
    if (!this.state || segmentPrice === 0n) {
      return 0;
    }
    // Account for gas per transaction
    const costPerSegment = segmentPrice + ESTIMATED_GAS_PER_TX;
    return Number(this.state.currentBalance / costPerSegment);
  }

  /**
   * Check if session key is active
   */
  isActive(): boolean {
    return this.account !== null && this.state !== null;
  }

  /**
   * Check if session key has a session
   */
  hasSession(): boolean {
    return this.state?.sessionId !== undefined;
  }

  /**
   * Get session ID
   */
  getSessionId(): bigint | undefined {
    return this.state?.sessionId;
  }

  /**
   * Get video ID
   */
  getVideoId(): bigint | undefined {
    return this.state?.videoId;
  }

  /**
   * Get funding wallet address
   */
  getFundingWallet(): string | null {
    return this.state?.fundingWallet ?? null;
  }

  /**
   * Clear session key from memory and storage
   */
  destroy(): void {
    this.account = null;
    this.state = null;
    this.storage?.clear();
  }

  /**
   * Calculate funding amount needed for session key
   */
  static calculateFundingAmount(config: SessionKeyConfig, segmentPrice: bigint): bigint {
    const gasBufferPercent = config.gasBufferPercent ?? DEFAULT_GAS_BUFFER_PERCENT;

    // Use spending limit if provided, otherwise calculate from estimated segments
    let baseAmount = config.spendingLimit;
    if (config.estimatedSegments && config.spendingLimit === 0n) {
      baseAmount = segmentPrice * BigInt(config.estimatedSegments);
    }

    // Add gas buffer
    const gasBuffer = (baseAmount * BigInt(gasBufferPercent)) / 100n;

    // Also add estimated gas for all transactions (start session + pay per segment + end session + return funds)
    const estimatedTxCount = (config.estimatedSegments ?? 10) + 3;
    const txGasBuffer = ESTIMATED_GAS_PER_TX * BigInt(estimatedTxCount);

    return baseAmount + gasBuffer + txGasBuffer;
  }
}

/**
 * Browser sessionStorage implementation of SessionKeyStorage
 */
export class BrowserSessionKeyStorage implements SessionKeyStorage {
  save(privateKeyHex: string, state: SessionKeyState): void {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      sessionStorage.setItem(SESSION_KEY_STORAGE_KEY, privateKeyHex);
      sessionStorage.setItem(SESSION_STATE_STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error('Failed to save session key to storage:', error);
    }
  }

  restore(): { privateKeyHex: string; state: SessionKeyState } | null {
    if (typeof window === 'undefined') {
      return null;
    }
    try {
      const privateKeyHex = sessionStorage.getItem(SESSION_KEY_STORAGE_KEY);
      const stateJson = sessionStorage.getItem(SESSION_STATE_STORAGE_KEY);

      if (!privateKeyHex || !stateJson) {
        return null;
      }

      const state = JSON.parse(stateJson) as SessionKeyState;
      return { privateKeyHex, state };
    } catch (error) {
      console.error('Failed to restore session key from storage:', error);
      return null;
    }
  }

  clear(): void {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      sessionStorage.removeItem(SESSION_KEY_STORAGE_KEY);
      sessionStorage.removeItem(SESSION_STATE_STORAGE_KEY);
    } catch (error) {
      console.error('Failed to clear session key from storage:', error);
    }
  }
}
