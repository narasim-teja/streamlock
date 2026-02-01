/**
 * useSessionKeySession hook - manages StreamLock sessions with ephemeral session keys
 * for popup-free payment experience
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { Aptos } from '@aptos-labs/ts-sdk';
import type { SessionInfo, SessionSummary } from '@streamlock/common';
import {
  DEFAULT_PREPAID_SEGMENTS,
  SESSION_EXPIRY_SECONDS,
} from '@streamlock/common';
import {
  StreamLockContract,
  createStreamLockContract,
} from '@streamlock/aptos';
import type { SignAndSubmitTransactionFunction } from '../../payment/x402Client.js';
import {
  SessionKeyManager,
  BrowserSessionKeyStorage,
} from '../../session/sessionKeyManager.js';
import type {
  SessionKeyConfig,
  SessionKeyStorage,
  LiveSessionKeyState,
} from '../../session/sessionKeyTypes.js';

/** Configuration for useSessionKeySession */
export interface UseSessionKeySessionConfig {
  /** Aptos client */
  aptosClient: Aptos;
  /** Contract address */
  contractAddress: string;
  /** Video ID (bigint from on-chain) */
  videoId: bigint;
  /** Wallet account address */
  accountAddress: string | undefined;
  /** Wallet sign and submit function (used once for funding) */
  signAndSubmitTransaction: SignAndSubmitTransactionFunction | undefined;
  /** Whether wallet is connected */
  isConnected: boolean;
  /** Session key storage (optional, defaults to browser sessionStorage) */
  storage?: SessionKeyStorage;
  /** Default spending limit in octas */
  defaultSpendingLimit?: bigint;
}

/** useSessionKeySession state */
export interface UseSessionKeySessionState {
  /** Current session info */
  session: SessionInfo | null;
  /** Current session key state */
  sessionKeyState: LiveSessionKeyState | null;
  /** Whether loading (restoring from storage) */
  isLoading: boolean;
  /** Whether starting session */
  isStarting: boolean;
  /** Error if any */
  error: Error | null;
  /** Whether session key is active */
  isSessionKeyActive: boolean;
  /** Remaining balance in session key */
  remainingBalance: bigint;
  /** Approximate segments that can still be afforded */
  segmentsAffordable: number;
  /** Whether ending session */
  isEnding: boolean;
  /** Whether returning funds */
  isReturningFunds: boolean;
}

/** useSessionKeySession actions */
export interface UseSessionKeySessionActions {
  /** Start session with ephemeral key (single popup for funding) */
  startWithSessionKey: (config?: Partial<SessionKeyConfig>) => Promise<SessionInfo>;
  /** End session */
  endSession: (returnFunds?: boolean) => Promise<SessionSummary>;
  /** Return remaining funds to main wallet */
  returnFunds: () => Promise<string | null>;
  /** Sync balance with chain */
  syncBalance: () => Promise<void>;
  /** Clear session key and storage */
  clear: () => void;
}

/** useSessionKeySession return type */
export type UseSessionKeySessionReturn = [
  UseSessionKeySessionState,
  UseSessionKeySessionActions
];

