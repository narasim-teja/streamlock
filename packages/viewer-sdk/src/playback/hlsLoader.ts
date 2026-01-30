/**
 * Custom HLS.js key loader for x402 payments
 */

import type { Account, Aptos } from '@aptos-labs/ts-sdk';
import type { KeyResponse, X402PaymentHeader } from '@streamlock/common';
import { X402PaymentClient } from '../payment/x402Client.js';
import { verifyKeyAgainstCommitment } from '../verification/commitment.js';

/** Key loader configuration */
export interface X402KeyLoaderConfig {
  keyServerBaseUrl: string;
  sessionId: string;
  signer: Account;
  aptosClient: Aptos;
  contractAddress: string;
  onPayment?: (segmentIndex: number, txHash: string, amount: bigint) => void;
  onKeyReceived?: (key: KeyResponse) => void;
  onError?: (error: Error) => void;
}

/** Custom key loader for HLS.js */
export class X402KeyLoader {
  private config: X402KeyLoaderConfig;
  private paymentClient: X402PaymentClient;
  private keyCache: Map<number, KeyResponse> = new Map();

  constructor(config: X402KeyLoaderConfig) {
    this.config = config;
    this.paymentClient = new X402PaymentClient(
      config.signer,
      config.aptosClient,
      config.contractAddress
    );
  }

  /**
   * Load a decryption key for a segment
   * This handles the x402 payment flow
   */
  async loadKey(videoId: string, segmentIndex: number): Promise<KeyResponse> {
    // Check cache
    const cached = this.keyCache.get(segmentIndex);
    if (cached) {
      return cached;
    }

    const keyUrl = `${this.config.keyServerBaseUrl}/videos/${videoId}/key/${segmentIndex}`;

    // First request - expect 402
    const initialResponse = await fetch(keyUrl);

    if (initialResponse.status === 402) {
      // Parse payment requirements (validate response but don't use the data)
      await initialResponse.json();

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
        throw new Error(`Key request failed: ${keyResponse.status}`);
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

    if (initialResponse.ok) {
      // Key already available (segment pre-paid or free)
      const key: KeyResponse = await initialResponse.json();
      this.keyCache.set(segmentIndex, key);
      this.config.onKeyReceived?.(key);
      return key;
    }

    throw new Error(`Unexpected response: ${initialResponse.status}`);
  }

  /** Prefetch keys for upcoming segments */
  async prefetchKeys(
    videoId: string,
    startIndex: number,
    count: number
  ): Promise<void> {
    const promises: Promise<void>[] = [];

    for (let i = 0; i < count; i++) {
      const index = startIndex + i;
      if (!this.keyCache.has(index)) {
        promises.push(
          this.loadKey(videoId, index)
            .then(() => {})
            .catch((err) => {
              this.config.onError?.(err);
            })
        );
      }
    }

    await Promise.all(promises);
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
