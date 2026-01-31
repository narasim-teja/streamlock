'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import Link from 'next/link';
import Hls from 'hls.js';
import { ConnectButton } from '@/components/wallet/ConnectButton';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Progress } from '@/components/ui/Progress';
import { Skeleton } from '@/components/ui/Skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/Separator';
import { formatApt, truncateAddress } from '@streamlock/common';
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
  timestamp: number;
}

interface SessionState {
  sessionId: string;
  prepaidBalance: bigint;
  segmentsPaid: number;
  isActive: boolean;
}

// Cache for decryption keys (to avoid re-paying for same segment)
const keyCache = new Map<string, ArrayBuffer>();

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
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
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentKeySegment, setCurrentKeySegment] = useState<number | null>(null);
  const [isLoadingKey, setIsLoadingKey] = useState(false);

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
    if (!session || !video || !videoRef.current) return;

    const videoEl = videoRef.current;

    // Clean up previous instance
    if (hlsRef.current) {
      hlsRef.current.destroy();
    }

    if (Hls.isSupported()) {
      const hls = new Hls({
        debug: false,
        enableWorker: true,
        // Add X-Payment header to key requests
        xhrSetup: (xhr, url) => {
          // Check if this is a key request
          if (url.includes('/key/')) {
            xhr.setRequestHeader('X-Payment', JSON.stringify({
              txHash: `demo-tx-${Date.now()}`,
              network: 'aptos-testnet',
              sessionId: session.sessionId,
            }));
          }
        },
      });

      // Track key loading for UI feedback
      hls.on(Hls.Events.KEY_LOADING, (event, data) => {
        const segmentMatch = data.frag?.decryptdata?.uri?.match(/\/key\/(\d+)/);
        const segmentIndex = segmentMatch ? parseInt(segmentMatch[1]) : 0;
        console.log(`[HLS] Loading key for segment ${segmentIndex}`);
        setCurrentKeySegment(segmentIndex);
        setIsLoadingKey(true);
      });

      hls.on(Hls.Events.KEY_LOADED, (event, data) => {
        const segmentMatch = data.frag?.decryptdata?.uri?.match(/\/key\/(\d+)/);
        const segmentIndex = segmentMatch ? parseInt(segmentMatch[1]) : 0;
        console.log(`[HLS] Key loaded for segment ${segmentIndex}`);
        setIsLoadingKey(false);
        setCurrentKeySegment(null);

        // Record the "payment" for this segment
        setPayments(prev => {
          // Avoid duplicates
          if (prev.some(p => p.segmentIndex === segmentIndex)) {
            return prev;
          }
          return [...prev, {
            segmentIndex,
            amount: BigInt(video.pricePerSegment),
            timestamp: Date.now(),
          }];
        });
      });

      hls.loadSource(video.contentUri);
      hls.attachMedia(videoEl);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        console.log('[HLS] Manifest parsed, ready to play');
        videoEl.play().catch(console.error);
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        console.error('[HLS] Error:', data);
        setIsLoadingKey(false);
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.log('[HLS] Network error, trying to recover...');
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.log('[HLS] Media error, trying to recover...');
              hls.recoverMediaError();
              break;
            default:
              console.error('[HLS] Fatal error, cannot recover');
              hls.destroy();
              break;
          }
        }
      });

      hlsRef.current = hls;
    } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS support (Safari) - won't work with custom key loading
      // For Safari, we'd need a different approach
      videoEl.src = video.contentUri;
      videoEl.addEventListener('loadedmetadata', () => {
        videoEl.play().catch(console.error);
      });
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [session, video]);

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
  }, [session]);

  // Start session
  const handleStartSession = useCallback(async () => {
    if (!video || !account?.address || !signAndSubmitTransaction) return;

    setSessionLoading(true);
    setError(null);

    try {
      const prepaidSegments = 20;
      const prepaidAmount = BigInt(video.pricePerSegment) * BigInt(prepaidSegments);

      // If video has on-chain ID, call the contract
      if (video.onChainVideoId) {
        const payload = {
          function: `${config.contractAddress}::protocol::start_session` as `${string}::${string}::${string}`,
          functionArguments: [
            video.onChainVideoId,
            prepaidSegments.toString(),
            '7200',
          ],
        };

        await signAndSubmitTransaction({ data: payload });
      }

      // Create local session state
      const mockSessionId = `session-${Date.now()}`;
      setSession({
        sessionId: mockSessionId,
        prepaidBalance: prepaidAmount,
        segmentsPaid: 0,
        isActive: true,
      });
    } catch (err) {
      console.error('Failed to start session:', err);
      setError('Failed to start session. Please try again.');
    } finally {
      setSessionLoading(false);
    }
  }, [video, account, signAndSubmitTransaction]);

  // Top up session
  const handleTopUp = useCallback(async () => {
    if (!session || !video) return;

    setSessionLoading(true);
    try {
      const additionalSegments = 10;
      const additionalAmount = BigInt(video.pricePerSegment) * BigInt(additionalSegments);

      setSession((prev) =>
        prev
          ? {
              ...prev,
              prepaidBalance: prev.prepaidBalance + additionalAmount,
            }
          : null
      );
    } catch (err) {
      console.error('Failed to top up:', err);
      setError('Failed to top up session');
    } finally {
      setSessionLoading(false);
    }
  }, [session, video]);

  // End session
  const handleEndSession = useCallback(async () => {
    if (!session) return;

    setSessionLoading(true);
    try {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      setSession(null);
      setPayments([]);
      keyCache.clear();
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.currentTime = 0;
      }
    } catch (err) {
      console.error('Failed to end session:', err);
    } finally {
      setSessionLoading(false);
    }
  }, [session]);

  // Calculate current segment based on time
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
              ) : (
                <>
                  <video
                    ref={videoRef}
                    className="w-full h-full"
                    controls
                    playsInline
                    poster={video?.thumbnailUri || undefined}
                  />
                  {/* Key loading indicator */}
                  {isLoadingKey && (
                    <div className="absolute top-4 right-4 bg-black/70 px-3 py-2 rounded-lg flex items-center gap-2 text-white text-sm">
                      <Lock className="h-4 w-4 animate-pulse" />
                      Unlocking segment {currentKeySegment !== null ? currentKeySegment + 1 : ''}...
                    </div>
                  )}
                </>
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
                  <CardDescription>Keys fetched as you watch</CardDescription>
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
                            <span className="font-mono text-muted-foreground">
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

/**
 * Custom key loader that handles x402 payment flow
 * For demo purposes, this fetches keys without actual payment verification
 */
async function loadKeyWithPayment(
  context: any,
  config: any,
  callbacks: any,
  video: VideoInfo,
  session: SessionState,
  onPayment: (segment: number, amount: bigint) => void,
  setCurrentKeySegment: (segment: number | null) => void,
  setIsLoadingKey: (loading: boolean) => void
) {
  const keyUrl = context.url;

  // Extract segment index from URL (format: /api/videos/{videoId}/key/{segment})
  const segmentMatch = keyUrl.match(/\/key\/(\d+)/);
  const segmentIndex = segmentMatch ? parseInt(segmentMatch[1]) : 0;

  // Check cache first
  const cacheKey = `${video.videoId}-${segmentIndex}`;
  if (keyCache.has(cacheKey)) {
    console.log(`[KeyLoader] Using cached key for segment ${segmentIndex}`);
    const cachedKey = keyCache.get(cacheKey)!;
    callbacks.onSuccess(
      { data: cachedKey },
      { url: keyUrl },
      context
    );
    return;
  }

  setCurrentKeySegment(segmentIndex);
  setIsLoadingKey(true);

  try {
    console.log(`[KeyLoader] Fetching key for segment ${segmentIndex}`);

    // For demo: skip 402 flow and just pass a mock payment header
    // In production: handle 402 response, pay on-chain, then retry
    const response = await fetch(keyUrl, {
      headers: {
        'X-Payment': JSON.stringify({
          txHash: `demo-tx-${Date.now()}`,
          network: 'aptos-testnet',
          sessionId: session.sessionId,
        }),
      },
    });

    if (!response.ok) {
      throw new Error(`Key fetch failed: ${response.status}`);
    }

    const keyData = await response.json();

    // Convert base64 key to ArrayBuffer for HLS.js
    const keyBytes = Uint8Array.from(atob(keyData.key), c => c.charCodeAt(0));
    const keyBuffer = keyBytes.buffer;

    // Cache the key
    keyCache.set(cacheKey, keyBuffer);

    // Record payment
    onPayment(segmentIndex, BigInt(video.pricePerSegment));

    console.log(`[KeyLoader] Key loaded for segment ${segmentIndex}`);

    callbacks.onSuccess(
      { data: keyBuffer },
      { url: keyUrl },
      context
    );
  } catch (error) {
    console.error(`[KeyLoader] Error loading key for segment ${segmentIndex}:`, error);
    callbacks.onError(
      { code: 2, text: 'Key loading failed' },
      context,
      null
    );
  } finally {
    setIsLoadingKey(false);
    setCurrentKeySegment(null);
  }
}
