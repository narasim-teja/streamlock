/**
 * Contract event parsing
 */

import type { Event } from '@aptos-labs/ts-sdk';
import type { ContractEvent } from './types.js';

/** Event type constants */
export const EVENT_TYPES = {
  CREATOR_REGISTERED: 'CreatorRegisteredEvent',
  VIDEO_REGISTERED: 'VideoRegisteredEvent',
  SESSION_STARTED: 'SessionStartedEvent',
  SEGMENT_PAID: 'SegmentPaidEvent',
  SESSION_ENDED: 'SessionEndedEvent',
  EARNINGS_WITHDRAWN: 'EarningsWithdrawnEvent',
} as const;

/** Parse raw events from transaction */
export function parseTransactionEvents(events: Event[]): ContractEvent[] {
  return events.map((event) => ({
    type: event.type,
    data: event.data as Record<string, unknown>,
    sequenceNumber: BigInt(event.sequence_number),
  }));
}

/** Extract VideoRegistered event data */
export function parseVideoRegisteredEvent(event: ContractEvent): {
  videoId: string;
  creator: string;
  totalSegments: number;
  pricePerSegment: bigint;
  commitmentRoot: string;
  timestamp: number;
} | null {
  if (!event.type.includes(EVENT_TYPES.VIDEO_REGISTERED)) {
    return null;
  }

  const data = event.data;
  return {
    videoId: data.video_id as string,
    creator: data.creator as string,
    totalSegments: parseInt(data.total_segments as string),
    pricePerSegment: BigInt(data.price_per_segment as string),
    commitmentRoot: Buffer.from(data.commitment_root as number[]).toString('hex'),
    timestamp: parseInt(data.timestamp as string),
  };
}

/** Extract SessionStarted event data */
export function parseSessionStartedEvent(event: ContractEvent): {
  sessionId: string;
  videoId: string;
  viewer: string;
  prepaidAmount: bigint;
  timestamp: number;
} | null {
  if (!event.type.includes(EVENT_TYPES.SESSION_STARTED)) {
    return null;
  }

  const data = event.data;
  return {
    sessionId: data.session_id as string,
    videoId: data.video_id as string,
    viewer: data.viewer as string,
    prepaidAmount: BigInt(data.prepaid_amount as string),
    timestamp: parseInt(data.timestamp as string),
  };
}

/** Extract SegmentPaid event data */
export function parseSegmentPaidEvent(event: ContractEvent): {
  sessionId: string;
  videoId: string;
  segmentIndex: number;
  amount: bigint;
  timestamp: number;
} | null {
  if (!event.type.includes(EVENT_TYPES.SEGMENT_PAID)) {
    return null;
  }

  const data = event.data;
  return {
    sessionId: data.session_id as string,
    videoId: data.video_id as string,
    segmentIndex: parseInt(data.segment_index as string),
    amount: BigInt(data.amount as string),
    timestamp: parseInt(data.timestamp as string),
  };
}

/** Extract SessionEnded event data */
export function parseSessionEndedEvent(event: ContractEvent): {
  sessionId: string;
  segmentsWatched: number;
  totalPaid: bigint;
  refunded: bigint;
  timestamp: number;
} | null {
  if (!event.type.includes(EVENT_TYPES.SESSION_ENDED)) {
    return null;
  }

  const data = event.data;
  return {
    sessionId: data.session_id as string,
    segmentsWatched: parseInt(data.segments_watched as string),
    totalPaid: BigInt(data.total_paid as string),
    refunded: BigInt(data.refunded as string),
    timestamp: parseInt(data.timestamp as string),
  };
}

/** Extract EarningsWithdrawn event data */
export function parseEarningsWithdrawnEvent(event: ContractEvent): {
  creator: string;
  amount: bigint;
  timestamp: number;
} | null {
  if (!event.type.includes(EVENT_TYPES.EARNINGS_WITHDRAWN)) {
    return null;
  }

  const data = event.data;
  return {
    creator: data.creator as string,
    amount: BigInt(data.amount as string),
    timestamp: parseInt(data.timestamp as string),
  };
}

/** Find specific event type in array */
export function findEvent(
  events: ContractEvent[],
  eventType: string
): ContractEvent | undefined {
  return events.find((e) => e.type.includes(eventType));
}
