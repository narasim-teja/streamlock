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
    // Convert and validate key commitment root (must be exactly 32 bytes for SHA256)
    const rootBytes = typeof params.keyCommitmentRoot === 'string'
      ? Buffer.from(params.keyCommitmentRoot, 'hex')
      : Buffer.from(params.keyCommitmentRoot);

    if (rootBytes.length !== 32) {
      throw new ContractError(
        12, // E_INVALID_COMMITMENT
        `Key commitment root must be exactly 32 bytes (SHA256 hash), got ${rootBytes.length} bytes`
      );
    }

    return this.executeTransaction(signer, {
      function: this.functionId('register_video'),
      functionArguments: [
        params.contentUri,
        params.thumbnailUri,
        params.durationSeconds,
        params.totalSegments,
        Array.from(rootBytes),
        params.pricePerSegment.toString(),
      ],
    });
  }

  /** Update video price */
  async updateVideoPrice(
    signer: Account,
    videoId: bigint,
    newPricePerSegment: bigint
  ): Promise<TransactionResult> {
    return this.executeTransaction(signer, {
      function: this.functionId('update_video_price'),
      functionArguments: [videoId.toString(), newPricePerSegment.toString()],
    });
  }

  /** Deactivate a video */
  async deactivateVideo(
    signer: Account,
    videoId: bigint
  ): Promise<TransactionResult> {
    return this.executeTransaction(signer, {
      function: this.functionId('deactivate_video'),
      functionArguments: [videoId.toString()],
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
        params.videoId.toString(),
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
      functionArguments: [params.sessionId.toString(), params.segmentIndex],
    });
  }

  /** Top up session balance */
  async topUpSession(
    signer: Account,
    params: TopUpSessionParams
  ): Promise<TransactionResult> {
    return this.executeTransaction(signer, {
      function: this.functionId('top_up_session'),
      functionArguments: [params.sessionId.toString(), params.additionalSegments],
    });
  }

  /** End a session */
  async endSession(
    signer: Account,
    sessionId: bigint
  ): Promise<TransactionResult> {
    return this.executeTransaction(signer, {
      function: this.functionId('end_session'),
      functionArguments: [sessionId.toString()],
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
  async getVideo(videoId: bigint): Promise<OnChainVideo | null> {
    try {
      const result = await this.client.view({
        payload: {
          function: this.functionId('get_video'),
          functionArguments: [videoId.toString()],
        },
      });

      // Validate response array length
      // Move returns: (address, String, String, u64, u64, vector<u8>, u64, bool)
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
      ] = result as [string, string, string, string, string, number[] | string, string, boolean];

      // Convert keyCommitmentRoot to hex string
      // Aptos can return it as either a byte array or a hex string depending on version
      let keyCommitmentRootHex: string;
      if (Array.isArray(keyCommitmentRoot)) {
        keyCommitmentRootHex = Buffer.from(keyCommitmentRoot).toString('hex');
      } else if (typeof keyCommitmentRoot === 'string') {
        // Already a hex string, just strip 0x prefix if present
        keyCommitmentRootHex = keyCommitmentRoot.startsWith('0x')
          ? keyCommitmentRoot.slice(2)
          : keyCommitmentRoot;
      } else {
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
        keyCommitmentRoot: keyCommitmentRootHex,
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
  async getSession(sessionId: bigint): Promise<OnChainSession | null> {
    try {
      const result = await this.client.view({
        payload: {
          function: this.functionId('get_session'),
          functionArguments: [sessionId.toString()],
        },
      });

      // Validate response array length
      // Move returns: (u128, address, address, u64, u64, u64, bool)
      // Order: video_id, viewer, creator, segments_paid, prepaid_balance, total_paid, is_active
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
        videoId: BigInt(videoId), // u128 from Move
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
  async getSegmentPrice(videoId: bigint): Promise<bigint> {
    const result = await this.client.view({
      payload: {
        function: this.functionId('get_segment_price'),
        functionArguments: [videoId.toString()],
      },
    });

    return BigInt(result[0] as string);
  }

  /** Check if segment is paid */
  async isSegmentPaid(sessionId: bigint, segmentIndex: number): Promise<boolean> {
    const result = await this.client.view({
      payload: {
        function: this.functionId('is_segment_paid'),
        functionArguments: [sessionId.toString(), segmentIndex],
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

  /**
   * Get gas estimate for a transaction.
   *
   * IMPORTANT: This method returns CONSERVATIVE FALLBACK estimates (0.05 APT).
   *
   * Why we can't simulate accurately:
   * - Aptos transaction simulation requires a valid PublicKey object
   * - We only have the sender address (string), not the Account/PublicKey
   * - Without PublicKey, the Aptos SDK cannot create a valid simulation request
   *
   * The 0.05 APT fallback is intentionally high to ensure transactions succeed.
   * Typical StreamLock transactions use ~0.001-0.01 APT in gas.
   *
   * For accurate gas estimation, use `simulateTransactionWithAccount()` when
   * you have access to the full Account object (with publicKey).
   *
   * @param _senderAddress - Sender's address (unused - simulation not possible)
   * @param _payload - Transaction payload (unused - simulation not possible)
   * @returns Conservative gas estimate of 0.05 APT
   */
  async estimateGas(
    _senderAddress: string,
    _payload: InputGenerateTransactionPayloadData
  ): Promise<{
    gasUnits: bigint;
    gasPrice: bigint;
    totalCost: bigint;
    success: boolean;
    vmStatus?: string;
  }> {
    // Transaction simulation requires a valid PublicKey object which we cannot create
    // without the account's private key. Return conservative fallback estimates.
    // 0.05 APT should cover most StreamLock transactions (sessions, payments, etc.)
    return {
      gasUnits: 50000n,
      gasPrice: 100n,
      totalCost: 5000000n, // 0.05 APT - conservative fallback
      success: true,
      vmStatus: 'Estimated (simulation skipped - requires Account with publicKey)',
    };
  }

  /**
   * Simulate a transaction to estimate gas when you have access to the Account object.
   * This provides accurate gas estimation by actually simulating the transaction.
   */
  async simulateTransactionWithAccount(
    account: Account,
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
        sender: account.accountAddress,
        data: payload,
      });

      const [simulation] = await this.client.transaction.simulate.simple({
        signerPublicKey: account.publicKey,
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
      // Return safer fallback estimates on simulation failure
      return {
        gasUnits: 50000n,
        gasPrice: 100n,
        totalCost: 5000000n, // 0.05 APT - safer fallback
        success: false,
        vmStatus: error instanceof Error ? error.message : 'Simulation failed',
      };
    }
  }

  /**
   * @deprecated Use estimateGas or simulateTransactionWithAccount instead
   * Legacy method kept for backwards compatibility
   */
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
    return this.estimateGas(senderAddress, payload);
  }

  /** Estimate gas for start_session */
  async estimateStartSession(
    viewerAddress: string,
    videoId: bigint,
    prepaidSegments: number,
    maxDurationSeconds: number
  ): Promise<{ gasUnits: bigint; totalCost: bigint; success: boolean }> {
    const result = await this.simulateTransaction(viewerAddress, {
      function: this.functionId('start_session'),
      functionArguments: [videoId.toString(), prepaidSegments, maxDurationSeconds],
    });

    return {
      gasUnits: result.gasUnits,
      totalCost: result.totalCost,
      success: result.success,
    };
  }

  /** Estimate gas for pay_for_segment */
  async estimatePayForSegment(
    viewerAddress: string,
    sessionId: bigint,
    segmentIndex: number
  ): Promise<{ gasUnits: bigint; totalCost: bigint; success: boolean }> {
    const result = await this.simulateTransaction(viewerAddress, {
      function: this.functionId('pay_for_segment'),
      functionArguments: [sessionId.toString(), segmentIndex],
    });

    return {
      gasUnits: result.gasUnits,
      totalCost: result.totalCost,
      success: result.success,
    };
  }

  /** Estimate gas for end_session */
  async estimateEndSession(
    viewerAddress: string,
    sessionId: bigint
  ): Promise<{ gasUnits: bigint; totalCost: bigint; success: boolean }> {
    const result = await this.simulateTransaction(viewerAddress, {
      function: this.functionId('end_session'),
      functionArguments: [sessionId.toString()],
    });

    return {
      gasUnits: result.gasUnits,
      totalCost: result.totalCost,
      success: result.success,
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

  // ============ Event Queries ============

  /**
   * Get all video IDs registered by a creator
   *
   * Uses the Aptos indexer to query VideoRegisteredEvent events.
   * Returns video IDs that can be used to fetch full video details.
   *
   * @param creatorAddress - Creator's Aptos address
   * @param limit - Maximum number of results (default: 100)
   * @returns Array of video IDs registered by this creator
   */
  async getVideoIdsByCreator(
    creatorAddress: string,
    limit = 100
  ): Promise<bigint[]> {
    try {
      // Query events from the contract module
      const eventType = `${this.contractAddress}::protocol::VideoRegisteredEvent`;

      const events = await this.client.getEvents({
        options: {
          where: {
            account_address: { _eq: this.contractAddress },
            type: { _eq: eventType },
          },
          limit,
          orderBy: [{ transaction_block_height: 'desc' }],
        },
      });

      // Filter events by creator and extract video IDs
      const videoIds: bigint[] = [];
      for (const event of events) {
        const data = event.data as Record<string, unknown>;
        if (data.creator === creatorAddress && data.video_id !== undefined) {
          videoIds.push(BigInt(String(data.video_id)));
        }
      }

      return videoIds;
    } catch (error) {
      // Indexer may not be available - return empty array
      console.warn('Failed to query video events:', error instanceof Error ? error.message : error);
      return [];
    }
  }

  /**
   * Get all videos registered by a creator with full details
   *
   * Queries VideoRegisteredEvent events and enriches with on-chain video data.
   *
   * @param creatorAddress - Creator's Aptos address
   * @param limit - Maximum number of results (default: 100)
   * @returns Array of video details
   */
  async getVideosByCreator(
    creatorAddress: string,
    limit = 100
  ): Promise<OnChainVideo[]> {
    const videoIds = await this.getVideoIdsByCreator(creatorAddress, limit);

    // Fetch full video details for each ID
    const videos: OnChainVideo[] = [];
    for (const videoId of videoIds) {
      const video = await this.getVideo(videoId);
      if (video && video.isActive) {
        videos.push(video);
      }
    }

    return videos;
  }
}

/** Create contract instance */
export function createStreamLockContract(
  client: Aptos,
  config: ContractConfig
): StreamLockContract {
  return new StreamLockContract(client, config.address);
}
