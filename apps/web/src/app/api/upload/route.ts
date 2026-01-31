/**
 * POST /api/upload - Video upload endpoint
 *
 * Handles video upload with full processing pipeline:
 * 1. FFmpeg segmentation
 * 2. AES-128-CBC encryption per segment
 * 3. HLS playlist generation with EXT-X-KEY entries
 * 4. Upload to Supabase storage
 * 5. Store metadata in database
 * 6. Return transaction payload for on-chain registration
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { getStorageProvider } from '@/lib/storage';
import { serializeMerkleTree } from '@streamlock/crypto';
import { aptToOctas } from '@streamlock/common';
import { getContractAddress } from '@/lib/aptos';
import { processVideo } from '@/lib/video-processor';
import { uploadHLSPackage, uploadThumbnail } from '@/lib/hls-upload';
import {
  VideoProcessingError,
  VideoTooLongError,
  VideoTooLargeError,
  UnsupportedFormatError,
} from '@/lib/video-constraints';

export async function POST(request: NextRequest) {
  const videoId = crypto.randomUUID().replace(/-/g, '');

  try {
    const formData = await request.formData();

    const videoFile = formData.get('video') as File;
    const title = formData.get('title') as string;
    const description = (formData.get('description') as string) || '';
    const pricePerSegment = parseFloat(
      (formData.get('pricePerSegment') as string) || '0.001'
    );
    const creatorAddress = formData.get('creatorAddress') as string;
    const thumbnailFile = formData.get('thumbnail') as File | null;

    if (!videoFile || !title || !creatorAddress) {
      return NextResponse.json(
        { error: 'Missing required fields (video, title, creatorAddress)' },
        { status: 400 }
      );
    }

    console.log(`[Upload] Starting video processing for: ${title} (${videoId})`);

    // Get the key server base URL (uses same origin as the API)
    const keyServerBaseUrl = process.env.NEXT_PUBLIC_KEY_SERVER_URL || '/api';

    // 1. Process video (segment, encrypt, package)
    const result = await processVideo(videoFile, videoId, {
      segmentDuration: 5,
      quality: '720p',
      keyServerBaseUrl,
    });

    console.log(
      `[Upload] Video processed: ${result.totalSegments} segments, ${result.durationSeconds}s duration`
    );

    // 2. Upload HLS package to storage
    const storage = getStorageProvider();
    const contentUri = await uploadHLSPackage(storage, videoId, result.hlsPackage);
    console.log(`[Upload] HLS package uploaded: ${contentUri}`);

    // 3. Upload thumbnail if provided
    let thumbnailUri = '';
    if (thumbnailFile) {
      thumbnailUri = await uploadThumbnail(storage, videoId, thumbnailFile);
      console.log(`[Upload] Thumbnail uploaded: ${thumbnailUri}`);
    }

    // 4. Convert price to octas (bigint)
    const priceInOctas = aptToOctas(pricePerSegment);

    // 5. Ensure creator exists in database (create if not)
    const existingCreator = await db.query.creators.findFirst({
      where: (creators, { eq }) => eq(creators.address, creatorAddress),
    });

    if (!existingCreator) {
      await db.insert(schema.creators).values({
        address: creatorAddress,
        metadataUri: null,
        registeredAt: new Date(),
      });
    }

    // 6. Store in database
    await db.insert(schema.videos).values({
      videoId,
      onChainVideoId: null, // Will be set after on-chain registration
      creatorAddress,
      title,
      description,
      contentUri,
      thumbnailUri,
      durationSeconds: result.durationSeconds,
      totalSegments: result.totalSegments,
      pricePerSegment: priceInOctas,
      merkleRoot: result.merkleRoot,
      masterSecret: result.masterSecret,
      isActive: true,
      createdAt: new Date(),
      onChainTxHash: null,
    });

    // 7. Store Merkle tree
    await db.insert(schema.merkleTrees).values({
      videoId,
      treeData: serializeMerkleTree(result.merkleTree),
    });

    console.log(`[Upload] Database records created for video: ${videoId}`);

    // 8. Build the transaction payload for on-chain registration
    const contractAddress = getContractAddress();
    const registerVideoPayload = {
      function: `${contractAddress}::protocol::register_video`,
      typeArguments: [],
      functionArguments: [
        contentUri, // content_uri: String
        thumbnailUri, // thumbnail_uri: String
        result.durationSeconds.toString(), // duration_seconds: u64
        result.totalSegments.toString(), // total_segments: u64
        Array.from(Buffer.from(result.merkleRoot, 'hex')), // key_commitment_root: vector<u8>
        priceInOctas.toString(), // price_per_segment: u64
      ],
    };

    console.log(`[Upload] Upload complete for video: ${videoId}`);

    return NextResponse.json({
      success: true,
      data: {
        videoId,
        contentUri,
        thumbnailUri,
        totalSegments: result.totalSegments,
        durationSeconds: result.durationSeconds,
        merkleRoot: result.merkleRoot,
        pricePerSegment: priceInOctas.toString(),
      },
      // Return payload for client to sign on-chain registration
      requiresSignature: true,
      payload: registerVideoPayload,
    });
  } catch (error) {
    console.error('[Upload] Error:', error);

    // Handle specific error types with appropriate status codes
    if (error instanceof VideoTooLongError) {
      return NextResponse.json(
        {
          error: error.message,
          code: 'VIDEO_TOO_LONG',
          maxDuration: error.maxDuration,
          actualDuration: error.actualDuration,
        },
        { status: 400 }
      );
    }

    if (error instanceof VideoTooLargeError) {
      return NextResponse.json(
        {
          error: error.message,
          code: 'VIDEO_TOO_LARGE',
          maxSizeMB: error.maxSizeMB,
          actualSizeMB: error.actualSizeMB,
        },
        { status: 400 }
      );
    }

    if (error instanceof UnsupportedFormatError) {
      return NextResponse.json(
        {
          error: error.message,
          code: 'UNSUPPORTED_FORMAT',
          allowedFormats: error.allowedFormats,
        },
        { status: 400 }
      );
    }

    if (error instanceof VideoProcessingError) {
      return NextResponse.json(
        {
          error: error.message,
          code: 'PROCESSING_ERROR',
          stage: error.stage,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Upload failed' },
      { status: 500 }
    );
  }
}
