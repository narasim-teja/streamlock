'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import Link from 'next/link';
import Hls from 'hls.js';
import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk';
import { ConnectButton } from '@/components/wallet/ConnectButton';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Progress } from '@/components/ui/Progress';
import { Skeleton } from '@/components/ui/Skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/Separator';
import { formatApt, truncateAddress } from '@streamlock/common';
import { X402KeyLoader, createX402LoaderClass } from '@streamlock/viewer-sdk';
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

    if (!currentSession || !currentVideo || !videoRef.current || !currentSigner || !accountAddressStr) return;

    const videoEl = videoRef.current;

    // Track if this effect instance is still active (for React 18 StrictMode)
    let isActive = true;

    // Skip if HLS instance already exists for this exact video (React 18 StrictMode double-run)
    // Only recreate if the video actually changed
    if (hlsRef.current && hlsVideoIdRef.current === currentVideo.videoId) {
      console.log('[StreamLock] HLS instance already exists for this video, skipping recreation');
      return;
    }

    // Destroy previous instance if it's for a different video
    if (hlsRef.current) {
      console.log('[StreamLock] Destroying HLS instance for previous video');
      hlsRef.current.destroy();
      hlsRef.current = null;
      hlsVideoIdRef.current = null;
    }

    if (Hls.isSupported()) {
      // Create Aptos client
      const aptosClient = createAptosClient();

      // Create a stable signer wrapper that reads from ref at call time
      // This ensures we always use the latest signer function even if it gets recreated
      const signerWrapper = async (payload: Parameters<NonNullable<typeof signAndSubmitTransaction>>[0]['data']) => {
        const signer = signerRef.current;
        if (!signer) {
          throw new Error('Wallet not connected');
        }
        const result = await signer({ data: payload });
        return result;
      };

      // Create key loader for x402 payment flow
      const keyLoader = new X402KeyLoader({
        keyServerBaseUrl: '/api',
        sessionId: currentSession.sessionId,
        videoId: currentSession.videoId,
        localVideoId: currentVideo.videoId,
        aptosClient,
        contractAddress: config.contractAddress,
        accountAddress: accountAddressStr!,
        signer: signerWrapper,
        onPayment: (segmentIndex, txHash, amount) => {
          console.log(`[StreamLock] Payment for segment ${segmentIndex}: ${txHash}`);
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
        onKeyReceived: (key) => {
          console.log(`[StreamLock] Key received for segment ${key.segmentIndex}`);
          setIsLoadingKey(false);
          setCurrentKeySegment(null);
        },
        onError: (error) => {
          console.error('[StreamLock] Key loader error:', error);
          setIsLoadingKey(false);
        },
      });

      keyLoaderRef.current = keyLoader;

      // Create custom HLS.js loader that intercepts key requests
      const X402Loader = createX402LoaderClass({
        keyLoader,
        onKeyLoading: (segmentIndex) => {
          console.log(`[StreamLock] Loading key for segment ${segmentIndex}`);
          setCurrentKeySegment(segmentIndex);
          setIsLoadingKey(true);
        },
        onKeyLoaded: (segmentIndex) => {
          console.log(`[StreamLock] Key loaded for segment ${segmentIndex}`);
          setIsLoadingKey(false);
          setCurrentKeySegment(null);
        },
        onError: (segmentIndex, error) => {
          console.error(`[StreamLock] Error loading key for segment ${segmentIndex}:`, error);
          setIsLoadingKey(false);
          setError(`Failed to load key for segment ${segmentIndex}: ${error.message}`);
        },
      });

      // Create HLS instance with custom loader and buffer gap handling
      const hls = new Hls({
        debug: true, // Enable debug to see what's happening
        enableWorker: true,
        loader: X402Loader,
        // Buffer gap handling - important for encrypted streams
        maxBufferHole: 0.5, // Allow up to 0.5s buffer holes
        maxMaxBufferLength: 30, // Buffer up to 30 seconds
        startPosition: -1, // Start from the beginning, let HLS.js figure out the position
        nudgeOffset: 0.1, // Nudge amount when stalled
        nudgeMaxRetry: 5, // Max nudge retries before giving up
        // Fix for Arc browser - don't let HLS.js manage backBuffer aggressively
        backBufferLength: Infinity,
        // Prevent liveSyncDuration from interfering
        liveSyncDuration: undefined,
        liveMaxLatencyDuration: undefined,
      });

      // IMPORTANT: Attach media FIRST, then load source
      // This ensures MediaSource is properly bound before loading starts
      hls.attachMedia(videoEl);

      // Wait for MEDIA_ATTACHED event before loading source
      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        console.log('[StreamLock] Media attached, loading source...');
        hls.loadSource(currentVideo.contentUri);
      });

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        console.log('[StreamLock] Manifest parsed, ready to play');
      });

      // Log fragment loading progress
      hls.on(Hls.Events.FRAG_LOADING, (event, data) => {
        console.log('[StreamLock] Fragment loading:', data.frag.sn);
      });

      hls.on(Hls.Events.FRAG_LOADED, (event, data) => {
        console.log('[StreamLock] Fragment loaded:', data.frag.sn);
      });

      hls.on(Hls.Events.FRAG_DECRYPTED, (event, data) => {
        console.log('[StreamLock] Fragment DECRYPTED:', data.frag.sn);
      });

      // Track if we've already tried to autoplay
      let hasTriedAutoplay = false;

      hls.on(Hls.Events.FRAG_BUFFERED, (event, data) => {
        console.log('[StreamLock] Fragment buffered:', data.frag.sn);
        // Only try autoplay once after first fragment is buffered
        if (!hasTriedAutoplay) {
          hasTriedAutoplay = true;
          // Wait a bit for the buffer to stabilize, then seek past any gap and play
          setTimeout(() => {
            // Seek to the start of the buffered range if there's a gap
            if (videoEl.buffered.length > 0) {
              const bufferStart = videoEl.buffered.start(0);
              if (bufferStart > 0.01 && videoEl.currentTime < bufferStart) {
                console.log(`[StreamLock] Seeking past buffer gap from ${videoEl.currentTime} to ${bufferStart}`);
                videoEl.currentTime = bufferStart;
              }
            }
            videoEl.play().catch((err) => {
              console.log('[StreamLock] Autoplay blocked:', err.message);
            });
          }, 100);
        }
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        console.error('[StreamLock] HLS error:', data);
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.log('[StreamLock] Network error, trying to recover...');
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.log('[StreamLock] Media error, trying to recover...');
              hls.recoverMediaError();
              break;
            default:
              console.error('[StreamLock] Fatal error, cannot recover');
              setError('Playback error. Please try again.');
              hls.destroy();
              break;
          }
        }
      });

      hlsRef.current = hls;
      hlsVideoIdRef.current = currentVideo.videoId;
      console.log('[StreamLock] HLS instance created and attached for video:', currentVideo.videoId);
    } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS support (Safari) - won't work with x402 payment flow
      // Safari would need a service worker approach for custom key loading
      setError('Safari is not fully supported yet. Please use Chrome or Firefox.');
    }

    return () => {
      // Don't destroy HLS here - prevents React 18 StrictMode from closing MediaSource
      // Cleanup happens at:
      // - Effect start (lines 165-170) on dependency change
      // - handleEndSession on session end
      isActive = false;
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

  // Start session
  const handleStartSession = useCallback(async () => {
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
          // Fallback: create mock session if event not found
          console.warn('Session event not found, using fallback session');
          setSession({
            sessionId: BigInt(Date.now()),
            videoId: BigInt(video.onChainVideoId),
            prepaidBalance: prepaidAmount,
            segmentsPaid: 0,
            isActive: true,
          });
        }
      } else {
        // No on-chain video ID yet - create a demo session for testing
        // This allows testing the video playback flow before full on-chain registration
        console.warn('Video not registered on-chain, using demo session');
        setSession({
          sessionId: BigInt(Date.now()),
          videoId: 0n,
          prepaidBalance: prepaidAmount,
          segmentsPaid: 0,
          isActive: true,
        });
      }
    } catch (err) {
      console.error('Failed to start session:', err);
      setError('Failed to start session. Please try again.');
    } finally {
      setSessionLoading(false);
    }
    // Note: signAndSubmitTransaction accessed via signerRef to avoid unstable dependency
  }, [video, account]);

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
    } catch (err) {
      console.error('Failed to top up:', err);
      setError('Failed to top up session');
    } finally {
      setSessionLoading(false);
    }
    // Note: signAndSubmitTransaction accessed via signerRef to avoid unstable dependency
  }, [session, video]);

  // End session
  const handleEndSession = useCallback(async () => {
    if (!session) return;

    setSessionLoading(true);
    try {
      // End on-chain session if applicable
      const currentSigner = signerRef.current;
      if (video?.onChainVideoId && session.sessionId > 0n && currentSigner) {
        try {
          const payload = {
            function: `${config.contractAddress}::protocol::end_session` as `${string}::${string}::${string}`,
            functionArguments: [session.sessionId.toString()],
          };
          await currentSigner({ data: payload });
        } catch (err) {
          console.warn('Failed to end on-chain session:', err);
          // Continue with cleanup even if on-chain fails
        }
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
    } catch (err) {
      console.error('Failed to end session:', err);
    } finally {
      setSessionLoading(false);
    }
    // Note: signAndSubmitTransaction accessed via signerRef to avoid unstable dependency
  }, [session, video]);

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
                  <div className="relative z-10 text-center">
                    <Play className="h-16 w-16 mx-auto mb-4 opacity-75" />
                    <p className="mb-2 text-lg">Start a session to watch</p>
                    <p className="text-sm text-gray-400 mb-4">
                      Prepay for 20 segments (~{formatApt(BigInt(video?.pricePerSegment || '0') * 20n)} APT)
                    </p>
                    <Button
                      size="lg"
                      onClick={handleStartSession}
                      disabled={sessionLoading}
                    >
                      {sessionLoading ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Starting...
                        </>
                      ) : (
                        <>
                          <Play className="h-4 w-4 mr-2" />
                          Start Session
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              ) : null}
              {/* Always render video element to prevent MediaSource from closing on re-renders */}
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
                <CardTitle className="text-lg">Session</CardTitle>
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

                    {/* Low balance warning */}
                    {remainingSegments < 5 && (
                      <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-sm text-amber-600">
                        Low balance! Top up to continue watching.
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
