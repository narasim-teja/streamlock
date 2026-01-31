/**
 * GET /api/videos - List all videos
 */

import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, desc } from 'drizzle-orm';

export async function GET() {
  try {
    const videos = await db
      .select({
        videoId: schema.videos.videoId,
        onChainVideoId: schema.videos.onChainVideoId,
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
      .where(eq(schema.videos.isActive, true))
      .orderBy(desc(schema.videos.createdAt));

    // Serialize bigint values for JSON
    const serializedVideos = videos.map((video) => ({
      ...video,
      onChainVideoId: video.onChainVideoId?.toString() || null,
      pricePerSegment: video.pricePerSegment.toString(),
      createdAt: video.createdAt?.toISOString() || null,
    }));

    return NextResponse.json(serializedVideos);
  } catch (error) {
    console.error('Error fetching videos:', error);
    return NextResponse.json(
      { error: 'Failed to fetch videos' },
      { status: 500 }
    );
  }
}
