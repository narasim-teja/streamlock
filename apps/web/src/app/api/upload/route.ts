/**
 * POST /api/upload - Video upload endpoint
 *
 * Handles video upload, stores metadata in database, and returns
 * the transaction payload for on-chain registration.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { getStorageProvider } from '@/lib/storage';
import {
  generateMasterSecret,
  deriveAllSegmentKeys,
  buildMerkleTree,
  getMerkleRoot,
  serializeMerkleTree,
} from '@streamlock/crypto';
import { aptToOctas } from '@streamlock/common';
import { getContractAddress } from '@/lib/aptos';

export async function POST(request: NextRequest) {
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

    // Generate video ID
    const videoId = crypto.randomUUID().replace(/-/g, '');

    // For demo/MVP, simulate video processing
    // In production, use the creator-sdk to segment, encrypt, and package as HLS
    // The full pipeline would be:
    // 1. segmentVideo() - split into 5-second segments
    // 2. encryptVideoSegments() - encrypt each segment
    // 3. generateHLSPackage() - create m3u8 playlists
    const totalSegments = 20; // Simulated - would come from actual video duration
    const durationSeconds = totalSegments * 5;

    // Generate cryptographic material
    const masterSecret = generateMasterSecret();
    const keys = deriveAllSegmentKeys(masterSecret, videoId, totalSegments);
    const merkleTree = buildMerkleTree(keys);
    const merkleRoot = getMerkleRoot(merkleTree);

    // Store video and thumbnail
    const storage = getStorageProvider();
    const videoBuffer = Buffer.from(await videoFile.arrayBuffer());

    // Upload video content
    const contentUri = await storage.upload(
      `${videoId}/master.m3u8`,
      videoBuffer,
      'application/vnd.apple.mpegurl'
    );

    // Upload thumbnail if provided
    let thumbnailUri = '';
    if (thumbnailFile) {
      const thumbnailBuffer = Buffer.from(await thumbnailFile.arrayBuffer());
      const thumbnailExt = thumbnailFile.name.split('.').pop() || 'jpg';
      thumbnailUri = await storage.upload(
        `${videoId}/thumbnail.${thumbnailExt}`,
        thumbnailBuffer,
        thumbnailFile.type || 'image/jpeg'
      );
    }

    // Convert price to octas (bigint)
    const priceInOctas = aptToOctas(pricePerSegment);

    // Ensure creator exists in database (create if not)
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

    // Store in database
    await db.insert(schema.videos).values({
      videoId,
      onChainVideoId: null, // Will be set after on-chain registration
      creatorAddress,
      title,
      description,
      contentUri,
      thumbnailUri,
      durationSeconds,
      totalSegments,
      pricePerSegment: priceInOctas,
      merkleRoot,
      masterSecret,
      isActive: true,
      createdAt: new Date(),
      onChainTxHash: null,
    });

    // Store Merkle tree
    await db.insert(schema.merkleTrees).values({
      videoId,
      treeData: serializeMerkleTree(merkleTree),
    });

    // Build the transaction payload for on-chain registration
    // The client will sign this transaction
    const contractAddress = getContractAddress();
    const registerVideoPayload = {
      function: `${contractAddress}::protocol::register_video`,
      typeArguments: [],
      functionArguments: [
        contentUri, // content_uri: String
        thumbnailUri, // thumbnail_uri: String
        durationSeconds.toString(), // duration_seconds: u64
        totalSegments.toString(), // total_segments: u64
        Array.from(Buffer.from(merkleRoot, 'hex')), // key_commitment_root: vector<u8>
        priceInOctas.toString(), // price_per_segment: u64
      ],
    };

    return NextResponse.json({
      success: true,
      data: {
        videoId,
        contentUri,
        thumbnailUri,
        totalSegments,
        durationSeconds,
        merkleRoot,
        pricePerSegment: priceInOctas.toString(),
      },
      // Return payload for client to sign on-chain registration
      requiresSignature: true,
      payload: registerVideoPayload,
    });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Upload failed' },
      { status: 500 }
    );
  }
}
