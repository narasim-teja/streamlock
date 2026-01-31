'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import Link from 'next/link';
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
  Pause,
  Wallet,
  Plus,
  X,
  Clock,
  DollarSign,
  Loader2,
  AlertCircle,
  User,
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
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

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
      // For MVP/demo: create a local session
      // In production: use viewer-sdk's useStreamLockPlayer hook
      // which calls start_session on-chain

      const prepaidSegments = 20;
      const prepaidAmount = BigInt(video.pricePerSegment) * BigInt(prepaidSegments);

      // If video has on-chain ID, call the contract
      if (video.onChainVideoId) {
        // Build transaction payload
        const payload = {
          function: `${config.contractAddress}::protocol::start_session` as `${string}::${string}::${string}`,
          functionArguments: [
            video.onChainVideoId, // video_id
            prepaidSegments.toString(), // prepaid_segments
            '7200', // max_duration_seconds (2 hours)
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

      // Start playing
      if (videoRef.current) {
        videoRef.current.play().catch(console.error);
      }
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

      // If on-chain session exists, call top_up_session
      // For demo, just update local state
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
      // If on-chain session exists, call end_session
      // For demo, just clear local state
      setSession(null);
      setPayments([]);
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
  const currentSegment = video
    ? Math.floor(currentTime / 5) // 5 seconds per segment
    : 0;

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
                <video
                  ref={videoRef}
                  className="w-full h-full"
                  controls
                  playsInline
                  poster={video?.thumbnailUri || undefined}
                >
                  <source src={video?.contentUri} type="application/vnd.apple.mpegurl" />
                  Your browser does not support HLS video.
                </video>
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
                  <CardTitle className="text-lg">Payment Feed</CardTitle>
                  <CardDescription>Real-time payments as you watch</CardDescription>
                </CardHeader>
                <CardContent>
                  {payments.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      Payments will appear here as you watch
                    </p>
                  ) : (
                    <ScrollArea className="h-48">
                      <div className="space-y-2">
                        {payments.map((payment, i) => (
                          <div
                            key={i}
                            className="flex justify-between text-sm p-2 bg-muted/50 rounded"
                          >
                            <span>Segment {payment.segmentIndex + 1}</span>
                            <span className="font-mono">
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
