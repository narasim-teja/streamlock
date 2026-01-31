/**
 * Creator Earnings API
 * GET /api/creator/earnings?address=<wallet_address>
 */

import { NextRequest, NextResponse } from 'next/server';
import { StreamLockContract } from '@streamlock/aptos';
import { aptosClient, getContractAddress } from '@/lib/aptos';

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get('address');

  if (!address) {
    return NextResponse.json(
      { error: 'Missing address parameter' },
      { status: 400 }
    );
  }

  try {
    const contract = new StreamLockContract(aptosClient, getContractAddress());
    const creator = await contract.getCreator(address);

    if (!creator) {
      // Creator not registered on-chain
      return NextResponse.json({
        isRegistered: false,
        totalEarnings: '0',
        pendingWithdrawal: '0',
        totalVideos: 0,
      });
    }

    return NextResponse.json({
      isRegistered: true,
      totalEarnings: creator.totalEarnings.toString(),
      pendingWithdrawal: creator.pendingWithdrawal.toString(),
      totalVideos: creator.totalVideos,
    });
  } catch (error) {
    console.error('Failed to fetch creator earnings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch earnings' },
      { status: 500 }
    );
  }
}
