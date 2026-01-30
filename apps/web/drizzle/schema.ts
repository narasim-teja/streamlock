/**
 * Database schema using Drizzle ORM
 */

import { sqliteTable, text, integer, blob } from 'drizzle-orm/sqlite-core';

/** Creator profiles */
export const creators = sqliteTable('creators', {
  address: text('address').primaryKey(),
  metadataUri: text('metadata_uri'),
  registeredAt: integer('registered_at'),
});

/** Videos */
export const videos = sqliteTable('videos', {
  videoId: text('video_id').primaryKey(),
  creatorAddress: text('creator_address').references(() => creators.address),
  title: text('title').notNull(),
  description: text('description'),
  contentUri: text('content_uri').notNull(),
  thumbnailUri: text('thumbnail_uri'),
  durationSeconds: integer('duration_seconds').notNull(),
  totalSegments: integer('total_segments').notNull(),
  pricePerSegment: integer('price_per_segment').notNull(),
  merkleRoot: text('merkle_root').notNull(),
  masterSecret: blob('master_secret', { mode: 'buffer' }).notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: integer('created_at').notNull(),
  onChainTxHash: text('on_chain_tx_hash'),
});

/** Merkle trees (JSON serialized) */
export const merkleTrees = sqliteTable('merkle_trees', {
  videoId: text('video_id')
    .primaryKey()
    .references(() => videos.videoId),
  treeData: text('tree_data').notNull(),
});

/** Viewing sessions */
export const sessions = sqliteTable('sessions', {
  sessionId: text('session_id').primaryKey(),
  videoId: text('video_id').references(() => videos.videoId),
  viewerAddress: text('viewer_address').notNull(),
  prepaidBalance: integer('prepaid_balance').notNull(),
  segmentsPaid: integer('segments_paid').default(0),
  startedAt: integer('started_at').notNull(),
  endedAt: integer('ended_at'),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  onChainSessionId: text('on_chain_session_id'),
});

/** Payment records */
export const payments = sqliteTable('payments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionId: text('session_id').references(() => sessions.sessionId),
  segmentIndex: integer('segment_index').notNull(),
  amount: integer('amount').notNull(),
  txHash: text('tx_hash').notNull(),
  createdAt: integer('created_at').notNull(),
});
