/**
 * Main StreamLockPlayer class - supports wallet adapter integration
 */

import Hls from 'hls.js';
import type {
  Aptos,
  Account,
  InputGenerateTransactionPayloadData,
  PendingTransactionResponse,
} from '@aptos-labs/ts-sdk';
import type {
  SessionInfo,
  SessionSummary,
  PaymentEvent,
} from '@streamlock/common';
import {
  DEFAULT_PREPAID_SEGMENTS,
  DEFAULT_TOPUP_THRESHOLD,
  SESSION_EXPIRY_SECONDS,
} from '@streamlock/common';
import { StreamLockContract, createStreamLockContract } from '@streamlock/aptos';
import { SessionManager } from './session/manager.js';
import {
  X402PaymentClient,
  type SignAndSubmitTransactionFunction,
} from './payment/x402Client.js';

/** Wallet adapter sign and submit function type (re-exported for convenience) */
export type { SignAndSubmitTransactionFunction };

/** Player configuration */
export interface StreamLockPlayerConfig {
  aptosClient: Aptos;
  contractAddress: string;
  keyServerBaseUrl: string;
}

/** Play options */
export interface PlayOptions {
  videoId: string;
  prepaidSegments?: number;
  autoTopUp?: boolean;
  topUpThreshold?: number;
  onPayment?: (payment: PaymentEvent) => void;
  onError?: (error: Error) => void;
  onSessionStart?: (session: SessionInfo) => void;
  onSessionEnd?: (summary: SessionSummary) => void;
  onLowBalance?: (remainingSegments: number) => void;
}

/** Video info returned from initialize */
export interface VideoInfo {
  videoId: string;
  contentUri: string;
  thumbnailUri: string;
  durationSeconds: number;
  totalSegments: number;
  pricePerSegment: bigint;
  creator: string;
}

/** Signer type - either raw Account or wallet adapter function */
export type PlayerSigner =
  | { type: 'account'; account: Account }
  | {
      type: 'wallet';
      signAndSubmit: SignAndSubmitTransactionFunction;
      address: string;
    };

/** StreamLock Player - supports both raw Account and wallet adapter */
export class StreamLockPlayer {
  private config: StreamLockPlayerConfig;
  private contract: StreamLockContract;
  private hls: Hls | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private sessionManager: SessionManager | null = null;
  private currentVideo: VideoInfo | null = null;
  private options: PlayOptions | null = null;
  private signer: PlayerSigner | null = null;
  private paymentClient: X402PaymentClient | null = null;

  constructor(config: StreamLockPlayerConfig) {
    this.config = config;
    this.contract = createStreamLockContract(config.aptosClient, {
      address: config.contractAddress,
      moduleName: 'protocol',
    });
  }

  /** Get function identifier */
  private functionId(name: string): `${string}::${string}::${string}` {
    return `${this.config.contractAddress}::protocol::${name}`;
  }

  /** Get account address from signer */
  private getSignerAddress(): string {
    if (!this.signer) throw new Error('No signer set');
    return this.signer.type === 'account'
      ? this.signer.account.accountAddress.toString()
      : this.signer.address;
  }

  /** Initialize player with video */
  async initialize(videoId: string): Promise<VideoInfo> {
    const video = await this.contract.getVideo(videoId);

    if (!video) {
      throw new Error(`Video not found: ${videoId}`);
    }

    this.currentVideo = {
      videoId: video.videoId,
      contentUri: video.contentUri,
      thumbnailUri: video.thumbnailUri,
      durationSeconds: video.durationSeconds,
      totalSegments: video.totalSegments,
      pricePerSegment: video.pricePerSegment,
      creator: video.creator,
    };

    return this.currentVideo;
  }

  /**
   * Start a viewing session with raw Account
   * @deprecated Use startSessionWithWallet for wallet adapter support
   */
  async startSession(
    signer: Account,
    prepaidSegments: number = DEFAULT_PREPAID_SEGMENTS
  ): Promise<SessionInfo> {
    this.signer = { type: 'account', account: signer };
    return this.createSession(prepaidSegments);
  }

