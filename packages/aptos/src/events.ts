/**
 * Contract event parsing
 */

import type { Event } from '@aptos-labs/ts-sdk';
import type { ContractEvent } from './types.js';

/** Event type constants */
export const EVENT_TYPES = {
  CREATOR_REGISTERED: 'CreatorRegisteredEvent',
  VIDEO_REGISTERED: 'VideoRegisteredEvent',
  VIDEO_PRICE_UPDATED: 'VideoPriceUpdatedEvent',
  VIDEO_DEACTIVATED: 'VideoDeactivatedEvent',
  SESSION_STARTED: 'SessionStartedEvent',
  SEGMENT_PAID: 'SegmentPaidEvent',
  SESSION_TOPPED_UP: 'SessionToppedUpEvent',
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

/** Helper to safely parse event data field */
function safeParseField<T>(data: Record<string, unknown>, field: string, defaultValue: T): T {
  const value = data[field];
  if (value === undefined || value === null) {
    console.warn(`Missing event field: ${field}`);
    return defaultValue;
  }
  return value as T;
}

/** Helper to safely parse numeric string */
function safeParseInt(value: unknown, defaultValue = 0): number {
  if (value === undefined || value === null) return defaultValue;
  const parsed = parseInt(String(value), 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/** Helper to safely parse bigint */
function safeParseBigInt(value: unknown, defaultValue = 0n): bigint {
  if (value === undefined || value === null) return defaultValue;
  try {
    return BigInt(String(value));
  } catch {
    return defaultValue;
  }
}

/** Check if event type matches (handles full module path) */
function matchesEventType(eventType: string, expectedType: string): boolean {
  // Handle both short name and full module path
  return eventType.endsWith(`::${expectedType}`) || eventType === expectedType;
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
  if (!matchesEventType(event.type, EVENT_TYPES.VIDEO_REGISTERED)) {
    return null;
  }

  const data = event.data;

  // Validate required fields exist
  if (!data.video_id || !data.creator) {
    console.error('Missing required fields in VideoRegisteredEvent:', data);
    return null;
  }

  // Safely parse commitment root
  let commitmentRoot = '';
  const rawRoot = data.commitment_root;
  if (Array.isArray(rawRoot)) {
    try {
      commitmentRoot = Buffer.from(rawRoot as number[]).toString('hex');
    } catch (e) {
      console.error('Failed to parse commitment_root:', e);
    }
  }

  return {
    videoId: String(data.video_id),
    creator: String(data.creator),
    totalSegments: safeParseInt(data.total_segments),
    pricePerSegment: safeParseBigInt(data.price_per_segment),
    commitmentRoot,
    timestamp: safeParseInt(data.timestamp),
  };
}

/** Extract VideoPriceUpdated event data */
export function parseVideoPriceUpdatedEvent(event: ContractEvent): {
  videoId: string;
  oldPrice: bigint;
  newPrice: bigint;
  timestamp: number;
} | null {
  if (!matchesEventType(event.type, EVENT_TYPES.VIDEO_PRICE_UPDATED)) {
    return null;
  }

  const data = event.data;
  return {
    videoId: String(safeParseField(data, 'video_id', '')),
    oldPrice: safeParseBigInt(data.old_price),
    newPrice: safeParseBigInt(data.new_price),
    timestamp: safeParseInt(data.timestamp),
  };
}

/** Extract VideoDeactivated event data */
export function parseVideoDeactivatedEvent(event: ContractEvent): {
  videoId: string;
  timestamp: number;
} | null {
  if (!matchesEventType(event.type, EVENT_TYPES.VIDEO_DEACTIVATED)) {
    return null;
  }

  const data = event.data;
  return {
    videoId: String(safeParseField(data, 'video_id', '')),
    timestamp: safeParseInt(data.timestamp),
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
  if (!matchesEventType(event.type, EVENT_TYPES.SESSION_STARTED)) {
    return null;
  }

  const data = event.data;
  return {
    sessionId: String(safeParseField(data, 'session_id', '')),
    videoId: String(safeParseField(data, 'video_id', '')),
    viewer: String(safeParseField(data, 'viewer', '')),
    prepaidAmount: safeParseBigInt(data.prepaid_amount),
    timestamp: safeParseInt(data.timestamp),
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
  if (!matchesEventType(event.type, EVENT_TYPES.SEGMENT_PAID)) {
    return null;
  }

  const data = event.data;
  return {
    sessionId: String(safeParseField(data, 'session_id', '')),
    videoId: String(safeParseField(data, 'video_id', '')),
    segmentIndex: safeParseInt(data.segment_index),
    amount: safeParseBigInt(data.amount),
    timestamp: safeParseInt(data.timestamp),
  };
}

/** Extract SessionToppedUp event data */
export function parseSessionToppedUpEvent(event: ContractEvent): {
  sessionId: string;
  additionalAmount: bigint;
  newBalance: bigint;
  timestamp: number;
} | null {
  if (!matchesEventType(event.type, EVENT_TYPES.SESSION_TOPPED_UP)) {
    return null;
  }

  const data = event.data;
  return {
    sessionId: String(safeParseField(data, 'session_id', '')),
    additionalAmount: safeParseBigInt(data.additional_amount),
    newBalance: safeParseBigInt(data.new_balance),
    timestamp: safeParseInt(data.timestamp),
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
  if (!matchesEventType(event.type, EVENT_TYPES.SESSION_ENDED)) {
    return null;
  }

  const data = event.data;
  return {
    sessionId: String(safeParseField(data, 'session_id', '')),
    segmentsWatched: safeParseInt(data.segments_watched),
    totalPaid: safeParseBigInt(data.total_paid),
    refunded: safeParseBigInt(data.refunded),
    timestamp: safeParseInt(data.timestamp),
  };
}

/** Extract EarningsWithdrawn event data */
export function parseEarningsWithdrawnEvent(event: ContractEvent): {
  creator: string;
  amount: bigint;
  timestamp: number;
} | null {
  if (!matchesEventType(event.type, EVENT_TYPES.EARNINGS_WITHDRAWN)) {
    return null;
  }

  const data = event.data;
  return {
    creator: String(safeParseField(data, 'creator', '')),
    amount: safeParseBigInt(data.amount),
    timestamp: safeParseInt(data.timestamp),
  };
}

/** Find specific event type in array */
export function findEvent(
  events: ContractEvent[],
  eventType: string
): ContractEvent | undefined {
  return events.find((e) => matchesEventType(e.type, eventType));
}

/** Find all events of a specific type */
export function findAllEvents(
  events: ContractEvent[],
  eventType: string
): ContractEvent[] {
  return events.filter((e) => matchesEventType(e.type, eventType));
}
