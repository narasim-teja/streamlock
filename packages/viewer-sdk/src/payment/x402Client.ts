/**
 * x402 payment client
 */

import type { Account, Aptos } from '@aptos-labs/ts-sdk';
import { StreamLockContract, createStreamLockContract } from '@streamlock/aptos';

/** Payment request */
export interface PaymentRequest {
  videoId: string;
  segmentIndex: number;
  sessionId: string;
}

/** Payment result */
export interface PaymentResult {
  transactionHash: string;
  amount: bigint;
  segmentIndex: number;
}

/** x402 payment client */
export class X402PaymentClient {
  private signer: Account;
  private client: Aptos;
  private contract: StreamLockContract;

  constructor(signer: Account, client: Aptos, contractAddress: string) {
    this.signer = signer;
    this.client = client;
    this.contract = createStreamLockContract(client, {
      address: contractAddress,
      moduleName: 'protocol',
    });
  }

  /** Pay for a segment */
  async payForSegment(request: PaymentRequest): Promise<PaymentResult> {
    // Get segment price
    const price = await this.contract.getSegmentPrice(request.videoId);

    // Execute payment transaction
    const result = await this.contract.payForSegment(this.signer, {
      sessionId: request.sessionId,
      segmentIndex: request.segmentIndex,
    });

    return {
      transactionHash: result.hash,
      amount: price,
      segmentIndex: request.segmentIndex,
    };
  }

  /** Verify a payment */
  async verifyPayment(txHash: string): Promise<boolean> {
    try {
      const tx = await this.client.getTransactionByHash({
        transactionHash: txHash,
      });

      return 'success' in tx && tx.success === true;
    } catch {
      return false;
    }
  }

  /** Get account balance */
  async getBalance(): Promise<bigint> {
    const resources = await this.client.getAccountResources({
      accountAddress: this.signer.accountAddress,
    });

    const coinStore = resources.find(
      (r) => r.type === '0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>'
    );

    if (!coinStore) {
      return 0n;
    }

    const data = coinStore.data as { coin: { value: string } };
    return BigInt(data.coin.value);
  }
}
