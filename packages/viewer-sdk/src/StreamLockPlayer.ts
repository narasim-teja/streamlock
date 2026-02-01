/**
 * Main StreamLockPlayer class - supports wallet adapter integration
 * and session key signing for popup-free playback
 */

import Hls from 'hls.js';
import type {
  Aptos,
  Account,
  InputGenerateTransactionPayloadData,
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
import { SessionKeyManager } from './session/sessionKeyManager.js';
import type { SessionKeyStorage } from './session/sessionKeyTypes.js';
import type {
  SessionKeyConfig,
  LiveSessionKeyState,
} from './session/sessionKeyTypes.js';
import {
  X402PaymentClient,
  type SignAndSubmitTransactionFunction,
} from './payment/x402Client.js';
import { X402KeyLoader } from './playback/hlsLoader.js';
import { createX402LoaderClass } from './playback/X402HlsLoader.js';

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
  videoId: bigint;
  localVideoId: string; // String ID for storage/API paths
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
  videoId: bigint;
  localVideoId: string; // String ID for storage/API paths
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
    }
  | {
      type: 'sessionKey';
      manager: SessionKeyManager;
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
  private keyLoader: X402KeyLoader | null = null;
  private sessionKeyManager: SessionKeyManager | null = null;

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
    switch (this.signer.type) {
      case 'account':
        return this.signer.account.accountAddress.toString();
      case 'wallet':
        return this.signer.address;
      case 'sessionKey':
        return this.signer.manager.getAddress() ?? '';
    }
  }

  /**
   * Initialize player with video
   * @param videoId - On-chain video ID (bigint)
   * @param localVideoId - String ID for storage paths (from upload result)
   */
  async initialize(videoId: bigint, localVideoId: string): Promise<VideoInfo> {
    const video = await this.contract.getVideo(videoId);

    if (!video) {
      throw new Error(`Video not found: ${videoId}`);
    }

    this.currentVideo = {
      videoId: video.videoId,
      localVideoId,
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

  /**
   * Start a viewing session with ephemeral session key (SINGLE popup for funding)
   *
   * This creates an ephemeral keypair, funds it from the user's main wallet,
   * and uses it for all subsequent payments without popups.
   *
   * @param signAndSubmit - Wallet adapter's sign function (used once for funding)
   * @param accountAddress - Main wallet address
   * @param config - Session key configuration (spending limit, etc.)
   * @param storage - Optional storage for session key persistence
   * @returns Session info with session key active
   */
  async startSessionWithSessionKey(
    signAndSubmit: SignAndSubmitTransactionFunction,
    accountAddress: string,
    config: SessionKeyConfig,
    storage?: SessionKeyStorage
  ): Promise<SessionInfo> {
    if (!this.currentVideo) {
      throw new Error('Player not initialized. Call initialize() first.');
    }

    // Create session key manager with optional storage
    this.sessionKeyManager = new SessionKeyManager(storage);

    // Check if we can restore from storage
    if (this.sessionKeyManager.restore()) {
      const state = this.sessionKeyManager.getState();
      if (state && state.videoId === this.currentVideo.videoId && state.sessionId) {
        // Restore existing session
        this.signer = { type: 'sessionKey', manager: this.sessionKeyManager };

        // Sync balance with chain
        const balance = await this.getAccountBalance(state.address);
        this.sessionKeyManager.setBalance(balance);

        // Initialize payment client and key loader with session key
        this.initializePaymentComponents();

        const sessionInfo: SessionInfo = {
          sessionId: state.sessionId,
          videoId: state.videoId,
          prepaidBalance: balance,
          segmentsPaid: 0, // Will be synced
          expiresAt: Math.floor(Date.now() / 1000) + SESSION_EXPIRY_SECONDS,
        };

        // Initialize session manager
        this.sessionManager = new SessionManager(sessionInfo, this.currentVideo);

        return sessionInfo;
      }
      // Different video or no session, clear and start fresh
      this.sessionKeyManager.destroy();
      this.sessionKeyManager = new SessionKeyManager(storage);
    }

    // Generate new ephemeral keypair
    const ephemeralAccount = this.sessionKeyManager.generate();
    const ephemeralAddress = ephemeralAccount.accountAddress.toString();

    // Calculate funding amount
    const fundingAmount = SessionKeyManager.calculateFundingAmount(
      config,
      this.currentVideo.pricePerSegment
    );

    // Fund ephemeral account (SINGLE WALLET POPUP)
    await this.fundEphemeralAccount(signAndSubmit, ephemeralAddress, fundingAmount);

    // Initialize session key manager state
    this.sessionKeyManager.initialize(accountAddress, config.spendingLimit);

    // Verify funding
    const balance = await this.getAccountBalance(ephemeralAddress);
    this.sessionKeyManager.setBalance(balance);

    if (balance < fundingAmount) {
      throw new Error(`Funding failed: expected ${fundingAmount}, got ${balance}`);
    }

    // Set signer to use session key
    this.signer = { type: 'sessionKey', manager: this.sessionKeyManager };

    // Calculate prepaid segments from spending limit
    const prepaidSegments = Number(config.spendingLimit / this.currentVideo.pricePerSegment);

    // Create session using ephemeral account (no popup)
    const sessionInfo = await this.createSession(prepaidSegments);

    // Update session key manager with session info
    this.sessionKeyManager.setSessionInfo(sessionInfo.sessionId, sessionInfo.videoId);

    return sessionInfo;
  }

  /**
   * Fund the ephemeral account from main wallet
   */
  private async fundEphemeralAccount(
    signAndSubmit: SignAndSubmitTransactionFunction,
    ephemeralAddress: string,
    amount: bigint
  ): Promise<string> {
    const payload: InputGenerateTransactionPayloadData = {
      function: '0x1::aptos_account::transfer',
      functionArguments: [ephemeralAddress, amount.toString()],
    };

    const pendingTx = await signAndSubmit(payload);
    await this.config.aptosClient.waitForTransaction({
      transactionHash: pendingTx.hash,
    });

    return pendingTx.hash;
  }

  /**
   * Get account balance
   */
  private async getAccountBalance(address: string): Promise<bigint> {
    try {
      const resources = await this.config.aptosClient.getAccountResources({
        accountAddress: address,
      });

      const coinStore = resources.find(
        (r) => r.type === '0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>'
      );

      if (!coinStore) {
        return 0n;
      }

      const data = coinStore.data as { coin: { value: string } };
      return BigInt(data.coin.value);
    } catch {
      return 0n;
    }
  }

  /**
   * Initialize payment components with current signer
   */
  private initializePaymentComponents(): void {
    if (!this.signer || !this.currentVideo || !this.sessionKeyManager) {
      return;
    }

    const state = this.sessionKeyManager.getState();
    if (!state?.sessionId) {
      return;
    }

    const account = this.sessionKeyManager.getAccount();
    if (!account) {
      return;
    }

    // Initialize payment client with session key account
    this.paymentClient = new X402PaymentClient({
      aptosClient: this.config.aptosClient,
      contractAddress: this.config.contractAddress,
      accountAddress: state.address,
      signer: account, // Ed25519Account - will sign without popup
    });

    // Initialize key loader
    this.keyLoader = new X402KeyLoader({
      keyServerBaseUrl: this.config.keyServerBaseUrl,
      sessionId: state.sessionId,
      videoId: state.videoId!,
      localVideoId: this.currentVideo.localVideoId,
      aptosClient: this.config.aptosClient,
      contractAddress: this.config.contractAddress,
      accountAddress: state.address,
      signer: account, // Ed25519Account - will sign without popup
      onPayment: (segmentIndex, txHash, amount) => {
        // Track payment in session key manager
        this.sessionKeyManager?.recordPayment(amount, 100_000n); // Estimate gas
        this.options?.onPayment?.({
          segmentIndex,
          amount,
          txHash,
          timestamp: Date.now(),
        });
      },
      onError: (error) => {
        this.options?.onError?.(error);
      },
    });
  }

  /**
   * Return remaining session key balance to main wallet
   */
  async returnSessionKeyFunds(): Promise<string | null> {
    if (!this.sessionKeyManager?.isActive()) {
      return null;
    }

    const state = this.sessionKeyManager.getState();
    const account = this.sessionKeyManager.getAccount();
    if (!state || !account) {
      return null;
    }

    // Get current balance
    const currentBalance = await this.getAccountBalance(state.address);
    if (currentBalance <= 0n) {
      return null;
    }

    // Estimate gas for transfer (conservative)
    const estimatedGas = 100_000n;
    const transferAmount = currentBalance - estimatedGas;

    if (transferAmount <= 0n) {
      return null; // Not enough to transfer after gas
    }

    // Transfer back to main wallet using ephemeral key
    const txn = await this.config.aptosClient.transaction.build.simple({
      sender: account.accountAddress,
      data: {
        function: '0x1::aptos_account::transfer',
        functionArguments: [state.fundingWallet, transferAmount.toString()],
      },
    });

    const pendingTxn = await this.config.aptosClient.signAndSubmitTransaction({
      signer: account,
      transaction: txn,
    });

    await this.config.aptosClient.waitForTransaction({
      transactionHash: pendingTxn.hash,
    });

    return pendingTxn.hash;
  }

  /**
   * Check if using session key
   */
  isUsingSessionKey(): boolean {
    return this.signer?.type === 'sessionKey';
  }

  /**
   * Get session key state
   */
  getSessionKeyState(): LiveSessionKeyState | null {
    return this.sessionKeyManager?.getState() ?? null;
  }

  /**
   * Get session key manager (for advanced use cases)
   */
  getSessionKeyManager(): SessionKeyManager | null {
    return this.sessionKeyManager;
  }

  /**
   * Get the signer for payment operations
   */
  private getSignerForPayment(): Account | SignAndSubmitTransactionFunction {
    if (!this.signer) {
      throw new Error('No signer set');
    }

    switch (this.signer.type) {
      case 'wallet':
        return this.signer.signAndSubmit;
      case 'account':
        return this.signer.account;
      case 'sessionKey': {
        const account = this.signer.manager.getAccount();
        if (!account) {
          throw new Error('Session key account not available');
        }
        return account;
      }
    }
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
      // Use wallet adapter (triggers popup)
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
    } else if (this.signer.type === 'account') {
      // Use raw Account (no popup)
      const result = await this.contract.startSession(this.signer.account, {
        videoId: this.currentVideo.videoId,
        prepaidSegments,
        maxDurationSeconds: SESSION_EXPIRY_SECONDS,
      });
      txHash = result.hash;
    } else {
      // Use session key (no popup)
      const account = this.signer.manager.getAccount();
      if (!account) {
        throw new Error('Session key account not available');
      }
      const result = await this.contract.startSession(account, {
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
      sessionId: BigInt(sessionData.session_id),
      videoId: BigInt(sessionData.video_id),
      prepaidBalance: BigInt(sessionData.prepaid_amount),
      segmentsPaid: 0,
      expiresAt: Math.floor(Date.now() / 1000) + SESSION_EXPIRY_SECONDS,
    };

    // Initialize session manager
    this.sessionManager = new SessionManager(sessionInfo, this.currentVideo);

    // Get the signer for payment operations
    const paymentSigner = this.getSignerForPayment();

    // Initialize payment client
    this.paymentClient = new X402PaymentClient({
      aptosClient: this.config.aptosClient,
      contractAddress: this.config.contractAddress,
      accountAddress: this.getSignerAddress(),
      signer: paymentSigner,
    });

    // Initialize key loader for x402 payments
    this.keyLoader = new X402KeyLoader({
      keyServerBaseUrl: this.config.keyServerBaseUrl,
      sessionId: sessionInfo.sessionId,
      videoId: sessionInfo.videoId,
      localVideoId: this.currentVideo.localVideoId,
      aptosClient: this.config.aptosClient,
      contractAddress: this.config.contractAddress,
      accountAddress: this.getSignerAddress(),
      signer: paymentSigner,
      onPayment: (segmentIndex, txHash, amount) => {
        // Track payment in session key manager if active
        if (this.signer?.type === 'sessionKey') {
          this.signer.manager.recordPayment(amount, 100_000n);
        }
        this.options?.onPayment?.({
          segmentIndex,
          amount,
          txHash,
          timestamp: Date.now(),
        });
      },
      onError: (error) => {
        this.options?.onError?.(error);
      },
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
    if (!this.keyLoader) {
      throw new Error('Session not started. Call startSession() or startSessionWithWallet() first.');
    }

    this.videoElement = videoElement;
    this.options = {
      videoId: this.currentVideo.videoId,
      localVideoId: this.currentVideo.localVideoId,
      prepaidSegments: DEFAULT_PREPAID_SEGMENTS,
      autoTopUp: true,
      topUpThreshold: DEFAULT_TOPUP_THRESHOLD,
      ...options,
    };

    // Check HLS support
    if (!Hls.isSupported()) {
      throw new Error('HLS is not supported in this browser');
    }

    // Create custom loader class that intercepts key requests
    // and handles x402 payment flow through X402KeyLoader
    const X402Loader = createX402LoaderClass({
      keyLoader: this.keyLoader,
      onKeyLoading: (segmentIndex) => {
        console.log(`StreamLock: Loading key for segment ${segmentIndex}`);
      },
      onKeyLoaded: (segmentIndex) => {
        console.log(`StreamLock: Key loaded for segment ${segmentIndex}`);
      },
      onPaymentRequired: (segmentIndex) => {
        console.log(`StreamLock: Payment required for segment ${segmentIndex}`);
      },
      onPaymentComplete: (segmentIndex, txHash) => {
        console.log(`StreamLock: Payment complete for segment ${segmentIndex}: ${txHash}`);
      },
      onError: (segmentIndex, error) => {
        console.error(`StreamLock: Error loading key for segment ${segmentIndex}:`, error);
        this.options?.onError?.(error);
      },
    });

    // Create HLS instance with custom loader for x402 key requests
    this.hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
      loader: X402Loader,
    });

    this.hls.loadSource(this.currentVideo.contentUri);
    this.hls.attachMedia(videoElement);

    this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
      console.log('StreamLock: Manifest parsed, ready to play');
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
      // Use wallet adapter (popup)
      const payload: InputGenerateTransactionPayloadData = {
        function: this.functionId('top_up_session'),
        functionArguments: [sessionId.toString(), additionalSegments],
      };

      const pendingTx = await this.signer.signAndSubmit(payload);
      await this.config.aptosClient.waitForTransaction({
        transactionHash: pendingTx.hash,
      });
    } else if (this.signer.type === 'account') {
      // Use raw Account (no popup)
      await this.contract.topUpSession(this.signer.account, {
        sessionId,
        additionalSegments,
      });
    } else {
      // Use session key (no popup)
      const account = this.signer.manager.getAccount();
      if (!account) {
        throw new Error('Session key account not available');
      }
      await this.contract.topUpSession(account, {
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
      // Use wallet adapter (popup)
      const payload: InputGenerateTransactionPayloadData = {
        function: this.functionId('end_session'),
        functionArguments: [sessionId.toString()],
      };

      const pendingTx = await this.signer.signAndSubmit(payload);
      txHash = pendingTx.hash;
      await this.config.aptosClient.waitForTransaction({
        transactionHash: pendingTx.hash,
      });
    } else if (this.signer.type === 'account') {
      // Use raw Account (no popup)
      const result = await this.contract.endSession(
        this.signer.account,
        sessionId
      );
      txHash = result.hash;
    } else {
      // Use session key (no popup)
      const account = this.signer.manager.getAccount();
      if (!account) {
        throw new Error('Session key account not available');
      }
      const result = await this.contract.endSession(account, sessionId);
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
    this.keyLoader?.clearCache();
    this.keyLoader = null;

    // Note: Session key manager is NOT cleared here to allow returning funds
    // Call returnSessionKeyFunds() before destroy() if you want to return funds

    return summary;
  }

  /** Get payment client */
  getPaymentClient(): X402PaymentClient | null {
    return this.paymentClient;
  }

  /** Get key loader */
  getKeyLoader(): X402KeyLoader | null {
    return this.keyLoader;
  }

  /** Get video element */
  getVideoElement(): HTMLVideoElement | null {
    return this.videoElement;
  }

  /** Get key server base URL */
  getKeyServerBaseUrl(): string {
    return this.config.keyServerBaseUrl;
  }

  /** Destroy player and cleanup all resources */
  destroy(): void {
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    this.videoElement = null;
    this.sessionManager = null;
    this.currentVideo = null;
    this.sessionKeyManager?.destroy();
    this.sessionKeyManager = null;
  }

  /**
   * Update the wallet signer function
   * Call this when the wallet adapter recreates the signAndSubmitTransaction function
   * to keep the player's signer reference current
   */
  updateSigner(signAndSubmit: SignAndSubmitTransactionFunction, address?: string): void {
    if (this.signer?.type === 'wallet') {
      this.signer = {
        type: 'wallet',
        signAndSubmit,
        address: address ?? this.signer.address,
      };

      // Propagate to payment client
      if (this.paymentClient) {
        this.paymentClient.updateSigner(signAndSubmit);
      }

      // Propagate to key loader
      if (this.keyLoader) {
        this.keyLoader.updateSigner(signAndSubmit);
      }
    }
  }
}
