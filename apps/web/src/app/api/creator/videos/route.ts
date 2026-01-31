/**
 * Creator Videos API
 * GET /api/creator/videos?address=<wallet_address>
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, desc } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get('address');

  if (!address) {
    return NextResponse.json(
      { error: 'Missing address parameter' },
      { status: 400 }
    );
  }

  try {
    const videos = await db
      .select({
        videoId: schema.videos.videoId,
        onChainVideoId: schema.videos.onChainVideoId,
        title: schema.videos.title,
        description: schema.videos.description,
        thumbnailUri: schema.videos.thumbnailUri,
        contentUri: schema.videos.contentUri,
        durationSeconds: schema.videos.durationSeconds,
        totalSegments: schema.videos.totalSegments,
        pricePerSegment: schema.videos.pricePerSegment,
        isActive: schema.videos.isActive,
        createdAt: schema.videos.createdAt,
        onChainTxHash: schema.videos.onChainTxHash,
      })
      .from(schema.videos)
      .where(eq(schema.videos.creatorAddress, address))
      .orderBy(desc(schema.videos.createdAt));

    // Serialize bigint values to strings for JSON
    const serializedVideos = videos.map((video) => ({
      ...video,
      onChainVideoId: video.onChainVideoId?.toString() || null,
      pricePerSegment: video.pricePerSegment.toString(),
      createdAt: video.createdAt?.toISOString() || null,
    }));

    return NextResponse.json(serializedVideos);
  } catch (error) {
    console.error('Failed to fetch creator videos:', error);
    return NextResponse.json(
      { error: 'Failed to fetch videos' },
      { status: 500 }
    );
  }
}
