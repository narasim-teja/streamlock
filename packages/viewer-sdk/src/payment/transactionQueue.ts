/**
 * Transaction queue with retry logic and rate limiting
 */

import type {
  Aptos,
  InputGenerateTransactionPayloadData,
} from '@aptos-labs/ts-sdk';
import type { SignAndSubmitTransactionFunction } from './x402Client';

/** Transaction status */
export type TransactionStatus =
  | 'pending'
  | 'submitted'
  | 'confirmed'
  | 'failed';

/** Transaction request */
export interface TransactionRequest {
  id: string;
  payload: InputGenerateTransactionPayloadData;
  priority?: number;
  maxRetries?: number;
  onSuccess?: (hash: string) => void;
  onError?: (error: Error) => void;
}

/** Queued transaction */
interface QueuedTransaction extends TransactionRequest {
  status: TransactionStatus;
  attempts: number;
  hash?: string;
  error?: Error;
  createdAt: number;
  resolve: (hash: string) => void;
  reject: (error: Error) => void;
}

/** Transaction queue configuration */
export interface TransactionQueueConfig {
  /** Aptos client for waiting on transactions */
  aptosClient: Aptos;
  /** Function to sign and submit transactions (from wallet adapter) */
  signAndSubmit: SignAndSubmitTransactionFunction;
  /** Max concurrent transactions */
  maxConcurrent?: number;
  /** Default max retries per transaction */
  defaultMaxRetries?: number;
  /** Base delay between retries (ms) */
  baseRetryDelay?: number;
  /** Max delay between retries (ms) */
  maxRetryDelay?: number;
  /** Called when a transaction is submitted */
  onSubmit?: (id: string, hash: string) => void;
  /** Called when a transaction is confirmed */
  onConfirm?: (id: string, hash: string) => void;
  /** Called when a transaction fails */
  onFail?: (id: string, error: Error) => void;
}

/** Transaction queue with retry and rate limiting */
export class TransactionQueue {
  private config: Required<
    Omit<TransactionQueueConfig, 'onSubmit' | 'onConfirm' | 'onFail'>
  > &
    Pick<TransactionQueueConfig, 'onSubmit' | 'onConfirm' | 'onFail'>;
  private queue: QueuedTransaction[] = [];
  private processing = false;
  private activeCount = 0;

  constructor(config: TransactionQueueConfig) {
    this.config = {
      ...config,
      maxConcurrent: config.maxConcurrent ?? 1,
      defaultMaxRetries: config.defaultMaxRetries ?? 3,
      baseRetryDelay: config.baseRetryDelay ?? 1000,
      maxRetryDelay: config.maxRetryDelay ?? 30000,
    };
  }

  /** Add transaction to queue */
  enqueue(request: TransactionRequest): Promise<string> {
    return new Promise((resolve, reject) => {
      const queuedTx: QueuedTransaction = {
        ...request,
        status: 'pending',
        attempts: 0,
        createdAt: Date.now(),
        maxRetries: request.maxRetries ?? this.config.defaultMaxRetries,
        resolve,
        reject,
      };

      // Insert by priority (higher priority first)
      const priority = request.priority ?? 0;
      const insertIndex = this.queue.findIndex(
        (tx) => (tx.priority ?? 0) < priority
      );

      if (insertIndex === -1) {
        this.queue.push(queuedTx);
      } else {
        this.queue.splice(insertIndex, 0, queuedTx);
      }

      this.processQueue();
    });
  }

