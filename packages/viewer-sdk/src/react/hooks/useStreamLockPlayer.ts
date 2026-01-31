/**
 * useStreamLockPlayer hook - complete player integration with wallet
 */

import {
  useState,
  useCallback,
  useEffect,
  useRef,
  type RefObject,
} from 'react';
import type { Aptos } from '@aptos-labs/ts-sdk';
import type { SessionInfo, PaymentEvent } from '@streamlock/common';
import {
  StreamLockPlayer,
  type VideoInfo,
  type SignAndSubmitTransactionFunction,
} from '../../StreamLockPlayer.js';

/** Configuration for useStreamLockPlayer */
export interface UseStreamLockPlayerConfig {
  /** Aptos client */
  aptosClient: Aptos;
  /** Contract address */
  contractAddress: string;
  /** Key server base URL */
  keyServerBaseUrl: string;
  /** Wallet account address */
  accountAddress: string | undefined;
  /** Wallet sign and submit function */
  signAndSubmitTransaction: SignAndSubmitTransactionFunction | undefined;
  /** Whether wallet is connected */
  isConnected: boolean;
}

/** Player state */
export interface UseStreamLockPlayerState {
  /** Player instance */
  player: StreamLockPlayer | null;
  /** Video info */
  videoInfo: VideoInfo | null;
  /** Session info */
  session: SessionInfo | null;
  /** Whether player is initialized */
  isInitialized: boolean;
  /** Whether currently loading */
  isLoading: boolean;
  /** Whether video is playing */
  isPlaying: boolean;
  /** Current playback time */
  currentTime: number;
  /** Video duration */
  duration: number;
  /** Error if any */
  error: Error | null;
  /** Recent payments */
  payments: PaymentEvent[];
}

/** Player actions */
export interface UseStreamLockPlayerActions {
  /** Initialize player with video */
  initialize: (videoId: string) => Promise<VideoInfo>;
  /** Start session and attach to video element */
  startAndPlay: (
    videoRef: RefObject<HTMLVideoElement>,
    prepaidSegments?: number
  ) => Promise<void>;
  /** Play video */
  play: () => void;
  /** Pause video */
  pause: () => void;
  /** Seek to time */
  seek: (time: number) => void;
  /** Top up session */
  topUp: (additionalSegments: number) => Promise<void>;
  /** End session */
  endSession: () => Promise<void>;
  /** Destroy player */
  destroy: () => void;
}

/** useStreamLockPlayer return type */
export type UseStreamLockPlayerReturn = [
  UseStreamLockPlayerState,
  UseStreamLockPlayerActions,
  RefObject<HTMLVideoElement>
];

/** Hook for complete StreamLock player integration */
export function useStreamLockPlayer(
  config: UseStreamLockPlayerConfig
): UseStreamLockPlayerReturn {
  const {
    aptosClient,
    contractAddress,
    keyServerBaseUrl,
    accountAddress,
    signAndSubmitTransaction,
    isConnected,
  } = config;

  // State
  const [player, setPlayer] = useState<StreamLockPlayer | null>(null);
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<Error | null>(null);
  const [payments, setPayments] = useState<PaymentEvent[]>([]);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<StreamLockPlayer | null>(null);
  const timeUpdateRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Create player on mount
  useEffect(() => {
    const newPlayer = new StreamLockPlayer({
      aptosClient,
      contractAddress,
      keyServerBaseUrl,
    });

    playerRef.current = newPlayer;
    setPlayer(newPlayer);

    return () => {
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
      if (timeUpdateRef.current) {
        clearInterval(timeUpdateRef.current);
      }
    };
  }, [aptosClient, contractAddress, keyServerBaseUrl]);

  // Track playback time
  useEffect(() => {
    if (!videoRef.current) return;

    const video = videoRef.current;

    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime);
    };

    const handleDurationChange = () => {
      setDuration(video.duration);
    };

    const handlePlay = () => {
      setIsPlaying(true);
    };

    const handlePause = () => {
      setIsPlaying(false);
    };

    const handleEnded = () => {
      setIsPlaying(false);
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('durationchange', handleDurationChange);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('ended', handleEnded);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('durationchange', handleDurationChange);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('ended', handleEnded);
    };
  }, [videoInfo]); // Re-attach when video info changes

  // Initialize player with video
  const initialize = useCallback(
    async (videoId: string): Promise<VideoInfo> => {
      if (!playerRef.current) {
        throw new Error('Player not created');
      }

      setIsLoading(true);
      setError(null);

      try {
        const info = await playerRef.current.initialize(videoId);
        setVideoInfo(info);
        setIsInitialized(true);
        return info;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  // Start session and attach to video
  const startAndPlay = useCallback(
    async (
      ref: RefObject<HTMLVideoElement>,
      prepaidSegments?: number
    ): Promise<void> => {
      if (!playerRef.current || !isInitialized) {
        throw new Error('Player not initialized');
      }

      if (!signAndSubmitTransaction || !accountAddress) {
        throw new Error('Wallet not connected');
      }

      if (!ref.current) {
        throw new Error('Video element not available');
      }

      setIsLoading(true);
      setError(null);

      try {
        // Start session with wallet
        const sessionInfo = await playerRef.current.startSessionWithWallet(
          signAndSubmitTransaction,
          accountAddress,
          prepaidSegments
        );

        setSession(sessionInfo);

        // Attach to video element
        playerRef.current.attachToElement(ref.current, {
          videoId: videoInfo!.videoId,
          onPayment: (payment: PaymentEvent) => {
            setPayments((prev) => [...prev, payment]);
          },
          onError: (err: Error) => {
            setError(err);
          },
        });
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [isInitialized, signAndSubmitTransaction, accountAddress, videoInfo]
  );

  // Play
  const play = useCallback(() => {
    if (playerRef.current) {
      playerRef.current.play();
    }
  }, []);

  // Pause
  const pause = useCallback(() => {
    if (playerRef.current) {
      playerRef.current.pause();
    }
  }, []);

  // Seek
  const seek = useCallback((time: number) => {
    if (playerRef.current) {
      playerRef.current.seek(time);
    }
  }, []);

  // Top up
  const topUp = useCallback(
    async (additionalSegments: number): Promise<void> => {
      if (!playerRef.current) {
        throw new Error('No active session');
      }

      setIsLoading(true);
      setError(null);

      try {
        await playerRef.current.topUp(additionalSegments);

        // Update session
        const updatedSession = playerRef.current.getSession();
        if (updatedSession) {
          setSession(updatedSession);
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  // End session
  const endSession = useCallback(async (): Promise<void> => {
    if (!playerRef.current) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await playerRef.current.endSession();
      setSession(null);
      setPayments([]);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Destroy
  const destroy = useCallback(() => {
    if (playerRef.current) {
      playerRef.current.destroy();
    }
    setPlayer(null);
    setVideoInfo(null);
    setSession(null);
    setIsInitialized(false);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setPayments([]);
    setError(null);
  }, []);

  const state: UseStreamLockPlayerState = {
    player,
    videoInfo,
    session,
    isInitialized,
    isLoading,
    isPlaying,
    currentTime,
    duration,
    error,
    payments,
  };

  const actions: UseStreamLockPlayerActions = {
    initialize,
    startAndPlay,
    play,
    pause,
    seek,
    topUp,
    endSession,
    destroy,
  };

  return [state, actions, videoRef];
}
