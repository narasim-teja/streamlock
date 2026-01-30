/**
 * GET /api/videos - List all videos
 */

import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';

export async function GET() {
  try {
    const videos = await db
      .select({
        videoId: schema.videos.videoId,
        title: schema.videos.title,
        description: schema.videos.description,
        thumbnailUri: schema.videos.thumbnailUri,
        durationSeconds: schema.videos.durationSeconds,
        totalSegments: schema.videos.totalSegments,
        pricePerSegment: schema.videos.pricePerSegment,
        creatorAddress: schema.videos.creatorAddress,
        isActive: schema.videos.isActive,
        createdAt: schema.videos.createdAt,
      })
      .from(schema.videos)
      .where(eq(schema.videos.isActive, true));

    return NextResponse.json(videos);
  } catch (error) {
    console.error('Error fetching videos:', error);
    return NextResponse.json(
      { error: 'Failed to fetch videos' },
      { status: 500 }
    );
  }
}
