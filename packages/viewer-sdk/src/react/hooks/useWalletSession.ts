/**
 * useWalletSession hook - manages StreamLock sessions with wallet adapter
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { Aptos } from '@aptos-labs/ts-sdk';
import type {
  SessionInfo,
  SessionSummary,
} from '@streamlock/common';
import {
  DEFAULT_PREPAID_SEGMENTS,
  DEFAULT_TOPUP_THRESHOLD,
  SESSION_EXPIRY_SECONDS,
} from '@streamlock/common';
import {
  StreamLockContract,
  createStreamLockContract,
} from '@streamlock/aptos';
import type { SignAndSubmitTransactionFunction } from '../../payment/x402Client.js';
import {
  LocalStorageSessionStorage,
  type SessionStorage,
} from '../../session/storage.js';

/** Configuration for useWalletSession */
export interface UseWalletSessionConfig {
  /** Aptos client */
  aptosClient: Aptos;
  /** Contract address */
  contractAddress: string;
  /** Video ID */
  videoId: string;
  /** Wallet account address */
  accountAddress: string | undefined;
  /** Wallet sign and submit function */
  signAndSubmitTransaction: SignAndSubmitTransactionFunction | undefined;
  /** Whether wallet is connected */
  isConnected: boolean;
  /** Session storage (optional, defaults to localStorage) */
  storage?: SessionStorage;
  /** Low balance threshold in segments */
  lowBalanceThreshold?: number;
  /** Auto-sync interval in ms (0 to disable) */
  syncInterval?: number;
}

/** useWalletSession state */
export interface UseWalletSessionState {
  /** Current session info */
  session: SessionInfo | null;
  /** Whether session is loading */
  isLoading: boolean;
  /** Error if any */
  error: Error | null;
  /** Whether session is active */
  isActive: boolean;
  /** Whether session is expired */
  isExpired: boolean;
  /** Remaining segments that can be watched */
  remainingSegments: number;
  /** Whether balance is low */
  isLowBalance: boolean;
  /** Whether starting a session */
  isStarting: boolean;
  /** Whether topping up */
  isToppingUp: boolean;
  /** Whether ending session */
  isEnding: boolean;
}

/** useWalletSession actions */
export interface UseWalletSessionActions {
  /** Start a new session */
  startSession: (prepaidSegments?: number) => Promise<SessionInfo>;
  /** Top up session balance */
  topUp: (additionalSegments: number) => Promise<void>;
  /** End current session */
  endSession: () => Promise<SessionSummary>;
  /** Sync session with on-chain state */
  sync: () => Promise<void>;
  /** Clear local session data */
  clearLocal: () => Promise<void>;
}

/** useWalletSession return type */
export type UseWalletSessionReturn = [UseWalletSessionState, UseWalletSessionActions];

