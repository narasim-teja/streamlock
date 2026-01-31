/**
 * StreamLock contract interaction methods
 */

import {
  Aptos,
  Account,
  type InputGenerateTransactionPayloadData,
  type CommittedTransactionResponse,
  type UserTransactionResponse,
} from '@aptos-labs/ts-sdk';
import { ContractError } from '@streamlock/common';
import type {
  ContractConfig,
  TransactionResult,
  RegisterCreatorParams,
  RegisterVideoParams,
  StartSessionParams,
  PayForSegmentParams,
  TopUpSessionParams,
  OnChainVideo,
  OnChainSession,
  OnChainCreator,
} from './types.js';
import { parseTransactionEvents } from './events.js';

const MODULE_NAME = 'protocol';

/** StreamLock contract client */
export class StreamLockContract {
  private client: Aptos;
  private contractAddress: string;

  constructor(client: Aptos, contractAddress: string) {
    this.client = client;
    this.contractAddress = contractAddress;
  }

  /** Build function identifier */
  private functionId(name: string): `${string}::${string}::${string}` {
    return `${this.contractAddress}::${MODULE_NAME}::${name}`;
  }

  /** Execute a transaction */
  private async executeTransaction(
    signer: Account,
    payload: InputGenerateTransactionPayloadData
  ): Promise<TransactionResult> {
    const transaction = await this.client.transaction.build.simple({
      sender: signer.accountAddress,
      data: payload,
    });

    const pendingTxn = await this.client.signAndSubmitTransaction({
      signer,
      transaction,
    });

    const response = await this.client.waitForTransaction({
      transactionHash: pendingTxn.hash,
    });

    return this.parseTransactionResult(response);
  }

  /** Parse transaction response */
  private parseTransactionResult(
    response: CommittedTransactionResponse
  ): TransactionResult {
    const userTxn = response as UserTransactionResponse;

    if (!userTxn.success) {
      // Improved error parsing with regex
      const abortCodeMatch = userTxn.vm_status.match(/abort code: (\d+)/i)
        || userTxn.vm_status.match(/code (\d+)/);
      const abortCode = abortCodeMatch ? parseInt(abortCodeMatch[1], 10) : 0;
      throw ContractError.fromAbortCode(abortCode);
    }

    return {
      hash: userTxn.hash,
      success: userTxn.success,
      vmStatus: userTxn.vm_status,
      gasUsed: BigInt(userTxn.gas_used),
      events: parseTransactionEvents(userTxn.events),
    };
  }

  // ============ Entry Functions ============

  /** Register as a creator */
  async registerCreator(
    signer: Account,
    params: RegisterCreatorParams
  ): Promise<TransactionResult> {
    return this.executeTransaction(signer, {
      function: this.functionId('register_creator'),
      functionArguments: [params.metadataUri],
    });
  }

  /** Register a new video */
  async registerVideo(
    signer: Account,
    params: RegisterVideoParams
  ): Promise<TransactionResult> {
    return this.executeTransaction(signer, {
      function: this.functionId('register_video'),
      functionArguments: [
        params.contentUri,
        params.thumbnailUri,
        params.durationSeconds,
        params.totalSegments,
        Array.from(
          typeof params.keyCommitmentRoot === 'string'
            ? Buffer.from(params.keyCommitmentRoot, 'hex')
            : params.keyCommitmentRoot
        ),
        params.pricePerSegment.toString(),
      ],
    });
  }

  /** Update video price */
  async updateVideoPrice(
    signer: Account,
    videoId: string,
    newPricePerSegment: bigint
  ): Promise<TransactionResult> {
    return this.executeTransaction(signer, {
      function: this.functionId('update_video_price'),
      functionArguments: [videoId, newPricePerSegment.toString()],
    });
  }

  /** Deactivate a video */
  async deactivateVideo(
    signer: Account,
    videoId: string
  ): Promise<TransactionResult> {
    return this.executeTransaction(signer, {
      function: this.functionId('deactivate_video'),
      functionArguments: [videoId],
    });
  }

  /** Start a viewing session */
  async startSession(
    signer: Account,
    params: StartSessionParams
  ): Promise<TransactionResult> {
    return this.executeTransaction(signer, {
      function: this.functionId('start_session'),
      functionArguments: [
        params.videoId,
        params.prepaidSegments,
        params.maxDurationSeconds,
      ],
    });
  }

  /** Pay for a segment */
  async payForSegment(
    signer: Account,
    params: PayForSegmentParams
  ): Promise<TransactionResult> {
    return this.executeTransaction(signer, {
      function: this.functionId('pay_for_segment'),
      functionArguments: [params.sessionId, params.segmentIndex],
    });
  }

