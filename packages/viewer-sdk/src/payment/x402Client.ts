/**
 * x402 payment client - supports both raw Account and wallet adapter
 *
 * Payment token: USDC (Fungible Asset standard)
 */

import type {
  Account,
  Aptos,
  InputGenerateTransactionPayloadData,
  PendingTransactionResponse,
} from '@aptos-labs/ts-sdk';
import { StreamLockContract, createStreamLockContract, USDC_METADATA_ADDRESS } from '@streamlock/aptos';

/** Wallet adapter sign and submit function type */
export type SignAndSubmitTransactionFunction = (
  transaction: InputGenerateTransactionPayloadData
) => Promise<PendingTransactionResponse>;

/** Payment request */
export interface PaymentRequest {
  videoId: bigint;
  segmentIndex: number;
  sessionId: bigint;
}

/** Payment result */
export interface PaymentResult {
  transactionHash: string;
  amount: bigint;
  segmentIndex: number;
  gasUsed?: bigint;
}

/** Configuration for X402PaymentClient */
export interface X402PaymentClientConfig {
  /** Aptos client instance */
  aptosClient: Aptos;
  /** Contract address */
  contractAddress: string;
  /** Account address (for balance lookups) */
  accountAddress: string;
  /** Either a raw Account or wallet adapter's signAndSubmitTransaction */
  signer: Account | SignAndSubmitTransactionFunction;
}

/** x402 payment client - works with wallet adapter or raw Account */
export class X402PaymentClient {
  private client: Aptos;
  private contract: StreamLockContract;
  private contractAddress: string;
  private accountAddress: string;
  private signer: Account | SignAndSubmitTransactionFunction;
  private isWalletAdapter: boolean;

  constructor(config: X402PaymentClientConfig) {
    this.client = config.aptosClient;
    this.contractAddress = config.contractAddress;
    this.accountAddress = config.accountAddress;
    this.signer = config.signer;
    this.isWalletAdapter = typeof config.signer === 'function';
    this.contract = createStreamLockContract(config.aptosClient, {
      address: config.contractAddress,
      moduleName: 'protocol',
    });
  }

  /** Get function identifier */
  private functionId(name: string): `${string}::${string}::${string}` {
    return `${this.contractAddress}::protocol::${name}`;
  }

  /** Pay for a segment */
  async payForSegment(request: PaymentRequest): Promise<PaymentResult> {
    // Get segment price
    const price = await this.contract.getSegmentPrice(request.videoId);

    if (this.isWalletAdapter) {
      // Use wallet adapter
      const signAndSubmit = this.signer as SignAndSubmitTransactionFunction;
      const payload: InputGenerateTransactionPayloadData = {
        function: this.functionId('pay_for_segment'),
        functionArguments: [request.sessionId.toString(), request.segmentIndex],
      };

      const pendingTx = await signAndSubmit(payload);

      // Wait for transaction
      const response = await this.client.waitForTransaction({
        transactionHash: pendingTx.hash,
      });

      return {
        transactionHash: pendingTx.hash,
        amount: price,
        segmentIndex: request.segmentIndex,
        gasUsed: 'gas_used' in response ? BigInt(response.gas_used) : undefined,
      };
    } else {
      // Use raw Account
      const result = await this.contract.payForSegment(this.signer as Account, {
        sessionId: request.sessionId,
        segmentIndex: request.segmentIndex,
      });

      return {
        transactionHash: result.hash,
        amount: price,
        segmentIndex: request.segmentIndex,
        gasUsed: result.gasUsed,
      };
    }
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

  /** Get USDC balance */
  async getBalance(): Promise<bigint> {
    try {
      // Use primary_fungible_store::balance view function for USDC (FA standard)
      const result = await this.client.view({
        payload: {
          function: '0x1::primary_fungible_store::balance',
          typeArguments: ['0x1::fungible_asset::Metadata'],
          functionArguments: [this.accountAddress, USDC_METADATA_ADDRESS],
        },
      });
      return BigInt(result[0] as string);
    } catch {
      // Account may not have a USDC store yet
      return 0n;
    }
  }

  /** Get segment price for a video */
  async getSegmentPrice(videoId: bigint): Promise<bigint> {
    return this.contract.getSegmentPrice(videoId);
  }

  /** Check if segment is already paid */
  async isSegmentPaid(sessionId: bigint, segmentIndex: number): Promise<boolean> {
    return this.contract.isSegmentPaid(sessionId, segmentIndex);
  }

  /** Update the signer function (for wallet adapter reference stability) */
  updateSigner(signer: Account | SignAndSubmitTransactionFunction): void {
    this.signer = signer;
    this.isWalletAdapter = typeof signer === 'function';
  }
}
