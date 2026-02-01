'use client';

import { useEffect, useState, useCallback } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import Link from 'next/link';
import { ConnectButton } from '@/components/wallet/ConnectButton';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatUsdc } from '@streamlock/aptos';
import {
  Play,
  Upload,
  Wallet,
  Video,
  TrendingUp,
  Clock,
  MoreVertical,
  Eye,
  DollarSign,
} from 'lucide-react';

interface CreatorEarnings {
  isRegistered: boolean;
  totalEarnings: string;
  pendingWithdrawal: string;
  totalVideos: number;
}

interface VideoData {
  videoId: string;
  onChainVideoId: string | null;
  title: string;
  description: string | null;
  thumbnailUri: string | null;
  durationSeconds: number;
  totalSegments: number;
  pricePerSegment: string;
  isActive: boolean;
  createdAt: string | null;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export default function CreatorDashboard() {
  const { connected, account, signAndSubmitTransaction } = useWallet();
  const [earnings, setEarnings] = useState<CreatorEarnings | null>(null);
  const [videos, setVideos] = useState<VideoData[]>([]);
  const [loading, setLoading] = useState(true);
  const [withdrawing, setWithdrawing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!account?.address) return;

    setLoading(true);
    setError(null);

    try {
      // Fetch earnings and videos in parallel
      const [earningsRes, videosRes] = await Promise.all([
        fetch(`/api/creator/earnings?address=${account.address}`),
        fetch(`/api/creator/videos?address=${account.address}`),
      ]);

      if (!earningsRes.ok || !videosRes.ok) {
        throw new Error('Failed to fetch data');
      }

      const [earningsData, videosData] = await Promise.all([
        earningsRes.json(),
        videosRes.json(),
      ]);

      setEarnings(earningsData);
      setVideos(videosData);
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err);
      setError('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }, [account?.address]);

  useEffect(() => {
    if (connected && account?.address) {
      fetchData();
    }
  }, [connected, account?.address, fetchData]);

  const handleWithdraw = async () => {
    if (!signAndSubmitTransaction || !earnings?.pendingWithdrawal) return;

    const pendingAmount = BigInt(earnings.pendingWithdrawal);
    if (pendingAmount <= 0n) return;

    setWithdrawing(true);
    try {
      // Get the withdraw payload
      const res = await fetch('/api/creator/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: account?.address }),
      });

      if (!res.ok) {
        throw new Error('Failed to get withdraw payload');
      }

      const { payload } = await res.json();

      // Sign and submit the transaction
      await signAndSubmitTransaction({
        data: payload,
      });

      // Refresh data after successful withdrawal
      await fetchData();
    } catch (err) {
      console.error('Withdraw failed:', err);
      setError('Withdrawal failed. Please try again.');
    } finally {
      setWithdrawing(false);
    }
  };

  return (
    <main className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <Link href="/" className="text-2xl font-bold text-primary">
            streamlock
          </Link>
          <nav className="flex items-center gap-4">
            <Link href="/creator" className="font-medium">
              Dashboard
            </Link>
            <Link
              href="/creator/upload"
              className="text-muted-foreground hover:text-foreground"
            >
              Upload
            </Link>
            <ConnectButton />
          </nav>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        {!connected ? (
          <div className="text-center py-20">
            <Wallet className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
            <h2 className="text-2xl font-bold mb-4">Connect Your Wallet</h2>
            <p className="text-muted-foreground mb-6">
              Connect your Aptos wallet to access the creator dashboard
            </p>
            <ConnectButton />
          </div>
        ) : (
          <>
            <div className="flex justify-between items-center mb-8">
              <div>
                <h1 className="text-3xl font-bold">Creator Dashboard</h1>
                <p className="text-muted-foreground mt-1">
                  Manage your videos and earnings
                </p>
              </div>
              <Link href="/creator/upload">
                <Button>
                  <Upload className="h-4 w-4 mr-2" />
                  Upload Video
                </Button>
              </Link>
            </div>

            {error && (
              <div className="mb-6 p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive">
                {error}
              </div>
            )}

            {/* Stats */}
            <div className="grid md:grid-cols-3 gap-6 mb-8">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Total Earnings
                  </CardTitle>
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <Skeleton className="h-9 w-24" />
                  ) : (
                    <p className="text-3xl font-bold">
                      {formatUsdc(BigInt(earnings?.totalEarnings || '0'))} USDC
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Pending Withdrawal
                  </CardTitle>
                  <Wallet className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <Skeleton className="h-9 w-24" />
                  ) : (
                    <>
                      <p className="text-3xl font-bold">
                        {formatUsdc(BigInt(earnings?.pendingWithdrawal || '0'))} USDC
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3"
                        disabled={
                          withdrawing ||
                          !earnings?.pendingWithdrawal ||
                          BigInt(earnings?.pendingWithdrawal || '0') <= 0n
                        }
                        onClick={handleWithdraw}
                      >
                        {withdrawing ? 'Withdrawing...' : 'Withdraw'}
                      </Button>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Total Videos
                  </CardTitle>
                  <Video className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <Skeleton className="h-9 w-12" />
                  ) : (
                    <p className="text-3xl font-bold">{videos.length}</p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Registration Status */}
            {!loading && earnings && !earnings.isRegistered && (
              <Card className="mb-8 border-amber-500/50 bg-amber-500/5">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-amber-500/20 rounded-full">
                      <Wallet className="h-6 w-6 text-amber-500" />
                    </div>
                    <div>
                      <h3 className="font-semibold">Register as Creator</h3>
                      <p className="text-sm text-muted-foreground">
                        You need to register on-chain before uploading videos.
                        This will be done automatically when you upload your first video.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Videos */}
            <Card>
              <CardHeader>
                <CardTitle>Your Videos</CardTitle>
                <CardDescription>
                  Manage and track your uploaded content
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="space-y-4">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="flex gap-4">
                        <Skeleton className="h-24 w-40 rounded-lg" />
                        <div className="flex-1 space-y-2">
                          <Skeleton className="h-5 w-48" />
                          <Skeleton className="h-4 w-32" />
                          <Skeleton className="h-4 w-24" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : videos.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Video className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No videos uploaded yet</p>
                    <Link href="/creator/upload">
                      <Button variant="outline" className="mt-4">
                        <Upload className="h-4 w-4 mr-2" />
                        Upload Your First Video
                      </Button>
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {videos.map((video) => (
                      <div
                        key={video.videoId}
                        className="flex gap-4 p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                      >
                        {/* Thumbnail */}
                        <div className="relative h-24 w-40 bg-muted rounded-lg overflow-hidden flex-shrink-0">
                          {video.thumbnailUri ? (
                            <img
                              src={video.thumbnailUri}
                              alt={video.title}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="h-full w-full flex items-center justify-center">
                              <Play className="h-8 w-8 text-muted-foreground" />
                            </div>
                          )}
                          <Badge
                            variant="secondary"
                            className="absolute bottom-1 right-1 text-xs"
                          >
                            {formatDuration(video.durationSeconds)}
                          </Badge>
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <h3 className="font-semibold truncate">
                                {video.title}
                              </h3>
                              <p className="text-sm text-muted-foreground line-clamp-1">
                                {video.description || 'No description'}
                              </p>
                            </div>
                            <Badge variant={video.isActive ? 'default' : 'secondary'}>
                              {video.isActive ? 'Active' : 'Inactive'}
                            </Badge>
                          </div>

                          <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <DollarSign className="h-3 w-3" />
                              {formatUsdc(BigInt(video.pricePerSegment))} USDC/seg
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {video.totalSegments} segments
                            </span>
                            {video.onChainVideoId && (
                              <Badge variant="outline" className="text-xs">
                                On-chain
                              </Badge>
                            )}
                          </div>

                          <div className="flex gap-2 mt-3">
                            <Link href={`/watch/${video.videoId}`}>
                              <Button variant="outline" size="sm">
                                <Eye className="h-3 w-3 mr-1" />
                                View
                              </Button>
                            </Link>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </main>
  );
}