  /** Top up session balance */
  async topUpSession(
    signer: Account,
    params: TopUpSessionParams
  ): Promise<TransactionResult> {
    return this.executeTransaction(signer, {
      function: this.functionId('top_up_session'),
      functionArguments: [params.sessionId, params.additionalSegments],
    });
  }

  /** End a session */
  async endSession(
    signer: Account,
    sessionId: string
  ): Promise<TransactionResult> {
    return this.executeTransaction(signer, {
      function: this.functionId('end_session'),
      functionArguments: [sessionId],
    });
  }

  /** Withdraw creator earnings */
  async withdrawEarnings(signer: Account): Promise<TransactionResult> {
    return this.executeTransaction(signer, {
      function: this.functionId('withdraw_earnings'),
      functionArguments: [],
    });
  }

  /** Withdraw protocol fees (admin only) */
  async withdrawProtocolFees(signer: Account): Promise<TransactionResult> {
    return this.executeTransaction(signer, {
      function: this.functionId('withdraw_protocol_fees'),
      functionArguments: [],
    });
  }

  // ============ View Functions ============

  /** Get video details */
  async getVideo(videoId: string): Promise<OnChainVideo | null> {
    try {
      const result = await this.client.view({
        payload: {
          function: this.functionId('get_video'),
          functionArguments: [videoId],
        },
      });

      // Validate response array length
      if (!Array.isArray(result) || result.length < 8) {
        console.error('Invalid video response format:', result);
        return null;
      }

      const [
        creator,
        contentUri,
        thumbnailUri,
        durationSeconds,
        totalSegments,
        keyCommitmentRoot,
        pricePerSegment,
        isActive,
      ] = result as [string, string, string, string, string, number[], string, boolean];

      // Validate keyCommitmentRoot is an array
      if (!Array.isArray(keyCommitmentRoot)) {
        console.error('Invalid keyCommitmentRoot format:', keyCommitmentRoot);
        return null;
      }

      return {
        videoId,
        creator,
        contentUri,
        thumbnailUri,
        durationSeconds: parseInt(String(durationSeconds), 10),
        totalSegments: parseInt(String(totalSegments), 10),
        keyCommitmentRoot: Buffer.from(keyCommitmentRoot).toString('hex'),
        pricePerSegment: BigInt(pricePerSegment),
        totalViews: 0, // Not returned by view function
        totalEarnings: 0n, // Not returned by view function
        isActive: Boolean(isActive),
        createdAt: 0, // Not returned by view function
      };
    } catch (error) {
      console.error('Failed to get video:', error);
      return null;
    }
  }

  /** Get session details */
  async getSession(sessionId: string): Promise<OnChainSession | null> {
    try {
      const result = await this.client.view({
        payload: {
          function: this.functionId('get_session'),
          functionArguments: [sessionId],
        },
      });

      // Validate response array length
      if (!Array.isArray(result) || result.length < 7) {
        console.error('Invalid session response format:', result);
        return null;
      }

      const [
        videoId,
        viewer,
        creator,
        segmentsPaid,
        prepaidBalance,
        totalPaid,
        isActive,
      ] = result as [string, string, string, string, string, string, boolean];

      return {
        sessionId,
        videoId,
        viewer,
        creator,
        segmentsPaid: parseInt(String(segmentsPaid), 10),
        prepaidBalance: BigInt(prepaidBalance),
        totalPaid: BigInt(totalPaid),
        startedAt: 0, // Not returned by view function
        expiresAt: 0, // Not returned by view function
        isActive: Boolean(isActive),
      };
    } catch (error) {
      console.error('Failed to get session:', error);
      return null;
    }
  }

  /** Get creator details */
  async getCreator(address: string): Promise<OnChainCreator | null> {
    try {
      const result = await this.client.view({
        payload: {
          function: this.functionId('get_creator'),
          functionArguments: [address],
        },
      });

      // Validate response array length
      if (!Array.isArray(result) || result.length < 3) {
        console.error('Invalid creator response format:', result);
        return null;
      }

      const [totalEarnings, pendingWithdrawal, totalVideos] = result as [
        string,
        string,
        string
      ];

      return {
        totalEarnings: BigInt(totalEarnings),
        pendingWithdrawal: BigInt(pendingWithdrawal),
        totalVideos: parseInt(String(totalVideos), 10),
        registeredAt: 0,
        metadataUri: '',
      };
    } catch (error) {
      console.error('Failed to get creator:', error);
      return null;
    }
  }

