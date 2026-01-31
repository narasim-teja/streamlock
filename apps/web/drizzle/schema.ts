/**
 * Database schema using Drizzle ORM for PostgreSQL (Supabase)
 */

import {
  pgTable,
  text,
  bigint,
  boolean,
  serial,
  timestamp,
  customType,
} from 'drizzle-orm/pg-core';

// Custom type for bytea (binary data)
const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return 'bytea';
  },
  toDriver(value: Buffer): string {
    return `\\x${value.toString('hex')}`;
  },
  fromDriver(value: unknown): Buffer {
    if (typeof value === 'string') {
      // Handle hex string format from Postgres
      const hex = value.startsWith('\\x') ? value.slice(2) : value;
      return Buffer.from(hex, 'hex');
    }
    if (Buffer.isBuffer(value)) {
      return value;
    }
    throw new Error('Expected Buffer or hex string from database');
  },
});

/** Creator profiles */
export const creators = pgTable('creators', {
  address: text('address').primaryKey(),
  metadataUri: text('metadata_uri'),
  registeredAt: timestamp('registered_at').defaultNow(),
});

/** Videos */
export const videos = pgTable('videos', {
  videoId: text('video_id').primaryKey(), // Local string ID for storage paths
  onChainVideoId: bigint('on_chain_video_id', { mode: 'bigint' }), // On-chain bigint ID
  creatorAddress: text('creator_address').references(() => creators.address),
  title: text('title').notNull(),
  description: text('description'),
  contentUri: text('content_uri').notNull(),
  thumbnailUri: text('thumbnail_uri'),
  durationSeconds: bigint('duration_seconds', { mode: 'number' }).notNull(),
  totalSegments: bigint('total_segments', { mode: 'number' }).notNull(),
  pricePerSegment: bigint('price_per_segment', { mode: 'bigint' }).notNull(),
  merkleRoot: text('merkle_root').notNull(),
  masterSecret: bytea('master_secret').notNull(),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  onChainTxHash: text('on_chain_tx_hash'),
});

/** Merkle trees (JSON serialized) */
export const merkleTrees = pgTable('merkle_trees', {
  videoId: text('video_id')
    .primaryKey()
    .references(() => videos.videoId),
  treeData: text('tree_data').notNull(),
});

/** Viewing sessions */
export const sessions = pgTable('sessions', {
  sessionId: text('session_id').primaryKey(), // Local string ID
  onChainSessionId: bigint('on_chain_session_id', { mode: 'bigint' }), // On-chain bigint ID
  videoId: text('video_id').references(() => videos.videoId),
  viewerAddress: text('viewer_address').notNull(),
  prepaidBalance: bigint('prepaid_balance', { mode: 'bigint' }).notNull(),
  segmentsPaid: bigint('segments_paid', { mode: 'number' }).default(0),
  startedAt: timestamp('started_at').defaultNow().notNull(),
  endedAt: timestamp('ended_at'),
  isActive: boolean('is_active').default(true),
});

/** Payment records */
export const payments = pgTable('payments', {
  id: serial('id').primaryKey(),
  sessionId: text('session_id').references(() => sessions.sessionId),
  segmentIndex: bigint('segment_index', { mode: 'number' }).notNull(),
  amount: bigint('amount', { mode: 'bigint' }).notNull(),
  txHash: text('tx_hash').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Type exports for use in application
export type Creator = typeof creators.$inferSelect;
export type NewCreator = typeof creators.$inferInsert;
export type Video = typeof videos.$inferSelect;
export type NewVideo = typeof videos.$inferInsert;
export type MerkleTree = typeof merkleTrees.$inferSelect;
export type NewMerkleTree = typeof merkleTrees.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
