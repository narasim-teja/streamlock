/**
 * Custom HLS.js key loader for x402 payments
 * Supports both raw Account and wallet adapter
 */

import type { Account, Aptos } from '@aptos-labs/ts-sdk';
import type { KeyResponse, X402PaymentHeader } from '@streamlock/common';
import {
  X402PaymentClient,
  type SignAndSubmitTransactionFunction,
} from '../payment/x402Client.js';
import { verifyKeyAgainstCommitment } from '../verification/commitment.js';

/** Key loader configuration */
export interface X402KeyLoaderConfig {
  keyServerBaseUrl: string;
  sessionId: string;
  videoId: string;
  aptosClient: Aptos;
  contractAddress: string;
  /** Account address for the viewer */
  accountAddress: string;
  /** Either a raw Account or wallet adapter signAndSubmitTransaction function */
  signer: Account | SignAndSubmitTransactionFunction;
  /** Called when a payment is made */
  onPayment?: (segmentIndex: number, txHash: string, amount: bigint) => void;
  /** Called when a key is received */
  onKeyReceived?: (key: KeyResponse) => void;
  /** Called on error */
  onError?: (error: Error) => void;
  /** Number of retry attempts for failed requests */
  maxRetries?: number;
  /** Delay between retries in ms */
  retryDelay?: number;
}

/** Custom key loader for HLS.js - supports wallet adapter */
export class X402KeyLoader {
  private config: X402KeyLoaderConfig;
  private paymentClient: X402PaymentClient;
  private keyCache: Map<number, KeyResponse> = new Map();
  private pendingPayments: Map<number, Promise<KeyResponse>> = new Map();
  private maxRetries: number;
  private retryDelay: number;

  constructor(config: X402KeyLoaderConfig) {
    this.config = config;
    this.maxRetries = config.maxRetries ?? 3;
    this.retryDelay = config.retryDelay ?? 1000;

    this.paymentClient = new X402PaymentClient({
      aptosClient: config.aptosClient,
      contractAddress: config.contractAddress,
      accountAddress: config.accountAddress,
      signer: config.signer,
    });
  }

  /**
   * Load a decryption key for a segment
   * This handles the x402 payment flow with retry support
   */
  async loadKey(segmentIndex: number): Promise<KeyResponse> {
    // Check cache first
    const cached = this.keyCache.get(segmentIndex);
    if (cached) {
      return cached;
    }

    // Check if already loading (dedup concurrent requests)
    const pending = this.pendingPayments.get(segmentIndex);
    if (pending) {
      return pending;
    }

    // Create new loading promise
    const loadPromise = this.loadKeyInternal(segmentIndex);
    this.pendingPayments.set(segmentIndex, loadPromise);

    try {
      const result = await loadPromise;
      return result;
    } finally {
      this.pendingPayments.delete(segmentIndex);
    }
  }

  /** Internal key loading with retry logic */
  private async loadKeyInternal(segmentIndex: number): Promise<KeyResponse> {
    const videoId = this.config.videoId;
    const keyUrl = `${this.config.keyServerBaseUrl}/videos/${videoId}/key/${segmentIndex}`;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        // First request - expect 402
        const initialResponse = await fetch(keyUrl);

        if (initialResponse.status === 402) {
          // Payment required
          return await this.handlePaymentRequired(
            videoId,
            segmentIndex,
            keyUrl
          );
        }

        if (initialResponse.ok) {
          // Key already available (segment pre-paid or free preview)
          const key: KeyResponse = await initialResponse.json();
          this.keyCache.set(segmentIndex, key);
          this.config.onKeyReceived?.(key);
          return key;
        }

        throw new Error(`Unexpected response: ${initialResponse.status}`);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.config.onError?.(lastError);

        if (attempt < this.maxRetries - 1) {
          // Exponential backoff
          const delay = this.retryDelay * Math.pow(2, attempt);
          await this.sleep(delay);
        }
      }
    }

    throw lastError ?? new Error('Failed to load key after retries');
  }

  /** Handle 402 Payment Required response */
  private async handlePaymentRequired(
    videoId: string,
    segmentIndex: number,
    keyUrl: string
  ): Promise<KeyResponse> {
    // Pay on-chain
    const paymentResult = await this.paymentClient.payForSegment({
      videoId,
      segmentIndex,
      sessionId: this.config.sessionId,
    });

    this.config.onPayment?.(
      segmentIndex,
      paymentResult.transactionHash,
      paymentResult.amount
    );

    // Retry with payment proof
    const paymentHeader: X402PaymentHeader = {
      txHash: paymentResult.transactionHash,
      network: 'aptos-testnet',
    };

    const keyResponse = await fetch(keyUrl, {
      headers: {
        'X-Payment': JSON.stringify(paymentHeader),
      },
    });

    if (!keyResponse.ok) {
      throw new Error(`Key request failed after payment: ${keyResponse.status}`);
    }

    const key: KeyResponse = await keyResponse.json();

    // Verify proof against on-chain commitment
    const isValid = await verifyKeyAgainstCommitment(
      Buffer.from(key.key, 'base64'),
      key.proof,
      this.config.aptosClient,
      this.config.contractAddress,
      videoId
    );

    if (!isValid) {
      throw new Error('Key verification failed: invalid Merkle proof');
    }

    // Cache key
    this.keyCache.set(segmentIndex, key);
    this.config.onKeyReceived?.(key);

    return key;
  }

  /** Sleep helper */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Prefetch keys for upcoming segments */
  async prefetchKeys(startIndex: number, count: number): Promise<void> {
    const promises: Promise<void>[] = [];

    for (let i = 0; i < count; i++) {
      const index = startIndex + i;
      if (!this.keyCache.has(index)) {
        promises.push(
          this.loadKey(index)
            .then(() => {})
            .catch((err) => {
              this.config.onError?.(err);
            })
        );
      }
    }

    await Promise.all(promises);
  }

  /** Update session ID (e.g., after top-up) */
  updateSessionId(sessionId: string): void {
    this.config.sessionId = sessionId;
  }

  /** Clear key cache */
  clearCache(): void {
    this.keyCache.clear();
  }

  /** Get cached key */
  getCachedKey(segmentIndex: number): KeyResponse | null {
    return this.keyCache.get(segmentIndex) ?? null;
  }
}
