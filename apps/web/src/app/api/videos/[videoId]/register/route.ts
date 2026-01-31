/**
 * POST /api/videos/[videoId]/register - Update video with on-chain registration data
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';

export async function POST(
  request: NextRequest,
  { params }: { params: { videoId: string } }
) {
  try {
    const { videoId } = params;
    const body = await request.json();
    const { onChainVideoId, txHash } = body;

    if (!onChainVideoId) {
      return NextResponse.json(
        { error: 'onChainVideoId is required' },
        { status: 400 }
      );
    }

    // Update the video with on-chain data
    const result = await db
      .update(schema.videos)
      .set({
        onChainVideoId: BigInt(onChainVideoId),
        onChainTxHash: txHash || null,
      })
      .where(eq(schema.videos.videoId, videoId))
      .returning({ videoId: schema.videos.videoId });

    if (result.length === 0) {
      return NextResponse.json(
        { error: 'Video not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      videoId,
      onChainVideoId,
    });
  } catch (error) {
    console.error('Error updating video registration:', error);
    return NextResponse.json(
      { error: 'Failed to update video registration' },
      { status: 500 }
    );
  }
}
