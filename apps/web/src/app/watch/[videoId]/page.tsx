'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import Link from 'next/link';
import Hls from 'hls.js';
import { Aptos, AptosConfig, Network, Account } from '@aptos-labs/ts-sdk';
import type { SignAndSubmitTransactionFunction } from '@streamlock/viewer-sdk';
import { ConnectButton } from '@/components/wallet/ConnectButton';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Progress } from '@/components/ui/Progress';
import { Skeleton } from '@/components/ui/Skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/Separator';
import { formatApt, truncateAddress } from '@streamlock/common';
import {
  X402KeyLoader,
  createX402LoaderClass,
  SessionKeyManager,
  BrowserSessionKeyStorage,
} from '@streamlock/viewer-sdk';
import type { LiveSessionKeyState } from '@streamlock/viewer-sdk';
import { config } from '@/lib/config';
import {
  Play,
  Wallet,
  Plus,
  X,
  Clock,
  DollarSign,
  Loader2,
  AlertCircle,
  User,
  Lock,
  Unlock,
  Key,
  Zap,
  ArrowLeftRight,
} from 'lucide-react';

interface VideoInfo {
  videoId: string;
  onChainVideoId: string | null;
  title: string;
  description: string | null;
  creatorAddress: string | null;
  pricePerSegment: string;
  totalSegments: number;
  durationSeconds: number;
  contentUri: string;
  thumbnailUri: string | null;
}

interface PaymentRecord {
  segmentIndex: number;
  amount: bigint;
  txHash: string;
  timestamp: number;
}

interface SessionState {
  sessionId: bigint;
  videoId: bigint;
  prepaidBalance: bigint;
  segmentsPaid: number;
  isActive: boolean;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Create Aptos client based on network config
function createAptosClient(): Aptos {
  const network = config.aptosNetwork === 'mainnet' ? Network.MAINNET :
                  config.aptosNetwork === 'devnet' ? Network.DEVNET :
                  Network.TESTNET;
  return new Aptos(new AptosConfig({ network }));
}

export default function WatchPage() {
  const params = useParams();
  const videoId = params.videoId as string;
  const { connected, account, signAndSubmitTransaction } = useWallet();

  // Video state
  const [video, setVideo] = useState<VideoInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Session state
  const [session, setSession] = useState<SessionState | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);

