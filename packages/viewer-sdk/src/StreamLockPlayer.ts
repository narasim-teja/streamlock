/**
 * Main StreamLockPlayer class
 */

import Hls from 'hls.js';
import type { Aptos, Account } from '@aptos-labs/ts-sdk';
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

/** StreamLock Player */
export class StreamLockPlayer {
  private config: StreamLockPlayerConfig;
  private contract: StreamLockContract;
  private hls: Hls | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private sessionManager: SessionManager | null = null;
  private currentVideo: VideoInfo | null = null;
  private options: PlayOptions | null = null;
  private signer: Account | null = null;

  constructor(config: StreamLockPlayerConfig) {
    this.config = config;
    this.contract = createStreamLockContract(config.aptosClient, {
      address: config.contractAddress,
      moduleName: 'protocol',
    });
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

  /** Start a viewing session */
  async startSession(
    signer: Account,
    prepaidSegments: number = DEFAULT_PREPAID_SEGMENTS
  ): Promise<SessionInfo> {
    if (!this.currentVideo) {
      throw new Error('Player not initialized. Call initialize() first.');
    }

    this.signer = signer;

    // Create session on-chain
    const result = await this.contract.startSession(signer, {
      videoId: this.currentVideo.videoId,
      prepaidSegments,
      maxDurationSeconds: SESSION_EXPIRY_SECONDS,
    });

    // Extract session info from event
    const sessionEvent = result.events.find((e) =>
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

    await this.contract.topUpSession(this.signer, {
      sessionId: this.sessionManager.getSessionInfo().sessionId,
      additionalSegments,
    });

    this.sessionManager.addBalance(
      BigInt(additionalSegments) * (this.currentVideo?.pricePerSegment ?? 0n)
    );
  }

  /** End session */
  async endSession(): Promise<SessionSummary> {
    if (!this.sessionManager || !this.signer) {
      throw new Error('No active session');
    }

    const result = await this.contract.endSession(
      this.signer,
      this.sessionManager.getSessionInfo().sessionId
    );

    const endEvent = result.events.find((e) =>
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
      transactionHash: result.hash,
    };

    this.options?.onSessionEnd?.(summary);

    // Cleanup
    this.sessionManager = null;

    return summary;
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
