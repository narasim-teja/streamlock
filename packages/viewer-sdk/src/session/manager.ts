/**
 * Session lifecycle management with chain sync
 */

import type { SessionInfo } from '@streamlock/common';
import type { StreamLockContract } from '@streamlock/aptos';

/** Video info for session */
export interface SessionVideoInfo {
  videoId: string;
  totalSegments: number;
  pricePerSegment: bigint;
}

/** Serialized session for storage */
export interface SerializedSessionData {
  session: {
    sessionId: string;
    videoId: string;
    prepaidBalance: string; // bigint as string
    segmentsPaid: number;
    expiresAt: number;
  };
  video: {
    videoId: string;
    totalSegments: number;
    pricePerSegment: string; // bigint as string
  };
  segmentsPaid: number[];
}

/** Session manager with chain sync support */
export class SessionManager {
  private session: SessionInfo;
  private video: SessionVideoInfo;
  private segmentsPaid: Set<number> = new Set();
  private lastSyncTime: number = 0;

  constructor(session: SessionInfo, video: SessionVideoInfo) {
    this.session = session;
    this.video = video;
  }

  /** Create from serialized data */
  static fromJSON(data: SerializedSessionData): SessionManager {
    const session: SessionInfo = {
      sessionId: data.session.sessionId,
      videoId: data.session.videoId,
      prepaidBalance: BigInt(data.session.prepaidBalance),
      segmentsPaid: data.session.segmentsPaid,
      expiresAt: data.session.expiresAt,
    };

    const video: SessionVideoInfo = {
      videoId: data.video.videoId,
      totalSegments: data.video.totalSegments,
      pricePerSegment: BigInt(data.video.pricePerSegment),
    };

    const manager = new SessionManager(session, video);
    for (const index of data.segmentsPaid) {
      manager.segmentsPaid.add(index);
    }
    return manager;
  }

  /** Serialize for storage (handles bigint) */
  toJSON(): SerializedSessionData {
    return {
      session: {
        sessionId: this.session.sessionId,
        videoId: this.session.videoId,
        prepaidBalance: this.session.prepaidBalance.toString(),
        segmentsPaid: this.session.segmentsPaid,
        expiresAt: this.session.expiresAt,
      },
      video: {
        videoId: this.video.videoId,
        totalSegments: this.video.totalSegments,
        pricePerSegment: this.video.pricePerSegment.toString(),
      },
      segmentsPaid: Array.from(this.segmentsPaid),
    };
  }

  /** Sync with on-chain state */
  async syncWithChain(contract: StreamLockContract): Promise<boolean> {
    try {
      const onChainSession = await contract.getSession(this.session.sessionId);

      if (!onChainSession) {
        // Session no longer exists on-chain
        return false;
      }

      if (!onChainSession.isActive) {
        // Session ended on-chain
        return false;
      }

      // Update local state from on-chain
      this.session.prepaidBalance = onChainSession.prepaidBalance;
      this.session.segmentsPaid = onChainSession.segmentsPaid;
      this.lastSyncTime = Date.now();

      return true;
    } catch (error) {
      console.error('Failed to sync session with chain:', error);
      return false;
    }
  }

  /** Validate session is still valid on-chain */
  async validateOnChain(contract: StreamLockContract): Promise<boolean> {
    try {
      const onChainSession = await contract.getSession(this.session.sessionId);
      return onChainSession !== null && onChainSession.isActive;
    } catch {
      return false;
    }
  }

  /** Get last sync time */
  getLastSyncTime(): number {
    return this.lastSyncTime;
  }

  /** Get session info */
  getSessionInfo(): SessionInfo {
    return { ...this.session };
  }

  /** Get video info */
  getVideoInfo(): SessionVideoInfo {
    return { ...this.video };
  }

  /** Get remaining balance */
  getRemainingBalance(): bigint {
    return this.session.prepaidBalance - this.getTotalPaid();
  }

  /** Get total paid */
  getTotalPaid(): bigint {
    return BigInt(this.segmentsPaid.size) * this.video.pricePerSegment;
  }

  /** Get segments paid count */
  getSegmentsPaidCount(): number {
    return this.segmentsPaid.size;
  }

  /** Check if segment is paid */
  isSegmentPaid(index: number): boolean {
    return this.segmentsPaid.has(index);
  }

  /** Mark segment as paid */
  markSegmentPaid(index: number): void {
    this.segmentsPaid.add(index);
    this.session.segmentsPaid = this.segmentsPaid.size;
  }

  /** Add balance (after top-up) */
  addBalance(amount: bigint): void {
    this.session.prepaidBalance += amount;
  }

  /** Check if session is expired */
  isExpired(): boolean {
    return Date.now() / 1000 > this.session.expiresAt;
  }

  /** Check if balance is low */
  isLowBalance(threshold: number): boolean {
    const remainingSegments =
      Number(this.getRemainingBalance() / this.video.pricePerSegment);
    return remainingSegments <= threshold;
  }

  /** Get segments remaining */
  getSegmentsRemaining(): number {
    return Number(this.getRemainingBalance() / this.video.pricePerSegment);
  }

  /** Check if can afford segment */
  canAffordSegment(): boolean {
    return this.getRemainingBalance() >= this.video.pricePerSegment;
  }

  /** Get next unpaid segment */
  getNextUnpaidSegment(currentSegment: number): number | null {
    for (let i = currentSegment; i < this.video.totalSegments; i++) {
      if (!this.segmentsPaid.has(i)) {
        return i;
      }
    }
    return null;
  }
}