/** Hook for managing StreamLock sessions with wallet adapter */
export function useWalletSession(
  config: UseWalletSessionConfig
): UseWalletSessionReturn {
  const {
    aptosClient,
    contractAddress,
    videoId,
    accountAddress,
    signAndSubmitTransaction,
    isConnected,
    storage = new LocalStorageSessionStorage(),
    lowBalanceThreshold = DEFAULT_TOPUP_THRESHOLD,
    syncInterval = 30000,
  } = config;

  // State
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isToppingUp, setIsToppingUp] = useState(false);
  const [isEnding, setIsEnding] = useState(false);

  // Refs
  const contractRef = useRef<StreamLockContract | null>(null);
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Initialize contract
  useEffect(() => {
    contractRef.current = createStreamLockContract(aptosClient, {
      address: contractAddress,
      moduleName: 'protocol',
    });
  }, [aptosClient, contractAddress]);

  // Helper to get function ID
  const functionId = useCallback(
    (name: string): `${string}::${string}::${string}` => {
      return `${contractAddress}::protocol::${name}`;
    },
    [contractAddress]
  );

  // Load existing session from storage
  useEffect(() => {
    if (!accountAddress || !videoId) {
      setSession(null);
      setIsLoading(false);
      return;
    }

    const loadSession = async () => {
      try {
        setIsLoading(true);
        const stored = await storage.load(videoId, accountAddress);

        if (stored) {
          // Validate on-chain
          const contract = contractRef.current;
          if (contract) {
            const onChain = await contract.getSession(stored.sessionId);
            if (onChain && onChain.isActive) {
              // Update with on-chain data
              setSession({
                ...stored,
                prepaidBalance: onChain.prepaidBalance,
                segmentsPaid: onChain.segmentsPaid,
              });
            } else {
              // Session ended on-chain, clear local
              await storage.clear(stored.sessionId);
              setSession(null);
            }
          } else {
            setSession(stored);
          }
        } else {
          setSession(null);
        }
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        setIsLoading(false);
      }
    };

    loadSession();
  }, [accountAddress, videoId, storage]);

  // Set up sync interval
  useEffect(() => {
    if (!session || syncInterval <= 0) return;

    syncIntervalRef.current = setInterval(async () => {
      if (!contractRef.current || !session) return;

      try {
        const onChain = await contractRef.current.getSession(session.sessionId);
        if (onChain && onChain.isActive) {
          setSession((prev) =>
            prev
              ? {
                  ...prev,
                  prepaidBalance: onChain.prepaidBalance,
                  segmentsPaid: onChain.segmentsPaid,
                }
              : null
          );
        } else if (onChain && !onChain.isActive) {
          // Session ended
          setSession(null);
          if (accountAddress) {
            await storage.clear(session.sessionId);
          }
        }
      } catch {
        // Ignore sync errors
      }
    }, syncInterval);

    return () => {
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
      }
    };
  }, [session?.sessionId, syncInterval, accountAddress, storage]);

  // Computed values
  const isActive = session !== null;
  const isExpired = session ? Date.now() / 1000 > session.expiresAt : false;

  // Get video price (cached via contract)
  const [pricePerSegment, setPricePerSegment] = useState<bigint>(0n);

  useEffect(() => {
    if (!videoId || !contractRef.current) return;

    contractRef.current.getSegmentPrice(videoId).then(setPricePerSegment).catch(() => {});
  }, [videoId]);

  const remainingSegments =
    session && pricePerSegment > 0n
      ? Number(session.prepaidBalance / pricePerSegment) - session.segmentsPaid
      : 0;

  const isLowBalance = remainingSegments <= lowBalanceThreshold;

  // Start session
  const startSession = useCallback(
    async (prepaidSegments: number = DEFAULT_PREPAID_SEGMENTS): Promise<SessionInfo> => {
      if (!signAndSubmitTransaction || !accountAddress) {
        throw new Error('Wallet not connected');
      }

      setIsStarting(true);
      setError(null);

      try {
        const payload = {
          function: functionId('start_session'),
          functionArguments: [videoId, prepaidSegments, SESSION_EXPIRY_SECONDS],
        };

        const pendingTx = await signAndSubmitTransaction(payload);
        await aptosClient.waitForTransaction({ transactionHash: pendingTx.hash });

        // Get transaction to extract events
        const tx = await aptosClient.getTransactionByHash({
          transactionHash: pendingTx.hash,
        });

        const events = 'events' in tx ? tx.events : [];
        const sessionEvent = events.find((e: { type: string }) =>
          e.type.includes('SessionStartedEvent')
        );

        if (!sessionEvent) {
          throw new Error('Session creation failed: no event emitted');
        }

        const sessionData = sessionEvent.data as {
          session_id: string;
          video_id: string;
          prepaid_amount: string;
        };

        const newSession: SessionInfo = {
          sessionId: sessionData.session_id,
          videoId: sessionData.video_id,
          prepaidBalance: BigInt(sessionData.prepaid_amount),
          segmentsPaid: 0,
          expiresAt: Math.floor(Date.now() / 1000) + SESSION_EXPIRY_SECONDS,
        };

        // Save to storage
        await storage.save(accountAddress, newSession);
        setSession(newSession);

        return newSession;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        throw error;
      } finally {
        setIsStarting(false);
      }
    },
    [signAndSubmitTransaction, accountAddress, videoId, functionId, aptosClient, storage]
  );

  // Top up session
  const topUp = useCallback(
    async (additionalSegments: number): Promise<void> => {
      if (!signAndSubmitTransaction || !accountAddress || !session) {
        throw new Error('No active session');
      }

      setIsToppingUp(true);
      setError(null);

      try {
        const payload = {
          function: functionId('top_up_session'),
          functionArguments: [session.sessionId, additionalSegments],
        };

        const pendingTx = await signAndSubmitTransaction(payload);
        await aptosClient.waitForTransaction({ transactionHash: pendingTx.hash });

        // Update local session
        const additionalAmount = BigInt(additionalSegments) * pricePerSegment;
        const updatedSession = {
          ...session,
          prepaidBalance: session.prepaidBalance + additionalAmount,
        };

        await storage.save(accountAddress, updatedSession);
        setSession(updatedSession);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        throw error;
      } finally {
        setIsToppingUp(false);
      }
    },
    [signAndSubmitTransaction, accountAddress, session, functionId, aptosClient, pricePerSegment, storage]
  );

  // End session
  const endSession = useCallback(async (): Promise<SessionSummary> => {
    if (!signAndSubmitTransaction || !accountAddress || !session) {
      throw new Error('No active session');
    }

    setIsEnding(true);
    setError(null);

    try {
      const payload = {
        function: functionId('end_session'),
        functionArguments: [session.sessionId],
      };

      const pendingTx = await signAndSubmitTransaction(payload);
      await aptosClient.waitForTransaction({ transactionHash: pendingTx.hash });

      // Get transaction to extract events
      const tx = await aptosClient.getTransactionByHash({
        transactionHash: pendingTx.hash,
      });

      const events = 'events' in tx ? tx.events : [];
      const endEvent = events.find((e: { type: string }) =>
        e.type.includes('SessionEndedEvent')
      );

      const eventData = endEvent?.data as {
        segments_watched: string;
        total_paid: string;
        refunded: string;
      };

      const summary: SessionSummary = {
        segmentsWatched: parseInt(eventData?.segments_watched ?? '0'),
        totalPaid: BigInt(eventData?.total_paid ?? '0'),
        refunded: BigInt(eventData?.refunded ?? '0'),
        transactionHash: pendingTx.hash,
      };

      // Clear session
      await storage.clear(session.sessionId);
      setSession(null);

      return summary;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setIsEnding(false);
    }
  }, [signAndSubmitTransaction, accountAddress, session, functionId, aptosClient, storage]);

  // Sync with chain
  const sync = useCallback(async (): Promise<void> => {
    if (!session || !contractRef.current) return;

    const onChain = await contractRef.current.getSession(session.sessionId);
    if (onChain && onChain.isActive) {
      setSession((prev) =>
        prev
          ? {
              ...prev,
              prepaidBalance: onChain.prepaidBalance,
              segmentsPaid: onChain.segmentsPaid,
            }
          : null
      );
    } else {
      setSession(null);
      if (accountAddress) {
        await storage.clear(session.sessionId);
      }
    }
  }, [session, accountAddress, storage]);

  // Clear local session data
  const clearLocal = useCallback(async (): Promise<void> => {
    if (session) {
      await storage.clear(session.sessionId);
    }
    setSession(null);
    setError(null);
  }, [session, storage]);

  const state: UseWalletSessionState = {
    session,
    isLoading,
    error,
    isActive,
    isExpired,
    remainingSegments,
    isLowBalance,
    isStarting,
    isToppingUp,
    isEnding,
  };

  const actions: UseWalletSessionActions = {
    startSession,
    topUp,
    endSession,
    sync,
    clearLocal,
  };

  return [state, actions];
}