  /** Process queue */
  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      while (this.queue.length > 0 && this.activeCount < this.config.maxConcurrent) {
        const tx = this.queue.find((t) => t.status === 'pending');
        if (!tx) break;

        tx.status = 'submitted';
        this.activeCount++;

        // Process without blocking the loop
        this.processTransaction(tx).finally(() => {
          this.activeCount--;
          // Continue processing
          if (this.queue.length > 0) {
            this.processQueue();
          }
        });
      }
    } finally {
      this.processing = false;
    }
  }

  /** Process single transaction with retry */
  private async processTransaction(tx: QueuedTransaction): Promise<void> {
    while (tx.attempts < (tx.maxRetries ?? this.config.defaultMaxRetries)) {
      tx.attempts++;

      try {
        // Submit transaction
        const pendingTx = await this.config.signAndSubmit(tx.payload);
        tx.hash = pendingTx.hash;

        this.config.onSubmit?.(tx.id, pendingTx.hash);

        // Wait for confirmation
        const response = await this.config.aptosClient.waitForTransaction({
          transactionHash: pendingTx.hash,
        });

        // Check if successful
        if ('success' in response && response.success) {
          tx.status = 'confirmed';
          this.config.onConfirm?.(tx.id, pendingTx.hash);
          tx.onSuccess?.(pendingTx.hash);
          tx.resolve(pendingTx.hash);

          // Remove from queue
          this.removeFromQueue(tx.id);
          return;
        }

        // Transaction failed on-chain
        throw new Error(
          `Transaction failed: ${'vm_status' in response ? response.vm_status : 'unknown'}`
        );
      } catch (error) {
        tx.error = error instanceof Error ? error : new Error(String(error));

        // Check if we should retry
        if (tx.attempts < (tx.maxRetries ?? this.config.defaultMaxRetries)) {
          if (this.shouldRetry(tx.error)) {
            // Calculate backoff delay
            const delay = this.calculateBackoff(tx.attempts);
            await this.sleep(delay);
            continue;
          }
        }

        // No more retries - fail
        tx.status = 'failed';
        this.config.onFail?.(tx.id, tx.error);
        tx.onError?.(tx.error);
        tx.reject(tx.error);

        // Remove from queue
        this.removeFromQueue(tx.id);
        return;
      }
    }
  }

  /** Check if error is retryable */
  private shouldRetry(error: Error): boolean {
    const message = error.message.toLowerCase();

    // Non-retryable errors
    if (
      message.includes('insufficient balance') ||
      message.includes('sequence number') ||
      message.includes('rejected') ||
      message.includes('abort code')
    ) {
      return false;
    }

    // Retryable errors (network, timeout, etc.)
    return (
      message.includes('timeout') ||
      message.includes('network') ||
      message.includes('econnreset') ||
      message.includes('rate limit') ||
      message.includes('too many requests')
    );
  }

  /** Calculate backoff delay with jitter */
  private calculateBackoff(attempt: number): number {
    const exponentialDelay =
      this.config.baseRetryDelay * Math.pow(2, attempt - 1);
    const cappedDelay = Math.min(exponentialDelay, this.config.maxRetryDelay);

    // Add jitter (10-30% random variation)
    const jitter = cappedDelay * (0.1 + Math.random() * 0.2);
    return Math.floor(cappedDelay + jitter);
  }

  /** Remove transaction from queue */
  private removeFromQueue(id: string): void {
    const index = this.queue.findIndex((tx) => tx.id === id);
    if (index !== -1) {
      this.queue.splice(index, 1);
    }
  }

  /** Sleep helper */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Get queue status */
  getStatus(): {
    pending: number;
    active: number;
    total: number;
  } {
    return {
      pending: this.queue.filter((tx) => tx.status === 'pending').length,
      active: this.activeCount,
      total: this.queue.length,
    };
  }

  /** Get transaction by ID */
  getTransaction(
    id: string
  ): { status: TransactionStatus; hash?: string; error?: Error } | null {
    const tx = this.queue.find((t) => t.id === id);
    if (!tx) return null;

    return {
      status: tx.status,
      hash: tx.hash,
      error: tx.error,
    };
  }

  /** Cancel pending transaction */
  cancel(id: string): boolean {
    const tx = this.queue.find((t) => t.id === id);
    if (!tx || tx.status !== 'pending') {
      return false;
    }

    tx.reject(new Error('Transaction cancelled'));
    this.removeFromQueue(id);
    return true;
  }

  /** Clear all pending transactions */
  clearPending(): void {
    const pending = this.queue.filter((tx) => tx.status === 'pending');
    for (const tx of pending) {
      tx.reject(new Error('Queue cleared'));
      this.removeFromQueue(tx.id);
    }
  }
}

/** Generate unique transaction ID */
export function generateTransactionId(): string {
  return `tx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
