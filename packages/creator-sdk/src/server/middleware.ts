/**
 * x402 middleware for Hono
 */

import type { Context, Next } from 'hono';
import type { Aptos } from '@aptos-labs/ts-sdk';
import type { X402PaymentRequest, X402PaymentHeader } from '@streamlock/common';
import { X402_VERSION, APTOS_COIN } from '@streamlock/common';

/** x402 middleware configuration */
export interface X402MiddlewareConfig {
  getVideoPrice: (videoId: string) => Promise<bigint>;
  getCreatorAddress: (videoId: string) => Promise<string>;
  getSessionId: (videoId: string, viewer: string) => Promise<string | null>;
  aptosClient: Aptos;
  contractAddress: string;
  network: string;
}

/** Create x402 middleware */
export function createX402Middleware(config: X402MiddlewareConfig) {
  return async (c: Context, next: Next) => {
    // Extract video ID and segment index from path
    const videoId = c.req.param('videoId');
    const segmentIndex = parseInt(c.req.param('segment') ?? '0');

    if (!videoId) {
      return c.json({ error: 'Missing videoId' }, 400);
    }

    // Check for payment header
    const paymentHeader = c.req.header('X-Payment');

    if (!paymentHeader) {
      // Return 402 with payment instructions
      try {
        const price = await config.getVideoPrice(videoId);
        const creatorAddress = await config.getCreatorAddress(videoId);

        const paymentRequest: X402PaymentRequest = {
          x402Version: X402_VERSION,
          accepts: [
            {
              scheme: 'exact',
              network: config.network,
              maxAmountRequired: price.toString(),
              resource: APTOS_COIN,
              payTo: creatorAddress,
              extra: {
                videoId,
                segmentIndex,
                sessionId: '', // Will be filled by client
                contractAddress: config.contractAddress,
                function: `${config.contractAddress}::protocol::pay_for_segment`,
              },
            },
          ],
        };

        return c.json(paymentRequest, 402);
      } catch (error) {
        return c.json(
          { error: 'Failed to get payment details' },
          500
        );
      }
    }

    // Verify payment
    try {
      const payment: X402PaymentHeader = JSON.parse(paymentHeader);
      const isValid = await verifyPayment(
        payment,
        videoId,
        segmentIndex,
        config
      );

      if (!isValid) {
        return c.json({ error: 'Payment verification failed' }, 403);
      }

      // Store payment info in context for handler
      c.set('payment', payment);
      c.set('videoId', videoId);
      c.set('segmentIndex', segmentIndex);

      return next();
    } catch (error) {
      return c.json(
        { error: 'Invalid payment header' },
        400
      );
    }
  };
}

/** Verify payment on-chain */
async function verifyPayment(
  payment: X402PaymentHeader,
  _expectedVideoId: string,
  expectedSegmentIndex: number,
  config: X402MiddlewareConfig
): Promise<boolean> {
  try {
    // Fetch transaction
    const tx = await config.aptosClient.getTransactionByHash({
      transactionHash: payment.txHash,
    });

    // Check success
    if (!('success' in tx) || !tx.success) {
      return false;
    }

    // Check it's a user transaction
    if (tx.type !== 'user_transaction') {
      return false;
    }

    // Check function called
    const payload = tx.payload as {
      function: string;
      arguments: string[];
    };

    const expectedFunction = `${config.contractAddress}::protocol::pay_for_segment`;
    if (payload.function !== expectedFunction) {
      return false;
    }

    // Check arguments (session_id, segment_index)
    const [, segmentIndexArg] = payload.arguments;
    if (parseInt(segmentIndexArg) !== expectedSegmentIndex) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/** Simpler middleware for development (skip payment verification) */
export function createDevMiddleware() {
  return async (c: Context, next: Next) => {
    const videoId = c.req.param('videoId');
    const segmentIndex = parseInt(c.req.param('segment') ?? '0');

    c.set('videoId', videoId);
    c.set('segmentIndex', segmentIndex);

    return next();
  };
}
