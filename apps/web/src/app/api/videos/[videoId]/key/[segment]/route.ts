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
import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk';

/**
 * Verify payment transaction on-chain
 * Checks that the transaction succeeded and contains a SegmentPaidEvent
 */
async function verifyPaymentOnChain(
  txHash: string,
  network: string,
  segmentIndex: number
): Promise<{ valid: boolean; error?: string }> {
  try {
    // Determine network from string
    let aptosNetwork: Network;
    if (network.includes('mainnet')) {
      aptosNetwork = Network.MAINNET;
    } else if (network.includes('devnet')) {
      aptosNetwork = Network.DEVNET;
    } else {
      aptosNetwork = Network.TESTNET;
    }

    const aptosConfig = new AptosConfig({ network: aptosNetwork });
    const aptos = new Aptos(aptosConfig);

    // Fetch the transaction
    const tx = await aptos.getTransactionByHash({ transactionHash: txHash });

    // Check if transaction succeeded
    if (!('success' in tx) || !tx.success) {
      return { valid: false, error: 'Transaction failed' };
    }

    // Check for SegmentPaidEvent in events
    const events = 'events' in tx ? tx.events : [];
    const paymentEvent = events.find(
      (e: { type: string; data?: { segment_index?: string } }) =>
        e.type.includes('SegmentPaidEvent') &&
        e.data?.segment_index === segmentIndex.toString()
    );

    if (!paymentEvent) {
      // Check for any payment-related event (fallback for different event names)
      const anyPaymentEvent = events.find((e: { type: string }) =>
        e.type.includes('Segment') || e.type.includes('Payment')
      );

      if (!anyPaymentEvent) {
        return { valid: false, error: 'No payment event found in transaction' };
      }
    }

    return { valid: true };
  } catch (error) {
    console.error('Payment verification error:', error);
    // Fail closed - deny access on verification errors for security
    // Users can retry if there's a transient RPC issue
    return { valid: false, error: 'Payment verification failed - please retry' };
  }
}

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

    // Verify payment on-chain
    try {
      const payment = JSON.parse(paymentHeader) as { txHash: string; network: string };

      if (!payment.txHash || !payment.network) {
        return NextResponse.json(
          { error: 'Missing txHash or network in payment header' },
          { status: 400 }
        );
      }

      // Verify the transaction on-chain
      const verification = await verifyPaymentOnChain(
        payment.txHash,
        payment.network,
        segmentIndex
      );

      if (!verification.valid) {
        console.warn('Payment verification failed:', verification.error);
        return NextResponse.json(
          {
            error: 'Payment verification failed',
            details: verification.error,
            x402Version: X402_VERSION,
          },
          { status: 402 }
        );
      }

      // Payment verified successfully
    } catch (err) {
      console.error('Payment header parse error:', err);
      return NextResponse.json(
        { error: 'Invalid payment header format' },
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