  /**
   * Start a viewing session with wallet adapter
   */
  async startSessionWithWallet(
    signAndSubmit: SignAndSubmitTransactionFunction,
    accountAddress: string,
    prepaidSegments: number = DEFAULT_PREPAID_SEGMENTS
  ): Promise<SessionInfo> {
    this.signer = { type: 'wallet', signAndSubmit, address: accountAddress };
    return this.createSession(prepaidSegments);
  }

  /** Internal session creation logic */
  private async createSession(prepaidSegments: number): Promise<SessionInfo> {
    if (!this.currentVideo) {
      throw new Error('Player not initialized. Call initialize() first.');
    }
    if (!this.signer) {
      throw new Error('No signer set');
    }

    let txHash: string;

    if (this.signer.type === 'wallet') {
      // Use wallet adapter
      const payload: InputGenerateTransactionPayloadData = {
        function: this.functionId('start_session'),
        functionArguments: [
          this.currentVideo.videoId,
          prepaidSegments,
          SESSION_EXPIRY_SECONDS,
        ],
      };

      const pendingTx = await this.signer.signAndSubmit(payload);
      txHash = pendingTx.hash;

      // Wait for transaction
      await this.config.aptosClient.waitForTransaction({
        transactionHash: pendingTx.hash,
      });
    } else {
      // Use raw Account
      const result = await this.contract.startSession(this.signer.account, {
        videoId: this.currentVideo.videoId,
        prepaidSegments,
        maxDurationSeconds: SESSION_EXPIRY_SECONDS,
      });
      txHash = result.hash;
    }

    // Get transaction to extract events
    const tx = await this.config.aptosClient.getTransactionByHash({
      transactionHash: txHash,
    });

    // Extract session info from event
    const events = 'events' in tx ? tx.events : [];
    const sessionEvent = events.find((e: { type: string }) =>
      e.type.includes('SessionStartedEvent')
    );

    if (!sessionEvent) {
      throw new Error('Session creation failed: no event emitted');
    }

    const sessionData = sessionEvent.data as {
      session_id: string;
      video_id: string;
      prepaid_amount: string;
    };

    const sessionInfo: SessionInfo = {
      sessionId: sessionData.session_id,
      videoId: sessionData.video_id,
      prepaidBalance: BigInt(sessionData.prepaid_amount),
      segmentsPaid: 0,
      expiresAt: Math.floor(Date.now() / 1000) + SESSION_EXPIRY_SECONDS,
    };

    // Initialize session manager
    this.sessionManager = new SessionManager(sessionInfo, this.currentVideo);

    // Initialize payment client
    this.paymentClient = new X402PaymentClient({
      aptosClient: this.config.aptosClient,
      contractAddress: this.config.contractAddress,
      accountAddress: this.getSignerAddress(),
      signer:
        this.signer.type === 'wallet'
          ? this.signer.signAndSubmit
          : this.signer.account,
    });

    // Notify callback
    this.options?.onSessionStart?.(sessionInfo);

    return sessionInfo;
  }