  /** Get segment price for a video */
  async getSegmentPrice(videoId: string): Promise<bigint> {
    const result = await this.client.view({
      payload: {
        function: this.functionId('get_segment_price'),
        functionArguments: [videoId],
      },
    });

    return BigInt(result[0] as string);
  }

  /** Check if segment is paid */
  async isSegmentPaid(sessionId: string, segmentIndex: number): Promise<boolean> {
    const result = await this.client.view({
      payload: {
        function: this.functionId('is_segment_paid'),
        functionArguments: [sessionId, segmentIndex],
      },
    });

    return Boolean(result[0]);
  }

  /** Get escrow address */
  async getEscrowAddress(): Promise<string> {
    const result = await this.client.view({
      payload: {
        function: this.functionId('get_escrow_address'),
        functionArguments: [],
      },
    });

    return result[0] as string;
  }

  /** Get total protocol fees */
  async getProtocolFees(): Promise<bigint> {
    const result = await this.client.view({
      payload: {
        function: this.functionId('get_protocol_fees'),
        functionArguments: [],
      },
    });

    return BigInt(result[0] as string);
  }

  // ============ Gas Estimation ============

  /** Gas estimate result */
  /** Simulate a transaction to estimate gas */
  async simulateTransaction(
    senderAddress: string,
    payload: InputGenerateTransactionPayloadData
  ): Promise<{
    gasUnits: bigint;
    gasPrice: bigint;
    totalCost: bigint;
    success: boolean;
    vmStatus?: string;
  }> {
    try {
      const transaction = await this.client.transaction.build.simple({
        sender: senderAddress,
        data: payload,
      });

      const [simulation] = await this.client.transaction.simulate.simple({
        signerPublicKey: await this.getPublicKeyForAddress(senderAddress),
        transaction,
      });

      const gasUnits = BigInt(simulation.gas_used);
      const gasPrice = BigInt(simulation.gas_unit_price);

      return {
        gasUnits,
        gasPrice,
        totalCost: gasUnits * gasPrice,
        success: simulation.success,
        vmStatus: simulation.vm_status,
      };
    } catch (error) {
      // Return default estimates on simulation failure
      return {
        gasUnits: 10000n,
        gasPrice: 100n,
        totalCost: 1000000n,
        success: false,
        vmStatus: error instanceof Error ? error.message : 'Simulation failed',
      };
    }
  }

  /** Get public key for address (for simulation) */
  private async getPublicKeyForAddress(address: string): Promise<{ key: string; type: string }> {
    try {
      const account = await this.client.getAccountInfo({ accountAddress: address });
      // Return a placeholder key structure - simulation doesn't require actual signature
      return {
        key: account.authentication_key || address,
        type: 'ed25519',
      };
    } catch {
      // Fallback for new accounts
      return {
        key: address,
        type: 'ed25519',
      };
    }
  }

  /** Estimate gas for start_session */
  async estimateStartSession(
    viewerAddress: string,
    videoId: string,
    prepaidSegments: number,
    maxDurationSeconds: number
  ): Promise<{ gasUnits: bigint; totalCost: bigint }> {
    const result = await this.simulateTransaction(viewerAddress, {
      function: this.functionId('start_session'),
      functionArguments: [videoId, prepaidSegments, maxDurationSeconds],
    });

    return {
      gasUnits: result.gasUnits,
      totalCost: result.totalCost,
    };
  }

  /** Estimate gas for pay_for_segment */
  async estimatePayForSegment(
    viewerAddress: string,
    sessionId: string,
    segmentIndex: number
  ): Promise<{ gasUnits: bigint; totalCost: bigint }> {
    const result = await this.simulateTransaction(viewerAddress, {
      function: this.functionId('pay_for_segment'),
      functionArguments: [sessionId, segmentIndex],
    });

    return {
      gasUnits: result.gasUnits,
      totalCost: result.totalCost,
    };
  }

  /** Estimate gas for end_session */
  async estimateEndSession(
    viewerAddress: string,
    sessionId: string
  ): Promise<{ gasUnits: bigint; totalCost: bigint }> {
    const result = await this.simulateTransaction(viewerAddress, {
      function: this.functionId('end_session'),
      functionArguments: [sessionId],
    });

    return {
      gasUnits: result.gasUnits,
      totalCost: result.totalCost,
    };
  }

  /** Get current gas price */
  async getGasPrice(): Promise<bigint> {
    try {
      const estimate = await this.client.getGasPriceEstimation();
      return BigInt(estimate.gas_estimate);
    } catch {
      return 100n; // Default gas price
    }
  }
}

/** Create contract instance */
export function createStreamLockContract(
  client: Aptos,
  config: ContractConfig
): StreamLockContract {
  return new StreamLockContract(client, config.address);
}
