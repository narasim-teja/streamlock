/**
 * POST /api/upload - Video upload endpoint
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

    if (!videoFile || !title) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Generate video ID
    const videoId = crypto.randomUUID().replace(/-/g, '');

    // For demo, simulate video processing
    // In production, use the creator-sdk to segment and encrypt
    const totalSegments = 20; // Simulated
    const durationSeconds = totalSegments * 5;

    // Generate cryptographic material
    const masterSecret = generateMasterSecret();
    const keys = deriveAllSegmentKeys(masterSecret, videoId, totalSegments);
    const merkleTree = buildMerkleTree(keys);
    const merkleRoot = getMerkleRoot(merkleTree);

    // Store video (simulated)
    const storage = getStorageProvider();
    const videoBuffer = Buffer.from(await videoFile.arrayBuffer());
    const contentUri = await storage.upload(
      `${videoId}/master.m3u8`,
      videoBuffer,
      'application/vnd.apple.mpegurl'
    );

    // Store in database
    const now = Math.floor(Date.now() / 1000);

    await db.insert(schema.videos).values({
      videoId,
      creatorAddress: creatorAddress || 'unknown',
      title,
      description,
      contentUri,
      thumbnailUri: '',
      durationSeconds,
      totalSegments,
      pricePerSegment: Number(aptToOctas(pricePerSegment)),
      merkleRoot,
      masterSecret,
      isActive: true,
      createdAt: now,
      onChainTxHash: null,
    });

    // Store Merkle tree
    await db.insert(schema.merkleTrees).values({
      videoId,
      treeData: serializeMerkleTree(merkleTree),
    });

    return NextResponse.json({
      success: true,
      data: {
        videoId,
        contentUri,
        totalSegments,
        merkleRoot,
        pricePerSegment: Number(aptToOctas(pricePerSegment)),
      },
    });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
