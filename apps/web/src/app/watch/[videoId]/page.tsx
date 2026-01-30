'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import Link from 'next/link';
import { ConnectButton } from '@/components/wallet/ConnectButton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { formatApt } from '@streamlock/common';

interface VideoInfo {
  videoId: string;
  title: string;
  description: string;
  creator: string;
  pricePerSegment: number;
  totalSegments: number;
  durationSeconds: number;
}

export default function WatchPage() {
  const params = useParams();
  const videoId = params.videoId as string;
  const { connected } = useWallet();

  const [video, setVideo] = useState<VideoInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<{ sessionId: string; balance: bigint } | null>(null);
  const [payments, setPayments] = useState<{ segment: number; amount: bigint }[]>([]);

  useEffect(() => {
    async function fetchVideo() {
      try {
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

  const startSession = async () => {
    // TODO: Implement session start
    setSession({ sessionId: 'mock-session', balance: BigInt(1000000) });
  };

  const endSession = async () => {
    // TODO: Implement session end
    setSession(null);
  };

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p>Loading...</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <Card>
          <CardContent className="pt-6">
            <p className="text-destructive">{error}</p>
            <Link href="/">
              <Button variant="outline" className="mt-4">
                Go Home
              </Button>
            </Link>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      {/* Header */}
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
          {/* Video Player */}
          <div className="lg:col-span-2">
            <div className="aspect-video bg-black rounded-lg flex items-center justify-center">
              {!connected ? (
                <div className="text-center text-white">
                  <p className="mb-4">Connect wallet to watch</p>
                  <ConnectButton />
                </div>
              ) : !session ? (
                <div className="text-center text-white">
                  <p className="mb-4">Start a session to watch</p>
                  <Button onClick={startSession}>
                    Start Session (0.1 APT prepay)
                  </Button>
                </div>
              ) : (
                <video
                  className="w-full h-full"
                  controls
                  src={video?.videoId ? `/api/videos/${video.videoId}/stream` : ''}
                />
              )}
            </div>

            {/* Video Info */}
            <div className="mt-4">
              <h1 className="text-2xl font-bold">{video?.title}</h1>
              <p className="text-muted-foreground mt-2">{video?.description}</p>
            </div>
          </div>

          {/* Session Info */}
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Session Info</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {session ? (
                  <>
                    <div className="flex justify-between">
                      <span>Balance:</span>
                      <span className="font-bold">
                        {formatApt(session.balance)} APT
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Price/segment:</span>
                      <span>{formatApt(BigInt(video?.pricePerSegment || 0))} APT</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Segments paid:</span>
                      <span>{payments.length}</span>
                    </div>
                    <Button
                      variant="destructive"
                      className="w-full"
                      onClick={endSession}
                    >
                      End Session
                    </Button>
                  </>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    Start a session to begin watching. You'll prepay for 20
                    segments and can top up as needed.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Payment Feed */}
            {session && (
              <Card>
                <CardHeader>
                  <CardTitle>Payment Feed</CardTitle>
                </CardHeader>
                <CardContent>
                  {payments.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      Payments will appear here as you watch
                    </p>
                  ) : (
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {payments.map((p, i) => (
                        <div
                          key={i}
                          className="flex justify-between text-sm border-b pb-2"
                        >
                          <span>Segment {p.segment}</span>
                          <span>{formatApt(p.amount)} APT</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
