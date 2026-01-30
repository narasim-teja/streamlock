/**
 * StreamLock Player React Component
 */

import { useEffect, useRef, useState } from 'react';
import type { Aptos, Account } from '@aptos-labs/ts-sdk';
import type { SessionInfo, PaymentEvent } from '@streamlock/common';
import { StreamLockPlayer } from '../StreamLockPlayer.js';

/** Player component props */
export interface StreamLockPlayerProps {
  videoId: string;
  aptosClient: Aptos;
  contractAddress: string;
  keyServerBaseUrl: string;
  signer: Account;
  prepaidSegments?: number;
  autoTopUp?: boolean;
  onPayment?: (payment: PaymentEvent) => void;
  onError?: (error: Error) => void;
  onSessionStart?: (session: SessionInfo) => void;
  className?: string;
  style?: React.CSSProperties;
}

/** StreamLock Player Component */
export function StreamLockPlayerComponent({
  videoId,
  aptosClient,
  contractAddress,
  keyServerBaseUrl,
  signer,
  prepaidSegments = 20,
  autoTopUp = true,
  onPayment,
  onError,
  onSessionStart,
  className,
  style,
}: StreamLockPlayerProps): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<StreamLockPlayer | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Initialize player
  useEffect(() => {
    const player = new StreamLockPlayer({
      aptosClient,
      contractAddress,
      keyServerBaseUrl,
    });

    playerRef.current = player;

    const init = async () => {
      try {
        setLoading(true);
        await player.initialize(videoId);

        // Start session
        const sessionInfo = await player.startSession(signer, prepaidSegments);
        setSession(sessionInfo);
        onSessionStart?.(sessionInfo);

        // Attach to video element
        if (videoRef.current) {
          player.attachToElement(videoRef.current, {
            videoId,
            prepaidSegments,
            autoTopUp,
            onPayment,
            onError: (err) => {
              setError(err.message);
              onError?.(err);
            },
          });
        }

        setLoading(false);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        setError(errorMsg);
        onError?.(err instanceof Error ? err : new Error(errorMsg));
        setLoading(false);
      }
    };

    init();

    return () => {
      player.destroy();
    };
  }, [videoId, aptosClient, contractAddress, keyServerBaseUrl, signer]);

  if (error) {
    return (
      <div className={className} style={style}>
        <div style={{ color: 'red', padding: '20px' }}>Error: {error}</div>
      </div>
    );
  }

  return (
    <div className={className} style={style}>
      {loading && <div style={{ padding: '20px' }}>Loading...</div>}
      <video
        ref={videoRef}
        controls
        style={{ width: '100%', display: loading ? 'none' : 'block' }}
      />
      {session && (
        <div style={{ padding: '10px', fontSize: '12px' }}>
          Session: {session.sessionId.slice(0, 8)}... | Balance:{' '}
          {session.prepaidBalance.toString()} octas
        </div>
      )}
    </div>
  );
}
