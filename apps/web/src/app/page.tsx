'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ConnectButton } from '@/components/wallet/ConnectButton';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { truncateAddress } from '@streamlock/common';
import { formatUsdc } from '@streamlock/aptos';
import { Play, Video, Upload } from 'lucide-react';

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

export default function Home() {
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
            streamlock
          </Link>
          <nav className="flex items-center gap-4">
            <Link href="/creator" className="text-muted-foreground hover:text-foreground">
              Studio
            </Link>
            <ConnectButton />
          </nav>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        {/* Page Header */}
        <div className="flex justify-between items-center mb-8">
          <p className="text-muted-foreground">
            Every second counts. Only pay for what you watch.
          </p>
          <Link href="/creator/upload">
            <Button>
              <Upload className="h-4 w-4 mr-2" />
              Upload
            </Button>
          </Link>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Card key={i} className="overflow-hidden border-0 shadow-sm">
                <Skeleton className="aspect-video w-full" />
                <div className="p-4">
                  <Skeleton className="h-5 w-3/4 mb-2" />
                  <Skeleton className="h-4 w-full mb-4" />
                  <div className="flex justify-between pt-3 border-t border-border/50">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-16" />
                  </div>
                </div>
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
            <h2 className="text-2xl font-semibold mb-2">No videos yet</h2>
            <p className="text-muted-foreground mb-6">
              Be the first to upload content and start earning.
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
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {videos.map((video) => (
              <Link href={`/watch/${video.videoId}`} key={video.videoId}>
                <Card className="overflow-hidden hover:shadow-lg transition-all cursor-pointer group border-0 shadow-sm bg-card">
                  {/* Thumbnail */}
                  <div className="relative aspect-video bg-muted">
                    {video.thumbnailUri ? (
                      <img
                        src={video.thumbnailUri}
                        alt={video.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-zinc-100 to-zinc-50 dark:from-zinc-800 dark:to-zinc-900">
                        <Play className="h-12 w-12 text-zinc-300 dark:text-zinc-600" />
                      </div>
                    )}

                    {/* Play overlay on hover */}
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <div className="p-4 bg-white rounded-full shadow-lg">
                        <Play className="h-6 w-6 text-black" fill="currentColor" />
                      </div>
                    </div>

                    {/* Duration badge */}
                    <div className="absolute bottom-2 right-2 px-2 py-1 bg-black/80 text-white text-xs font-medium rounded">
                      {formatDuration(video.durationSeconds)}
                    </div>
                  </div>

                  {/* Content */}
                  <div className="p-4">
                    <h3 className="font-semibold text-base line-clamp-1 group-hover:text-primary transition-colors">
                      {video.title}
                    </h3>
                    <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                      {video.description || 'No description'}
                    </p>

                    {/* Footer row */}
                    <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/50">
                      <span className="text-sm text-muted-foreground">
                        {video.creatorAddress
                          ? truncateAddress(video.creatorAddress, 4)
                          : 'Unknown'}
                      </span>
                      <span className="text-sm font-medium text-primary">
                        {formatUsdc(BigInt(video.pricePerSegment))} USDC
                      </span>
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