/** Hook for managing StreamLock sessions with ephemeral session keys */
export function useSessionKeySession(
  config: UseSessionKeySessionConfig
): UseSessionKeySessionReturn {
  const {
    aptosClient,
    contractAddress,
    videoId,
    accountAddress,
    signAndSubmitTransaction,
    isConnected: _isConnected,
    storage = new BrowserSessionKeyStorage(),
    defaultSpendingLimit = 50_000_000n, // 0.5 APT default
  } = config;

  // State
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [sessionKeyState, setSessionKeyState] = useState<LiveSessionKeyState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const [isReturningFunds, setIsReturningFunds] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [pricePerSegment, setPricePerSegment] = useState<bigint>(0n);

  // Refs
  const contractRef = useRef<StreamLockContract | null>(null);
  const sessionKeyManagerRef = useRef<SessionKeyManager | null>(null);

  // Initialize contract
  useEffect(() => {
    contractRef.current = createStreamLockContract(aptosClient, {
      address: contractAddress,
      moduleName: 'protocol',
    });
  }, [aptosClient, contractAddress]);

  // Load segment price
  useEffect(() => {
    if (!videoId || !contractRef.current) return;

    contractRef.current
      .getSegmentPrice(videoId)
      .then(setPricePerSegment)
      .catch((err) => {
        console.warn('Failed to fetch segment price:', err);
      });
  }, [videoId]);


  // Get account balance
  const getAccountBalance = useCallback(
    async (address: string): Promise<bigint> => {
      try {
        const resources = await aptosClient.getAccountResources({
          accountAddress: address,
        });

        const coinStore = resources.find(
          (r) => r.type === '0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>'
        );

        if (!coinStore) {
          return 0n;
        }

        const data = coinStore.data as { coin: { value: string } };
        return BigInt(data.coin.value);
      } catch {
        return 0n;
      }
    },
    [aptosClient]
  );

  // Try to restore session from storage on mount
  useEffect(() => {
    if (!accountAddress || !videoId) {
      setIsLoading(false);
      return;
    }

    const tryRestore = async () => {
      try {
        setIsLoading(true);

        // Create manager with storage
        const manager = new SessionKeyManager(storage);
        sessionKeyManagerRef.current = manager;

        // Try to restore from storage
        if (manager.restore()) {
          const state = manager.getState();
          if (
            state &&
            state.videoId === videoId &&
            state.sessionId &&
            state.fundingWallet === accountAddress
          ) {
            // Verify session is still active on-chain
            const contract = contractRef.current;
            if (contract) {
              const onChain = await contract.getSession(state.sessionId);
              if (onChain && onChain.isActive) {
                // Sync balance
                const balance = await getAccountBalance(state.address);
                manager.setBalance(balance);

                // Update state
                setSessionKeyState(manager.getState());
                setSession({
                  sessionId: state.sessionId,
                  videoId: state.videoId!,
                  prepaidBalance: onChain.prepaidBalance,
                  segmentsPaid: onChain.segmentsPaid,
                  expiresAt: Math.floor(Date.now() / 1000) + SESSION_EXPIRY_SECONDS,
                });
              } else {
                // Session ended, clear storage
                manager.destroy();
                sessionKeyManagerRef.current = null;
              }
            }
          } else {
            // Different video or wallet, clear
            manager.destroy();
            sessionKeyManagerRef.current = null;
          }
        }
      } catch (err) {
        console.error('Failed to restore session key:', err);
      } finally {
        setIsLoading(false);
      }
    };

    tryRestore();
  }, [accountAddress, videoId, storage, getAccountBalance]);

  // Computed values
  const isSessionKeyActive = sessionKeyManagerRef.current?.isActive() ?? false;
  const remainingBalance = sessionKeyState?.currentBalance ?? 0n;
  const segmentsAffordable =
    pricePerSegment > 0n
      ? Number(remainingBalance / (pricePerSegment + 100_000n)) // Include gas estimate
      : 0;

  // Start session with session key
  const startWithSessionKey = useCallback(
    async (customConfig?: Partial<SessionKeyConfig>): Promise<SessionInfo> => {
      if (!signAndSubmitTransaction || !accountAddress) {
        throw new Error('Wallet not connected');
      }

      setIsStarting(true);
      setError(null);

      try {
        const sessionKeyConfig: SessionKeyConfig = {
          spendingLimit: customConfig?.spendingLimit ?? defaultSpendingLimit,
          estimatedSegments: customConfig?.estimatedSegments,
          gasBufferPercent: customConfig?.gasBufferPercent ?? 20,
        };

        // Create session key manager
        const manager = new SessionKeyManager(storage);
        sessionKeyManagerRef.current = manager;

        // Generate ephemeral keypair
        const ephemeralAccount = manager.generate();
        const ephemeralAddress = ephemeralAccount.accountAddress.toString();

        // Calculate funding amount
        const fundingAmount = SessionKeyManager.calculateFundingAmount(
          sessionKeyConfig,
          pricePerSegment
        );

        // Fund ephemeral account (SINGLE POPUP)
        const fundPayload = {
          function: '0x1::aptos_account::transfer' as const,
          functionArguments: [ephemeralAddress, fundingAmount.toString()],
        };

        const fundTx = await signAndSubmitTransaction(fundPayload);
        await aptosClient.waitForTransaction({ transactionHash: fundTx.hash });

        // Initialize manager state
        manager.initialize(accountAddress, sessionKeyConfig.spendingLimit);

        // Verify funding
        const balance = await getAccountBalance(ephemeralAddress);
        manager.setBalance(balance);

        if (balance < fundingAmount) {
          throw new Error(`Funding failed: expected ${fundingAmount}, got ${balance}`);
        }

        // Calculate prepaid segments
        const prepaidSegments =
          sessionKeyConfig.estimatedSegments ??
          (Math.floor(Number(sessionKeyConfig.spendingLimit / pricePerSegment)) || DEFAULT_PREPAID_SEGMENTS);

        // Create session using ephemeral account (NO POPUP)
        const result = await contractRef.current!.startSession(ephemeralAccount, {
          videoId,
          prepaidSegments,
          maxDurationSeconds: SESSION_EXPIRY_SECONDS,
        });

        // Get transaction to extract events
        const tx = await aptosClient.getTransactionByHash({
          transactionHash: result.hash,
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
          sessionId: BigInt(sessionData.session_id),
          videoId: BigInt(sessionData.video_id),
          prepaidBalance: BigInt(sessionData.prepaid_amount),
          segmentsPaid: 0,
          expiresAt: Math.floor(Date.now() / 1000) + SESSION_EXPIRY_SECONDS,
        };

        // Update manager with session info
        manager.setSessionInfo(newSession.sessionId, newSession.videoId);

        // Update state
        setSession(newSession);
        setSessionKeyState(manager.getState());

        return newSession;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        throw error;
      } finally {
        setIsStarting(false);
      }
    },
    [
      signAndSubmitTransaction,
      accountAddress,
      aptosClient,
      videoId,
      pricePerSegment,
      defaultSpendingLimit,
      storage,
      getAccountBalance,
    ]
  );

  // End session
  const endSession = useCallback(
    async (returnFundsAfter: boolean = true): Promise<SessionSummary> => {
      const manager = sessionKeyManagerRef.current;
      const account = manager?.getAccount();

      if (!session || !manager || !account) {
        throw new Error('No active session');
      }

      setIsEnding(true);
      setError(null);

      try {
        // End session using ephemeral account (NO POPUP)
        const result = await contractRef.current!.endSession(
          account,
          session.sessionId
        );

        // Get transaction to extract events
        const tx = await aptosClient.getTransactionByHash({
          transactionHash: result.hash,
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
          transactionHash: result.hash,
        };

        // Return funds if requested
        if (returnFundsAfter) {
          try {
            await returnFunds();
          } catch (err) {
            console.warn('Failed to return funds:', err);
          }
        }

        // Clear session
        setSession(null);
        setSessionKeyState(null);
        manager.destroy();
        sessionKeyManagerRef.current = null;

        return summary;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        throw error;
      } finally {
        setIsEnding(false);
      }
    },
    [session, aptosClient]
  );

  // Return remaining funds to main wallet
  const returnFunds = useCallback(async (): Promise<string | null> => {
    const manager = sessionKeyManagerRef.current;
    const state = manager?.getState();
    const account = manager?.getAccount();

    if (!manager?.isActive() || !state || !account) {
      return null;
    }

    setIsReturningFunds(true);

    try {
      // Get current balance
      const currentBalance = await getAccountBalance(state.address);
      if (currentBalance <= 0n) {
        return null;
      }

      // Estimate gas for transfer
      const estimatedGas = 100_000n;
      const transferAmount = currentBalance - estimatedGas;

      if (transferAmount <= 0n) {
        return null;
      }

      // Transfer back to main wallet
      const txn = await aptosClient.transaction.build.simple({
        sender: account.accountAddress,
        data: {
          function: '0x1::aptos_account::transfer',
          functionArguments: [state.fundingWallet, transferAmount.toString()],
        },
      });

      const pendingTxn = await aptosClient.signAndSubmitTransaction({
        signer: account,
        transaction: txn,
      });

      await aptosClient.waitForTransaction({
        transactionHash: pendingTxn.hash,
      });

      return pendingTxn.hash;
    } catch (err) {
      console.error('Failed to return funds:', err);
      return null;
    } finally {
      setIsReturningFunds(false);
    }
  }, [aptosClient, getAccountBalance]);

  // Sync balance with chain
  const syncBalance = useCallback(async (): Promise<void> => {
    const manager = sessionKeyManagerRef.current;
    const state = manager?.getState();

    if (!manager?.isActive() || !state) {
      return;
    }

    const balance = await getAccountBalance(state.address);
    manager.setBalance(balance);
    setSessionKeyState(manager.getState());
  }, [getAccountBalance]);

  // Clear session key and storage
  const clear = useCallback((): void => {
    const manager = sessionKeyManagerRef.current;
    if (manager) {
      manager.destroy();
      sessionKeyManagerRef.current = null;
    }
    setSession(null);
    setSessionKeyState(null);
    setError(null);
  }, []);

  const state: UseSessionKeySessionState = {
    session,
    sessionKeyState,
    isLoading,
    isStarting,
    error,
    isSessionKeyActive,
    remainingBalance,
    segmentsAffordable,
    isEnding,
    isReturningFunds,
  };

  const actions: UseSessionKeySessionActions = {
    startWithSessionKey,
    endSession,
    returnFunds,
    syncBalance,
    clear,
  };

  return [state, actions];
}
