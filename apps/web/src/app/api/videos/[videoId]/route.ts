/**
 * GET /api/videos/[videoId] - Get video metadata
 */

import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';

export async function GET(
  request: Request,
  { params }: { params: { videoId: string } }
) {
  try {
    const { videoId } = params;

    const video = await db
      .select({
        videoId: schema.videos.videoId,
        title: schema.videos.title,
        description: schema.videos.description,
        contentUri: schema.videos.contentUri,
        thumbnailUri: schema.videos.thumbnailUri,
        durationSeconds: schema.videos.durationSeconds,
        totalSegments: schema.videos.totalSegments,
        pricePerSegment: schema.videos.pricePerSegment,
        merkleRoot: schema.videos.merkleRoot,
        creatorAddress: schema.videos.creatorAddress,
        isActive: schema.videos.isActive,
        createdAt: schema.videos.createdAt,
      })
      .from(schema.videos)
      .where(eq(schema.videos.videoId, videoId))
      .get();

    if (!video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    return NextResponse.json(video);
  } catch (error) {
    console.error('Error fetching video:', error);
    return NextResponse.json(
      { error: 'Failed to fetch video' },
      { status: 500 }
    );
  }
}