  // Player state
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const hlsVideoIdRef = useRef<string | null>(null); // Track which video the HLS instance is for
  const keyLoaderRef = useRef<X402KeyLoader | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentKeySegment, setCurrentKeySegment] = useState<number | null>(null);
  const [isLoadingKey, setIsLoadingKey] = useState(false);

  // Session key state (for popup-free playback)
  const sessionKeyManagerRef = useRef<SessionKeyManager | null>(null);
  const [sessionKeyState, setSessionKeyState] = useState<LiveSessionKeyState | null>(null);
  const [useSessionKey, setUseSessionKey] = useState(true); // Default to session key mode
  const [isReturningFunds, setIsReturningFunds] = useState(false);

  // Ref to track latest signer function (wallet adapters recreate this frequently)
  // This prevents HLS player from being destroyed when signAndSubmitTransaction changes
  const signerRef = useRef<typeof signAndSubmitTransaction | null>(null);
  // Refs to track latest session and video objects (for use inside effects without triggering re-runs)
  const sessionRef = useRef<SessionState | null>(null);
  const videoMetaRef = useRef<VideoInfo | null>(null);
  // Stable address string for dependency tracking
  const accountAddressStr = account?.address?.toString();

  // Keep refs updated - these run on every change but do NOT trigger HLS re-initialization
  useEffect(() => {
    signerRef.current = signAndSubmitTransaction;
  }, [signAndSubmitTransaction]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    videoMetaRef.current = video;
  }, [video]);

  // Fetch video metadata
  useEffect(() => {
    async function fetchVideo() {
      try {
        setLoading(true);
        const res = await fetch(`/api/videos/${videoId}`);
        if (!res.ok) throw new Error('Video not found');
        const data = await res.json();
        setVideo(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load video');
      } finally {
        setLoading(false);
      }
    }

    fetchVideo();
  }, [videoId]);

  // Initialize HLS.js player when session starts
  useEffect(() => {
    // Use refs to get latest values without triggering effect re-runs on object changes
    const currentSigner = signerRef.current;
    const currentSession = sessionRef.current;
    const currentVideo = videoMetaRef.current;
    const sessionKeyManager = sessionKeyManagerRef.current;

    // Check if we have a valid signer (either wallet or session key)
    const hasSessionKey = sessionKeyManager?.isActive() && sessionKeyManager.getAccount();
    if (!currentSession || !currentVideo || !videoRef.current || !accountAddressStr) return;
    if (!hasSessionKey && !currentSigner) return;

    const videoEl = videoRef.current;


    // Skip if HLS instance already exists for this exact video (React 18 StrictMode double-run)
    if (hlsRef.current && hlsVideoIdRef.current === currentVideo.videoId) {
      return;
    }

    // Destroy previous instance if it's for a different video
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
      hlsVideoIdRef.current = null;
    }

    if (Hls.isSupported()) {
      // Create Aptos client
      const aptosClient = createAptosClient();

      // Determine signer: use session key account if available, otherwise wallet adapter
      let signer: Account | SignAndSubmitTransactionFunction;
      let signerAddress: string;

      if (hasSessionKey) {
        // Use session key account (NO POPUPS for payments)
        signer = sessionKeyManager!.getAccount()!;
        signerAddress = sessionKeyManager!.getAddress()!;
      } else {
        // Use wallet adapter (popup per payment)
        signer = async (payload: Parameters<NonNullable<typeof signAndSubmitTransaction>>[0]['data']) => {
          const walletSigner = signerRef.current;
          if (!walletSigner) {
            throw new Error('Wallet not connected');
          }
          const result = await walletSigner({ data: payload });
          return result;
        };
        signerAddress = accountAddressStr!;
      }

      // Create key loader for x402 payment flow
      const keyLoader = new X402KeyLoader({
        keyServerBaseUrl: '/api',
        sessionId: currentSession.sessionId,
        videoId: currentSession.videoId,
        localVideoId: currentVideo.videoId,
        aptosClient,
        contractAddress: config.contractAddress,
        accountAddress: signerAddress,
        signer,
        onPayment: (segmentIndex, txHash, amount) => {
          // Update session key state balance if using session key
          if (sessionKeyManagerRef.current?.isActive()) {
            sessionKeyManagerRef.current.recordPayment(amount, 100_000n);
            setSessionKeyState(sessionKeyManagerRef.current.getState());
          }
          setPayments(prev => {
            if (prev.some(p => p.segmentIndex === segmentIndex)) {
              return prev;
            }
            return [...prev, {
              segmentIndex,
              amount,
              txHash,
              timestamp: Date.now(),
            }];
          });
        },
        onKeyReceived: () => {
          setIsLoadingKey(false);
          setCurrentKeySegment(null);
        },
        onError: () => {
          setIsLoadingKey(false);
        },
      });

      keyLoaderRef.current = keyLoader;

      // Create custom HLS.js loader that intercepts key requests
      const X402Loader = createX402LoaderClass({
        keyLoader,
        onKeyLoading: (segmentIndex) => {
          setCurrentKeySegment(segmentIndex);
          setIsLoadingKey(true);
        },
        onKeyLoaded: () => {
          setIsLoadingKey(false);
          setCurrentKeySegment(null);
        },
        onError: (segmentIndex, error) => {
          setIsLoadingKey(false);
          setError(`Failed to load key for segment ${segmentIndex}: ${error.message}`);
        },
      });

      // Create HLS instance - config synced with StreamLockPlayer SDK
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        loader: X402Loader,
      });

      hls.loadSource(currentVideo.contentUri);
      hls.attachMedia(videoEl);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        // Manifest parsed, ready to play
      });

      // Track if we've already tried to autoplay
      let hasTriedAutoplay = false;

      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        // Try autoplay once after first fragment is buffered
        if (!hasTriedAutoplay) {
          hasTriedAutoplay = true;
          videoEl.play().catch(() => {
            // Autoplay may be blocked by browser policy - user can click play
          });
        }
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          setError('Playback error. Please try again.');
        }
      });

      hlsRef.current = hls;
      hlsVideoIdRef.current = currentVideo.videoId;
    } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS support (Safari) - won't work with x402 payment flow
      // Safari would need a service worker approach for custom key loading
      setError('Safari is not fully supported yet. Please use Chrome or Firefox.');
    }

    return () => {
      // Don't destroy HLS here - handled by effect start and handleEndSession
      // This prevents React 18 StrictMode from breaking MediaSource
    };
    // Note: signAndSubmitTransaction intentionally excluded - accessed via signerRef
    // to prevent HLS destruction when wallet adapter recreates the function
    // Using primitive values for stable comparison:
    // - session?.sessionId (bigint) instead of session (object)
    // - video?.videoId (string) instead of video (object)
    // - accountAddressStr (string) instead of account?.address (object)
  }, [session?.sessionId, video?.videoId, accountAddressStr]);

  // Video element event handlers
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;

    const handleTimeUpdate = () => setCurrentTime(videoEl.currentTime);
    const handleDurationChange = () => setDuration(videoEl.duration || 0);
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    videoEl.addEventListener('timeupdate', handleTimeUpdate);
    videoEl.addEventListener('durationchange', handleDurationChange);
    videoEl.addEventListener('play', handlePlay);
    videoEl.addEventListener('pause', handlePause);

    return () => {
      videoEl.removeEventListener('timeupdate', handleTimeUpdate);
      videoEl.removeEventListener('durationchange', handleDurationChange);
      videoEl.removeEventListener('play', handlePlay);
      videoEl.removeEventListener('pause', handlePause);
    };
    // Only re-attach when session presence changes (null ↔ active)
  }, [!!session]);

  // Get account balance helper - uses view function for Fungible Asset balance
  const getAccountBalance = useCallback(async (address: string, retries = 3): Promise<bigint> => {
    const aptosClient = createAptosClient();

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        // Use primary_fungible_store::balance view function for FA-based APT
        const result = await aptosClient.view({
          payload: {
            function: '0x1::primary_fungible_store::balance',
            typeArguments: ['0x1::fungible_asset::Metadata'],
            functionArguments: [address, '0xa'], // 0xa is APT metadata object
          },
        });
        const balance = BigInt(result[0] as string);
        console.log('[getAccountBalance] FA balance for', address, ':', balance.toString());
        return balance;
      } catch (err) {
        // If account not found or no balance, try legacy coin store
        try {
          const balance = await aptosClient.getAccountAPTAmount({
            accountAddress: address,
          });
          console.log('[getAccountBalance] Coin balance for', address, ':', balance);
          return BigInt(balance);
        } catch {
          // Account may not exist yet, retry
          if (attempt < retries - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            continue;
          }
          console.warn('Failed to get account balance:', err);
          return 0n;
        }
      }
    }
    return 0n;
  }, []);

  // Start session with session key (popup-free after initial funding)
  const handleStartSessionWithKey = useCallback(async () => {
    const currentSigner = signerRef.current;
    if (!video || !account?.address || !currentSigner) return;

    setSessionLoading(true);
    setError(null);

    try {
      if (!video.onChainVideoId) {
        throw new Error('This video is not yet registered on the blockchain.');
      }

      const aptosClient = createAptosClient();
      const prepaidSegments = 20;
      const spendingLimit = BigInt(video.pricePerSegment) * BigInt(prepaidSegments);

      // Create session key manager with browser storage
      const storage = new BrowserSessionKeyStorage();
      const manager = new SessionKeyManager(storage);
      sessionKeyManagerRef.current = manager;

      // Generate ephemeral keypair
      const ephemeralAccount = manager.generate();
      const ephemeralAddress = ephemeralAccount.accountAddress.toString();

      // Calculate funding amount (spending limit + 20% gas buffer)
      const gasBuffer = (spendingLimit * 20n) / 100n;
      const txGasEstimate = 100_000n * BigInt(prepaidSegments + 3); // start + segments + end + return
      const fundingAmount = spendingLimit + gasBuffer + txGasEstimate;

      // Fund ephemeral account (SINGLE POPUP)
      console.log('[SessionKey] Funding ephemeral account:', ephemeralAddress);
      console.log('[SessionKey] Funding amount:', fundingAmount.toString(), 'octas');

      const fundPayload = {
        function: '0x1::aptos_account::transfer' as `${string}::${string}::${string}`,
        functionArguments: [ephemeralAddress, fundingAmount.toString()],
      };

      const fundTx = await currentSigner({ data: fundPayload });
      console.log('[SessionKey] Fund tx submitted:', fundTx.hash);

      const txResult = await aptosClient.waitForTransaction({ transactionHash: fundTx.hash });
      console.log('[SessionKey] Fund tx confirmed:', txResult.success);

      if (!txResult.success) {
        throw new Error(`Funding transaction failed: ${fundTx.hash}`);
      }

      // Initialize manager state
      manager.initialize(account.address.toString(), spendingLimit);

      // Fetch balance (with retries for new accounts)
      const balance = await getAccountBalance(ephemeralAddress);
      console.log('[SessionKey] Ephemeral balance after funding:', balance.toString());

      if (balance === 0n) {
        // Double-check via direct API call
        const directBalance = await aptosClient.getAccountAPTAmount({ accountAddress: ephemeralAddress });
        console.log('[SessionKey] Direct balance check:', directBalance);

        if (directBalance === 0) {
          throw new Error(`Funding failed - ephemeral account has 0 balance. Check tx: ${fundTx.hash}`);
        }
        manager.setBalance(BigInt(directBalance));
      } else {
        manager.setBalance(balance);
      }

      // Import StreamLockContract to start session with ephemeral account
      const { createStreamLockContract } = await import('@streamlock/aptos');
      const contract = createStreamLockContract(aptosClient, {
        address: config.contractAddress,
        moduleName: 'protocol',
      });

      // Create session using ephemeral account (NO POPUP)
      const result = await contract.startSession(ephemeralAccount, {
        videoId: BigInt(video.onChainVideoId),
        prepaidSegments,
        maxDurationSeconds: 7200,
      });

      // Get transaction to extract events
      const fullTx = await aptosClient.getTransactionByHash({
        transactionHash: result.hash,
      });

      const events = 'events' in fullTx ? fullTx.events : [];
      const sessionEvent = events.find((e: { type: string }) =>
        e.type.includes('SessionStartedEvent')
      );

      if (!sessionEvent) {
        throw new Error('Session creation failed - no session event found');
      }

      const sessionData = sessionEvent.data as {
        session_id: string;
        video_id: string;
        prepaid_amount: string;
      };

      const newSession = {
        sessionId: BigInt(sessionData.session_id),
        videoId: BigInt(sessionData.video_id),
        prepaidBalance: BigInt(sessionData.prepaid_amount),
        segmentsPaid: 0,
        isActive: true,
      };

      // Update manager with session info
      manager.setSessionInfo(newSession.sessionId, newSession.videoId);

      setSession(newSession);
      setSessionKeyState(manager.getState());

    } catch (err) {
      // Cleanup on error
      if (sessionKeyManagerRef.current) {
        sessionKeyManagerRef.current.destroy();
        sessionKeyManagerRef.current = null;
      }
      setError(err instanceof Error ? err.message : 'Failed to start session. Please try again.');
    } finally {
      setSessionLoading(false);
    }
  }, [video, account, getAccountBalance]);

  // Start session with wallet signing (original flow, popup per segment)
  const handleStartSessionWithWallet = useCallback(async () => {
    const currentSigner = signerRef.current;
    if (!video || !account?.address || !currentSigner) return;

    setSessionLoading(true);
    setError(null);

    try {
      const prepaidSegments = 20;
      const prepaidAmount = BigInt(video.pricePerSegment) * BigInt(prepaidSegments);

      // Check if video has on-chain ID for real contract interaction
      if (video.onChainVideoId) {
        const payload = {
          function: `${config.contractAddress}::protocol::start_session` as `${string}::${string}::${string}`,
          functionArguments: [
            video.onChainVideoId,
            prepaidSegments.toString(),
            '7200', // 2 hour expiry
          ],
        };

        const pendingTx = await currentSigner({ data: payload });

        // Wait for transaction and extract session info from events
        const aptosClient = createAptosClient();
        const tx = await aptosClient.waitForTransaction({
          transactionHash: pendingTx.hash,
        });

        // Get full transaction with events
        const fullTx = await aptosClient.getTransactionByHash({
          transactionHash: pendingTx.hash,
        });

        // Extract session ID from event
        const events = 'events' in fullTx ? fullTx.events : [];
        const sessionEvent = events.find((e: { type: string }) =>
          e.type.includes('SessionStartedEvent')
        );

        if (sessionEvent) {
          const sessionData = sessionEvent.data as {
            session_id: string;
            video_id: string;
            prepaid_amount: string;
          };

          setSession({
            sessionId: BigInt(sessionData.session_id),
            videoId: BigInt(sessionData.video_id),
            prepaidBalance: BigInt(sessionData.prepaid_amount),
            segmentsPaid: 0,
            isActive: true,
          });
        } else {
          throw new Error('Session creation failed - no session event found in transaction');
        }
      } else {
        // Video not registered on-chain - cannot create session
        throw new Error('This video is not yet registered on the blockchain. Please contact the creator.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start session. Please try again.');
    } finally {
      setSessionLoading(false);
    }
    // Note: signAndSubmitTransaction accessed via signerRef to avoid unstable dependency
  }, [video, account]);

  // Start session (delegates based on mode)
  const handleStartSession = useCallback(async () => {
    if (useSessionKey) {
      await handleStartSessionWithKey();
    } else {
      await handleStartSessionWithWallet();
    }
  }, [useSessionKey, handleStartSessionWithKey, handleStartSessionWithWallet]);

  // Top up session
  const handleTopUp = useCallback(async () => {
    const currentSigner = signerRef.current;
    if (!session || !video || !currentSigner) return;

    setSessionLoading(true);
    setError(null);

    try {
      const additionalSegments = 10;
      const additionalAmount = BigInt(video.pricePerSegment) * BigInt(additionalSegments);

      if (video.onChainVideoId && session.sessionId > 0n) {
        const payload = {
          function: `${config.contractAddress}::protocol::top_up_session` as `${string}::${string}::${string}`,
          functionArguments: [
            session.sessionId.toString(),
            additionalSegments.toString(),
          ],
        };

        await currentSigner({ data: payload });
      }

      // Update local session state
      setSession((prev) =>
        prev
          ? {
              ...prev,
              prepaidBalance: prev.prepaidBalance + additionalAmount,
            }
          : null
      );

      // Update key loader session if needed
      if (keyLoaderRef.current) {
        keyLoaderRef.current.updateSessionId(session.sessionId);
      }
    } catch {
      setError('Failed to top up session');
    } finally {
      setSessionLoading(false);
    }
    // Note: signAndSubmitTransaction accessed via signerRef to avoid unstable dependency
  }, [session, video]);

  // Return session key funds to main wallet
  const handleReturnFunds = useCallback(async () => {
    const manager = sessionKeyManagerRef.current;
    const account = manager?.getAccount();
    const state = manager?.getState();

    if (!manager?.isActive() || !account || !state) {
      return null;
    }

    setIsReturningFunds(true);

    try {
      const aptosClient = createAptosClient();

      // Get current balance
      const currentBalance = await getAccountBalance(state.address);
      if (currentBalance <= 0n) {
        return null;
      }

      // Estimate gas for transfer (10k gas units * 100 gas price = 1M octas max)
      const maxGasAmount = 10000;
      const gasUnitPrice = 100;
      const estimatedGas = BigInt(maxGasAmount * gasUnitPrice);
      const transferAmount = currentBalance - estimatedGas;

      if (transferAmount <= 0n) {
        console.log('[ReturnFunds] Balance too low to cover gas:', currentBalance.toString());
        return null;
      }

      console.log('[ReturnFunds] Transferring', transferAmount.toString(), 'octas back to', state.fundingWallet);

      // Transfer back to main wallet with explicit gas limit
      const txn = await aptosClient.transaction.build.simple({
        sender: account.accountAddress,
        data: {
          function: '0x1::aptos_account::transfer',
          functionArguments: [state.fundingWallet, transferAmount.toString()],
        },
        options: {
          maxGasAmount,
          gasUnitPrice,
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
  }, [getAccountBalance]);

  // End session
  const handleEndSession = useCallback(async () => {
    if (!session) return;

    setSessionLoading(true);
    try {
      const aptosClient = createAptosClient();
      const sessionKeyManager = sessionKeyManagerRef.current;
      const sessionKeyAccount = sessionKeyManager?.getAccount();

      // End on-chain session
      if (video?.onChainVideoId && session.sessionId > 0n) {
        try {
          if (sessionKeyAccount) {
            // Use session key to end session (no popup)
            const { createStreamLockContract } = await import('@streamlock/aptos');
            const contract = createStreamLockContract(aptosClient, {
              address: config.contractAddress,
              moduleName: 'protocol',
            });
            await contract.endSession(sessionKeyAccount, session.sessionId);
          } else {
            // Use wallet adapter (popup)
            const currentSigner = signerRef.current;
            if (currentSigner) {
              const payload = {
                function: `${config.contractAddress}::protocol::end_session` as `${string}::${string}::${string}`,
                functionArguments: [session.sessionId.toString()],
              };
              await currentSigner({ data: payload });
            }
          }
        } catch {
          // Continue with cleanup even if on-chain fails
        }
      }

      // Return remaining funds from session key if active
      if (sessionKeyManager?.isActive()) {
        try {
          await handleReturnFunds();
        } catch {
          // Continue cleanup even if return fails
        }
        sessionKeyManager.destroy();
        sessionKeyManagerRef.current = null;
        setSessionKeyState(null);
      }

      // Cleanup HLS
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
        hlsVideoIdRef.current = null;
      }

      // Cleanup key loader
      if (keyLoaderRef.current) {
        keyLoaderRef.current.clearCache();
        keyLoaderRef.current = null;
      }

      setSession(null);
      setPayments([]);
      setIsLoadingKey(false);
      setCurrentKeySegment(null);

      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.currentTime = 0;
      }
    } catch {
      // Session cleanup continues even on error
    } finally {
      setSessionLoading(false);
    }
    // Note: signAndSubmitTransaction accessed via signerRef to avoid unstable dependency
  }, [session, video, handleReturnFunds]);

  // Calculate current segment based on time (5 seconds per segment)
  const currentSegment = video ? Math.floor(currentTime / 5) : 0;

  // Calculate remaining segments
  const remainingSegments = session && video
    ? Math.floor(Number(session.prepaidBalance) / Number(video.pricePerSegment))
    : 0;

  if (loading) {
    return (
      <main className="min-h-screen bg-background">
        <header className="border-b">
          <div className="container mx-auto px-4 py-4 flex justify-between items-center">
            <Link href="/" className="text-2xl font-bold text-primary">
              StreamLock
            </Link>
            <ConnectButton />
          </div>
        </header>
        <div className="container mx-auto px-4 py-8">
          <div className="grid lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2">
              <Skeleton className="aspect-video w-full rounded-lg" />
              <Skeleton className="h-8 w-2/3 mt-4" />
              <Skeleton className="h-4 w-1/2 mt-2" />
            </div>
            <div>
              <Skeleton className="h-48 w-full rounded-lg" />
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (error && !video) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center">
            <AlertCircle className="h-12 w-12 mx-auto mb-4 text-destructive" />
            <p className="text-destructive mb-4">{error}</p>
            <Link href="/browse">
              <Button variant="outline">Browse Videos</Button>
            </Link>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <Link href="/" className="text-2xl font-bold text-primary">
            StreamLock
          </Link>
          <nav className="flex items-center gap-4">
            <Link href="/browse" className="text-muted-foreground hover:text-foreground">
              Browse
            </Link>
            <Link href="/creator" className="text-muted-foreground hover:text-foreground">
              Creator
            </Link>
            <ConnectButton />
          </nav>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        {/* Error banner */}
        {error && (
          <div className="mb-4 p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            {error}
            <button onClick={() => setError(null)} className="ml-auto">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Video Player */}
          <div className="lg:col-span-2">
            <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
              {!connected ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
                  <Wallet className="h-12 w-12 mb-4 opacity-75" />
                  <p className="mb-4 text-lg">Connect wallet to watch</p>
                  <ConnectButton />
                </div>
              ) : !session ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
                  {video?.thumbnailUri && (
                    <img
                      src={video.thumbnailUri}
                      alt={video.title}
                      className="absolute inset-0 w-full h-full object-cover opacity-30"
                    />
                  )}
                  <div className="relative z-10 text-center max-w-md px-4">
                    <Play className="h-16 w-16 mx-auto mb-4 opacity-75" />
                    <p className="mb-2 text-lg">Start a session to watch</p>
                    <p className="text-sm text-gray-400 mb-4">
                      Prepay for 20 segments (~{formatApt(BigInt(video?.pricePerSegment || '0') * 20n)} APT)
                    </p>

                    {/* Session mode toggle */}
                    <div className="flex items-center justify-center gap-2 mb-4 text-sm">
                      <button
                        onClick={() => setUseSessionKey(true)}
                        className={`flex items-center gap-1 px-3 py-1.5 rounded-full transition ${
                          useSessionKey
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-white/10 hover:bg-white/20'
                        }`}
                      >
                        <Zap className="h-3 w-3" />
                        Popup-Free
                      </button>
                      <button
                        onClick={() => setUseSessionKey(false)}
                        className={`flex items-center gap-1 px-3 py-1.5 rounded-full transition ${
                          !useSessionKey
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-white/10 hover:bg-white/20'
                        }`}
                      >
                        <Wallet className="h-3 w-3" />
                        Wallet Sign
                      </button>
                    </div>

                    {useSessionKey && (
                      <p className="text-xs text-gray-500 mb-4">
                        One approval to fund session. No popups during playback.
                      </p>
                    )}

                    <Button
                      size="lg"
                      onClick={handleStartSession}
                      disabled={sessionLoading}
                    >
                      {sessionLoading ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          {useSessionKey ? 'Funding Session Key...' : 'Starting...'}
                        </>
                      ) : (
                        <>
                          {useSessionKey ? <Key className="h-4 w-4 mr-2" /> : <Play className="h-4 w-4 mr-2" />}
                          {useSessionKey ? 'Start (Single Approval)' : 'Start Session'}
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              ) : null}
              {/* Always render video element to prevent MediaSource issues on re-renders */}
              <video
                ref={videoRef}
                className={`w-full h-full ${!session ? 'hidden' : ''}`}
                controls
                playsInline
                poster={video?.thumbnailUri || undefined}
              />
              {/* Key loading indicator */}
              {session && isLoadingKey && (
                <div className="absolute top-4 right-4 bg-black/70 px-3 py-2 rounded-lg flex items-center gap-2 text-white text-sm">
                  <Lock className="h-4 w-4 animate-pulse" />
                  Unlocking segment {currentKeySegment !== null ? currentKeySegment + 1 : ''}...
                </div>
              )}
            </div>

            {/* Video Info */}
            <div className="mt-4">
              <h1 className="text-2xl font-bold">{video?.title}</h1>
              {video?.creatorAddress && (
                <div className="flex items-center gap-2 mt-2 text-muted-foreground">
                  <User className="h-4 w-4" />
                  <span>{truncateAddress(video.creatorAddress)}</span>
                </div>
              )}
              {video?.description && (
                <p className="text-muted-foreground mt-3">{video.description}</p>
              )}

              <div className="flex flex-wrap gap-3 mt-4">
                <Badge variant="secondary">
                  <Clock className="h-3 w-3 mr-1" />
                  {formatDuration(video?.durationSeconds || 0)}
                </Badge>
                <Badge variant="secondary">
                  <DollarSign className="h-3 w-3 mr-1" />
                  {formatApt(BigInt(video?.pricePerSegment || '0'))}/segment
                </Badge>
                <Badge variant="outline">
                  {video?.totalSegments} segments
                </Badge>
              </div>
            </div>
          </div>

          {/* Session Panel */}
          <div className="space-y-4">
            {/* Session Info */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center justify-between">
                  <span>Session</span>
                  {sessionKeyState && (
                    <Badge variant="secondary" className="text-xs">
                      <Zap className="h-3 w-3 mr-1" />
                      Popup-Free
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {session ? (
                  <>
                    {/* Balance */}
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Balance</span>
                        <span className="font-semibold">
                          {formatApt(session.prepaidBalance)} APT
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Segments remaining</span>
                        <span className="font-semibold">{remainingSegments}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Current segment</span>
                        <span className="font-semibold">
                          {currentSegment + 1} / {video?.totalSegments || 0}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Segments paid</span>
                        <span className="font-semibold">{payments.length}</span>
                      </div>
                    </div>

                    {/* Progress */}
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground">Playback progress</div>
                      <Progress
                        value={(currentSegment / (video?.totalSegments || 1)) * 100}
                        className="h-2"
                      />
                    </div>

                    <Separator />

                    {/* Actions */}
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={handleTopUp}
                        disabled={sessionLoading}
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        Top Up
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="flex-1"
                        onClick={handleEndSession}
                        disabled={sessionLoading}
                      >
                        <X className="h-3 w-3 mr-1" />
                        End Session
                      </Button>
                    </div>

                    {/* Session Key Status (when using popup-free mode) */}
                    {sessionKeyState && (
                      <>
                        <Separator />
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <Key className="h-4 w-4 text-primary" />
                            Session Key Active
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Key Balance</span>
                            <span className="font-semibold text-green-600">
                              {formatApt(sessionKeyState.currentBalance)} APT
                            </span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Segments Affordable</span>
                            <span className="font-semibold">
                              ~{video ? Math.floor(Number(sessionKeyState.currentBalance) / (Number(video.pricePerSegment) + 100_000)) : 0}
                            </span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Spent on Segments</span>
                            <span className="font-mono text-xs">
                              {formatApt(sessionKeyState.segmentSpend)} APT
                            </span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Spent on Gas</span>
                            <span className="font-mono text-xs">
                              {formatApt(sessionKeyState.gasSpend)} APT
                            </span>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full mt-2"
                            onClick={handleReturnFunds}
                            disabled={isReturningFunds || sessionKeyState.currentBalance <= 100_000n}
                          >
                            {isReturningFunds ? (
                              <>
                                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                Returning...
                              </>
                            ) : (
                              <>
                                <ArrowLeftRight className="h-3 w-3 mr-1" />
                                Return Remaining Funds
                              </>
                            )}
                          </Button>
                        </div>
                      </>
                    )}

                    {/* Low balance warning */}
                    {remainingSegments < 5 && (
                      <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-sm text-amber-600">
                        Low balance! Top up to continue watching.
                      </div>
                    )}

                    {/* Session key low balance warning */}
                    {sessionKeyState && video && (
                      Math.floor(Number(sessionKeyState.currentBalance) / (Number(video.pricePerSegment) + 100_000)) < 3
                    ) && (
                      <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-sm text-amber-600">
                        <Key className="h-3 w-3 inline mr-1" />
                        Session key running low! End session to return remaining funds.
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-center py-4 text-muted-foreground">
                    <p className="text-sm">
                      Start a session to begin watching. You'll prepay for segments and can
                      top up as needed.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Payment Feed */}
            {session && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Unlock className="h-4 w-4" />
                    Decrypted Segments
                  </CardTitle>
                  <CardDescription>On-chain payments for segment keys</CardDescription>
                </CardHeader>
                <CardContent>
                  {payments.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      Segment keys will appear here as you watch
                    </p>
                  ) : (
                    <ScrollArea className="h-48">
                      <div className="space-y-2">
                        {payments.slice().reverse().map((payment, i) => (
                          <div
                            key={i}
                            className="flex justify-between text-sm p-2 bg-muted/50 rounded"
                          >
                            <span className="flex items-center gap-2">
                              <Unlock className="h-3 w-3 text-green-500" />
                              Segment {payment.segmentIndex + 1}
                            </span>
                            <span className="font-mono text-muted-foreground text-xs">
                              {formatApt(payment.amount)} APT
                            </span>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Video Stats */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Video Info</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Duration</span>
                  <span>{formatDuration(video?.durationSeconds || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total segments</span>
                  <span>{video?.totalSegments || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Price per segment</span>
                  <span>{formatApt(BigInt(video?.pricePerSegment || '0'))} APT</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total cost</span>
                  <span>
                    {formatApt(BigInt(video?.pricePerSegment || '0') * BigInt(video?.totalSegments || 0))} APT
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </main>
  );
}
