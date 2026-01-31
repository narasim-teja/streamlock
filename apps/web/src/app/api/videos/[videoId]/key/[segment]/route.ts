/**
 * GET /api/videos/[videoId]/key/[segment] - x402 gated key endpoint
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import {
  deriveSegmentKeyPair,
  deserializeMerkleTree,
  generateMerkleProof,
} from '@streamlock/crypto';
import { X402_VERSION, APTOS_COIN } from '@streamlock/common';

export async function GET(
  request: NextRequest,
  { params }: { params: { videoId: string; segment: string } }
) {
  try {
    const { videoId, segment } = params;
    const segmentIndex = parseInt(segment);

    // Get video from database
    const videos = await db
      .select()
      .from(schema.videos)
      .where(eq(schema.videos.videoId, videoId));
    const video = videos[0];

    if (!video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    if (!video.isActive) {
      return NextResponse.json({ error: 'Video not active' }, { status: 403 });
    }

    if (segmentIndex < 0 || segmentIndex >= video.totalSegments) {
      return NextResponse.json(
        { error: 'Invalid segment index' },
        { status: 400 }
      );
    }

    // Check for payment header
    const paymentHeader = request.headers.get('X-Payment');

    if (!paymentHeader) {
      // Return 402 with payment instructions
      const contractAddress = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS;
      const network = process.env.NEXT_PUBLIC_APTOS_NETWORK || 'testnet';

      return NextResponse.json(
        {
          x402Version: X402_VERSION,
          accepts: [
            {
              scheme: 'exact',
              network: `aptos-${network}`,
              maxAmountRequired: video.pricePerSegment.toString(),
              resource: APTOS_COIN,
              payTo: video.creatorAddress,
              extra: {
                videoId,
                segmentIndex,
                sessionId: '', // Client should fill this
                contractAddress,
                function: `${contractAddress}::protocol::pay_for_segment`,
              },
            },
          ],
        },
        { status: 402 }
      );
    }

    // Verify payment (simplified for demo)
    // In production, verify the transaction on-chain
    try {
      const payment = JSON.parse(paymentHeader);
      // TODO: Verify payment on-chain
      console.log('Payment received:', payment);
    } catch {
      return NextResponse.json(
        { error: 'Invalid payment header' },
        { status: 400 }
      );
    }

    // Get master secret and Merkle tree
    const merkleTreeResults = await db
      .select()
      .from(schema.merkleTrees)
      .where(eq(schema.merkleTrees.videoId, videoId));
    const merkleTreeData = merkleTreeResults[0];

    if (!merkleTreeData || !video.masterSecret) {
      return NextResponse.json(
        { error: 'Key data not found' },
        { status: 500 }
      );
    }

    // Derive key and IV
    const masterSecret = video.masterSecret;
    const { key, iv } = deriveSegmentKeyPair(masterSecret, videoId, segmentIndex);

    // Generate Merkle proof
    const tree = deserializeMerkleTree(merkleTreeData.treeData);
    const proof = generateMerkleProof(tree, segmentIndex);

    return NextResponse.json({
      key: key.toString('base64'),
      iv: iv.toString('base64'),
      proof,
      segmentIndex,
    });
  } catch (error) {
    console.error('Error getting key:', error);
    return NextResponse.json({ error: 'Failed to get key' }, { status: 500 });
  }
}