  /** Attach to video element and start playback */
  attachToElement(
    videoElement: HTMLVideoElement,
    options?: Partial<PlayOptions>
  ): void {
    if (!this.currentVideo) {
      throw new Error('Player not initialized');
    }

    this.videoElement = videoElement;
    this.options = {
      videoId: this.currentVideo.videoId,
      prepaidSegments: DEFAULT_PREPAID_SEGMENTS,
      autoTopUp: true,
      topUpThreshold: DEFAULT_TOPUP_THRESHOLD,
      ...options,
    };

    // Check HLS support
    if (!Hls.isSupported()) {
      throw new Error('HLS is not supported in this browser');
    }

    // Create HLS instance with custom key loader
    this.hls = new Hls({
      // Custom loader for x402 key fetching would go here
      // For now, use default loader
    });

    this.hls.loadSource(this.currentVideo.contentUri);
    this.hls.attachMedia(videoElement);

    this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
      // Ready to play
    });

    this.hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) {
        this.options?.onError?.(new Error(data.details));
      }
    });
  }

  /** Play video */
  play(): void {
    this.videoElement?.play();
  }

  /** Pause video */
  pause(): void {
    this.videoElement?.pause();
  }

  /** Seek to time */
  seek(time: number): void {
    if (this.videoElement) {
      this.videoElement.currentTime = time;
    }
  }

  /** Get current playback time */
  getCurrentTime(): number {
    return this.videoElement?.currentTime ?? 0;
  }

  /** Get video duration */
  getDuration(): number {
    return this.videoElement?.duration ?? 0;
  }

  /** Check if playing */
  isPlaying(): boolean {
    return this.videoElement ? !this.videoElement.paused : false;
  }

  /** Get remaining balance */
  getRemainingBalance(): bigint {
    return this.sessionManager?.getRemainingBalance() ?? 0n;
  }

  /** Get session info */
  getSession(): SessionInfo | null {
    return this.sessionManager?.getSessionInfo() ?? null;
  }

  /** Top up session */
  async topUp(additionalSegments: number): Promise<void> {
    if (!this.sessionManager || !this.signer) {
      throw new Error('No active session');
    }

    const sessionId = this.sessionManager.getSessionInfo().sessionId;

    if (this.signer.type === 'wallet') {
      // Use wallet adapter
      const payload: InputGenerateTransactionPayloadData = {
        function: this.functionId('top_up_session'),
        functionArguments: [sessionId, additionalSegments],
      };

      const pendingTx = await this.signer.signAndSubmit(payload);
      await this.config.aptosClient.waitForTransaction({
        transactionHash: pendingTx.hash,
      });
    } else {
      // Use raw Account
      await this.contract.topUpSession(this.signer.account, {
        sessionId,
        additionalSegments,
      });
    }

    this.sessionManager.addBalance(
      BigInt(additionalSegments) * (this.currentVideo?.pricePerSegment ?? 0n)
    );
  }

  /** End session */
  async endSession(): Promise<SessionSummary> {
    if (!this.sessionManager || !this.signer) {
      throw new Error('No active session');
    }

    const sessionId = this.sessionManager.getSessionInfo().sessionId;
    let txHash: string;

    if (this.signer.type === 'wallet') {
      // Use wallet adapter
      const payload: InputGenerateTransactionPayloadData = {
        function: this.functionId('end_session'),
        functionArguments: [sessionId],
      };

      const pendingTx = await this.signer.signAndSubmit(payload);
      txHash = pendingTx.hash;
      await this.config.aptosClient.waitForTransaction({
        transactionHash: pendingTx.hash,
      });
    } else {
      // Use raw Account
      const result = await this.contract.endSession(
        this.signer.account,
        sessionId
      );
      txHash = result.hash;
    }

    // Get transaction to extract events
    const tx = await this.config.aptosClient.getTransactionByHash({
      transactionHash: txHash,
    });

    const events = 'events' in tx ? tx.events : [];
    const endEvent = events.find((e: { type: string }) =>
      e.type.includes('SessionEndedEvent')
    );

    const eventData = endEvent?.data as {
      segments_watched: string;
      total_paid: string;
      refunded: string;
    };

    const summary: SessionSummary = {
      segmentsWatched: parseInt(eventData?.segments_watched ?? '0'),
      totalPaid: BigInt(eventData?.total_paid ?? '0'),
      refunded: BigInt(eventData?.refunded ?? '0'),
      transactionHash: txHash,
    };

    this.options?.onSessionEnd?.(summary);

    // Cleanup
    this.sessionManager = null;
    this.paymentClient = null;

    return summary;
  }

  /** Get payment client */
  getPaymentClient(): X402PaymentClient | null {
    return this.paymentClient;
  }

  /** Get video element */
  getVideoElement(): HTMLVideoElement | null {
    return this.videoElement;
  }

  /** Get key server base URL */
  getKeyServerBaseUrl(): string {
    return this.config.keyServerBaseUrl;
  }

  /** Destroy player */
  destroy(): void {
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    this.videoElement = null;
    this.sessionManager = null;
    this.currentVideo = null;
  }
}
