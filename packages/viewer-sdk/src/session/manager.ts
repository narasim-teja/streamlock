/**
 * Session lifecycle management
 */

import type { SessionInfo } from '@streamlock/common';

/** Video info for session */
export interface SessionVideoInfo {
  videoId: string;
  totalSegments: number;
  pricePerSegment: bigint;
}

/** Session manager */
export class SessionManager {
  private session: SessionInfo;
  private video: SessionVideoInfo;
  private segmentsPaid: Set<number> = new Set();

  constructor(session: SessionInfo, video: SessionVideoInfo) {
    this.session = session;
    this.video = video;
  }

  /** Get session info */
  getSessionInfo(): SessionInfo {
    return { ...this.session };
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
