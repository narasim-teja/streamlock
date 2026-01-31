/**
 * Creator Withdraw API
 * POST /api/creator/withdraw
 *
 * Returns the transaction payload for the client to sign.
 * The actual transaction is signed client-side using the wallet adapter.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getContractAddress } from '@/lib/aptos';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { address } = body;

    if (!address) {
      return NextResponse.json(
        { error: 'Missing address in request body' },
        { status: 400 }
      );
    }

    const contractAddress = getContractAddress();

    // Return the transaction payload for the client to sign
    return NextResponse.json({
      success: true,
      payload: {
        function: `${contractAddress}::protocol::withdraw_earnings`,
        typeArguments: [],
        functionArguments: [],
      },
    });
  } catch (error) {
    console.error('Failed to create withdraw payload:', error);
    return NextResponse.json(
      { error: 'Failed to create withdraw payload' },
      { status: 500 }
    );
  }
}
