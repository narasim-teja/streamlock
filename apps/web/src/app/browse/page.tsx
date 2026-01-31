'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ConnectButton } from '@/components/wallet/ConnectButton';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/Avatar';
import { formatApt, truncateAddress } from '@streamlock/common';
import {
  Play,
  Clock,
  DollarSign,
  Video,
  Upload,
  Search,
} from 'lucide-react';

interface VideoData {
  videoId: string;
  onChainVideoId: string | null;
  title: string;
  description: string | null;
  thumbnailUri: string | null;
  durationSeconds: number;
  totalSegments: number;
  pricePerSegment: string;
  creatorAddress: string | null;
  isActive: boolean;
  createdAt: string | null;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export default function BrowsePage() {
  const [videos, setVideos] = useState<VideoData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchVideos() {
      try {
        const res = await fetch('/api/videos');
        if (!res.ok) throw new Error('Failed to fetch videos');
        const data = await res.json();
        setVideos(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load videos');
      } finally {
        setLoading(false);
      }
    }

    fetchVideos();
  }, []);

  return (
    <main className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <Link href="/" className="text-2xl font-bold text-primary">
            StreamLock
          </Link>
          <nav className="flex items-center gap-4">
            <Link href="/browse" className="font-medium">
              Browse
            </Link>
            <Link
              href="/creator"
              className="text-muted-foreground hover:text-foreground"
            >
              Creator Dashboard
            </Link>
            <ConnectButton />
          </nav>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        {/* Page Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold">Browse Videos</h1>
            <p className="text-muted-foreground mt-1">
              Discover pay-per-view content from creators
            </p>
          </div>
          <Link href="/creator/upload">
            <Button>
              <Upload className="h-4 w-4 mr-2" />
              Upload Video
            </Button>
          </Link>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <Card key={i} className="overflow-hidden">
                <Skeleton className="aspect-video w-full" />
                <CardHeader className="pb-2">
                  <Skeleton className="h-5 w-3/4" />
                </CardHeader>
                <CardContent className="pb-2">
                  <Skeleton className="h-4 w-full" />
                </CardContent>
                <CardFooter>
                  <Skeleton className="h-4 w-1/2" />
                </CardFooter>
              </Card>
            ))}
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="text-center py-20">
            <div className="text-destructive mb-4">{error}</div>
            <Button variant="outline" onClick={() => window.location.reload()}>
              Try Again
            </Button>
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && videos.length === 0 && (
          <div className="text-center py-20">
            <Video className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-50" />
            <h2 className="text-2xl font-semibold mb-2">No videos available</h2>
            <p className="text-muted-foreground mb-6">
              Be the first to upload content and start monetizing!
            </p>
            <Link href="/creator/upload">
              <Button>
                <Upload className="h-4 w-4 mr-2" />
                Upload Your First Video
              </Button>
            </Link>
          </div>
        )}

        {/* Video Grid */}
        {!loading && !error && videos.length > 0 && (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {videos.map((video) => (
              <Link href={`/watch/${video.videoId}`} key={video.videoId}>
                <Card className="overflow-hidden hover:shadow-lg transition-all cursor-pointer group">
                  {/* Thumbnail */}
                  <div className="relative aspect-video bg-muted">
                    {video.thumbnailUri ? (
                      <img
                        src={video.thumbnailUri}
                        alt={video.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-primary/5">
                        <Play className="h-12 w-12 text-muted-foreground opacity-50" />
                      </div>
                    )}

                    {/* Play overlay on hover */}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <div className="p-3 bg-primary rounded-full">
                        <Play className="h-6 w-6 text-primary-foreground" fill="currentColor" />
                      </div>
                    </div>

                    {/* Duration badge */}
                    <Badge
                      variant="secondary"
                      className="absolute bottom-2 right-2 bg-black/75 text-white border-0"
                    >
                      {formatDuration(video.durationSeconds)}
                    </Badge>

                    {/* On-chain badge */}
                    {video.onChainVideoId && (
                      <Badge
                        variant="default"
                        className="absolute top-2 left-2 text-xs"
                      >
                        On-chain
                      </Badge>
                    )}
                  </div>

                  <CardHeader className="pb-2">
                    <CardTitle className="text-base line-clamp-2 group-hover:text-primary transition-colors">
                      {video.title}
                    </CardTitle>
                  </CardHeader>

                  <CardContent className="pb-2">
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {video.description || 'No description'}
                    </p>
                  </CardContent>

                  <CardFooter className="flex justify-between items-center pt-2">
                    {/* Creator */}
                    <div className="flex items-center gap-2">
                      <Avatar className="h-6 w-6">
                        <AvatarFallback className="text-xs">
                          {video.creatorAddress
                            ? video.creatorAddress.slice(2, 4).toUpperCase()
                            : '??'}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-xs text-muted-foreground">
                        {video.creatorAddress
                          ? truncateAddress(video.creatorAddress)
                          : 'Unknown'}
                      </span>
                    </div>

                    {/* Price */}
                    <Badge variant="outline" className="flex items-center gap-1">
                      <DollarSign className="h-3 w-3" />
                      {formatApt(BigInt(video.pricePerSegment))}/seg
                    </Badge>
                  </CardFooter>
                </Card>
              </Link>
            ))}
          </div>
        )}

        {/* Stats Banner */}
        {!loading && !error && videos.length > 0 && (
          <div className="mt-12 p-6 bg-muted/50 rounded-lg">
            <div className="grid md:grid-cols-3 gap-6 text-center">
              <div>
                <div className="text-3xl font-bold text-primary">{videos.length}</div>
                <div className="text-sm text-muted-foreground">Videos Available</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-primary">
                  {new Set(videos.map((v) => v.creatorAddress).filter(Boolean)).size}
                </div>
                <div className="text-sm text-muted-foreground">Active Creators</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-primary">
                  {formatDuration(
                    videos.reduce((acc, v) => acc + v.durationSeconds, 0)
                  )}
                </div>
                <div className="text-sm text-muted-foreground">Total Content</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
