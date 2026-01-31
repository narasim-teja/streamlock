'use client';

import { useState, useEffect, useCallback } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ConnectButton } from '@/components/wallet/ConnectButton';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Label } from '@/components/ui/Label';
import { Progress } from '@/components/ui/Progress';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { config } from '@/lib/config';
import {
  Upload,
  Video,
  Image,
  DollarSign,
  Wallet,
  CheckCircle,
  AlertCircle,
  Loader2,
  UserPlus,
} from 'lucide-react';

type UploadStage =
  | 'idle'
  | 'uploading'
  | 'processing'
  | 'storing'
  | 'registering'
  | 'complete'
  | 'error';

const STAGE_PROGRESS: Record<UploadStage, number> = {
  idle: 0,
  uploading: 20,
  processing: 50,
  storing: 70,
  registering: 90,
  complete: 100,
  error: 0,
};

const STAGE_LABELS: Record<UploadStage, string> = {
  idle: '',
  uploading: 'Uploading video...',
  processing: 'Processing and encrypting...',
  storing: 'Storing to cloud...',
  registering: 'Registering on-chain...',
  complete: 'Upload complete!',
  error: 'Upload failed',
};

export default function UploadPage() {
  const { connected, account, signAndSubmitTransaction } = useWallet();
  const router = useRouter();

  const [file, setFile] = useState<File | null>(null);
  const [thumbnail, setThumbnail] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('0.001');
  const [stage, setStage] = useState<UploadStage>('idle');
  const [error, setError] = useState<string | null>(null);
  const [uploadedVideoId, setUploadedVideoId] = useState<string | null>(null);
  const [isCreatorRegistered, setIsCreatorRegistered] = useState<boolean | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);

  // Check if creator is registered on-chain
  const checkCreatorRegistration = useCallback(async () => {
    if (!account?.address || !config.contractAddress) return;

    try {
      const response = await fetch(
        `https://fullnode.testnet.aptoslabs.com/v1/view`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            function: `${config.contractAddress}::protocol::get_creator`,
            type_arguments: [],
            arguments: [account.address],
          }),
        }
      );

      if (response.ok) {
        setIsCreatorRegistered(true);
      } else {
        setIsCreatorRegistered(false);
      }
    } catch {
      // If the view function fails, creator is not registered
      setIsCreatorRegistered(false);
    }
  }, [account?.address]);

  useEffect(() => {
    if (connected && account?.address) {
      checkCreatorRegistration();
    }
  }, [connected, account?.address, checkCreatorRegistration]);

  // Register as creator
  const handleRegisterCreator = async () => {
    if (!signAndSubmitTransaction || !account?.address) return;

    setIsRegistering(true);
    setError(null);

    try {
      await signAndSubmitTransaction({
        data: {
          function: `${config.contractAddress}::protocol::register_creator` as `${string}::${string}::${string}`,
          functionArguments: [''], // Empty metadata URI
        },
      });

      // Wait a bit for the transaction to be indexed
      await new Promise((resolve) => setTimeout(resolve, 2000));
      setIsCreatorRegistered(true);
    } catch (err) {
      console.error('Failed to register creator:', err);
      setError('Failed to register as creator. Please try again.');
    } finally {
      setIsRegistering(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !connected || !account?.address) return;

    setStage('uploading');
    setError(null);

    try {
      // Prepare form data
      const formData = new FormData();
      formData.append('video', file);
      formData.append('title', title);
      formData.append('description', description);
      formData.append('pricePerSegment', price);
      formData.append('creatorAddress', account.address);
      if (thumbnail) {
        formData.append('thumbnail', thumbnail);
      }

      setStage('processing');

      // Upload to server
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Upload failed');
      }

      const result = await response.json();
      setUploadedVideoId(result.data.videoId);

      setStage('storing');

      // If on-chain registration is required, sign the transaction
      if (result.requiresSignature && signAndSubmitTransaction) {
        setStage('registering');

        try {
          const txResult = await signAndSubmitTransaction({
            data: result.payload,
          });

          // Wait for transaction to be indexed and get the video ID from events
          if (txResult?.hash) {
            // Wait a bit for indexing
            await new Promise((resolve) => setTimeout(resolve, 3000));

            // Fetch transaction to get events
            try {
              const txResponse = await fetch(
                `https://fullnode.testnet.aptoslabs.com/v1/transactions/by_hash/${txResult.hash}`
              );
              const txData = await txResponse.json();

              // Find VideoRegisteredEvent to get the on-chain video ID
              const videoEvent = txData.events?.find(
                (e: { type: string }) => e.type.includes('VideoRegisteredEvent')
              );

              if (videoEvent?.data?.video_id) {
                // Update our database with the on-chain video ID
                await fetch(`/api/videos/${result.data.videoId}/register`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    onChainVideoId: videoEvent.data.video_id,
                    txHash: txResult.hash,
                  }),
                });
              }
            } catch (eventError) {
              console.warn('Could not fetch transaction events:', eventError);
            }
          }
        } catch (txError) {
          // Transaction was rejected or failed
          // Video is still stored locally, just not on-chain
          console.warn('On-chain registration skipped:', txError);
        }
      }

      setStage('complete');

      // Redirect to video page after a short delay
      setTimeout(() => {
        router.push(`/watch/${result.data.videoId}`);
      }, 2000);
    } catch (err) {
      console.error('Upload error:', err);
      setError(err instanceof Error ? err.message : 'Upload failed');
      setStage('error');
    }
  };

  const isUploading = stage !== 'idle' && stage !== 'complete' && stage !== 'error';

  return (
    <main className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <Link href="/" className="text-2xl font-bold text-primary">
            StreamLock
          </Link>
          <nav className="flex items-center gap-4">
            <Link
              href="/creator"
              className="text-muted-foreground hover:text-foreground"
            >
              Dashboard
            </Link>
            <Link href="/creator/upload" className="font-medium">
              Upload
            </Link>
            <ConnectButton />
          </nav>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 max-w-2xl">
        {!connected ? (
          <div className="text-center py-20">
            <Wallet className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
            <h2 className="text-2xl font-bold mb-4">Connect Your Wallet</h2>
            <p className="text-muted-foreground mb-6">
              Connect your Aptos wallet to upload videos
            </p>
            <ConnectButton />
          </div>
        ) : isCreatorRegistered === null ? (
          <div className="text-center py-20">
            <Loader2 className="h-8 w-8 mx-auto mb-4 animate-spin text-muted-foreground" />
            <p className="text-muted-foreground">Checking creator registration...</p>
          </div>
        ) : isCreatorRegistered === false ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserPlus className="h-5 w-5" />
                Register as Creator
              </CardTitle>
              <CardDescription>
                You need to register as a creator on-chain before uploading videos.
                This is a one-time setup.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <Button
                onClick={handleRegisterCreator}
                disabled={isRegistering}
                className="w-full"
              >
                {isRegistering ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Registering...
                  </>
                ) : (
                  <>
                    <UserPlus className="h-4 w-4 mr-2" />
                    Register as Creator
                  </>
                )}
              </Button>
              <p className="text-sm text-muted-foreground text-center">
                This will create your creator profile on the Aptos blockchain.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5" />
                Upload Video
              </CardTitle>
              <CardDescription>
                Upload your video to start monetizing. Each segment (~5 seconds) will
                be encrypted and viewers pay per segment watched.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Video File */}
                <div className="space-y-2">
                  <Label htmlFor="video" className="flex items-center gap-2">
                    <Video className="h-4 w-4" />
                    Video File
                  </Label>
                  <Input
                    id="video"
                    type="file"
                    accept="video/*"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    disabled={isUploading}
                    required
                  />
                  {file && (
                    <p className="text-sm text-muted-foreground">
                      Selected: {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
                    </p>
                  )}
                </div>

                {/* Thumbnail */}
                <div className="space-y-2">
                  <Label htmlFor="thumbnail" className="flex items-center gap-2">
                    <Image className="h-4 w-4" />
                    Thumbnail (optional)
                  </Label>
                  <Input
                    id="thumbnail"
                    type="file"
                    accept="image/*"
                    onChange={(e) => setThumbnail(e.target.files?.[0] || null)}
                    disabled={isUploading}
                  />
                </div>

                {/* Title */}
                <div className="space-y-2">
                  <Label htmlFor="title">Title</Label>
                  <Input
                    id="title"
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Enter video title"
                    disabled={isUploading}
                    required
                  />
                </div>

                {/* Description */}
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Describe your video..."
                    rows={3}
                    disabled={isUploading}
                  />
                </div>

                {/* Price */}
                <div className="space-y-2">
                  <Label htmlFor="price" className="flex items-center gap-2">
                    <DollarSign className="h-4 w-4" />
                    Price per Segment (APT)
                  </Label>
                  <Input
                    id="price"
                    type="number"
                    step="0.0001"
                    min="0.0001"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    disabled={isUploading}
                    required
                  />
                  <p className="text-sm text-muted-foreground">
                    Each segment is ~5 seconds. Minimum price: 0.0001 APT
                  </p>
                </div>

                {/* Progress */}
                {stage !== 'idle' && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      {stage === 'complete' ? (
                        <CheckCircle className="h-5 w-5 text-green-500" />
                      ) : stage === 'error' ? (
                        <AlertCircle className="h-5 w-5 text-destructive" />
                      ) : (
                        <Loader2 className="h-5 w-5 animate-spin text-primary" />
                      )}
                      <span className="text-sm font-medium">
                        {STAGE_LABELS[stage]}
                      </span>
                    </div>
                    <Progress value={STAGE_PROGRESS[stage]} className="h-2" />
                  </div>
                )}

                {/* Error */}
                {error && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                {/* Success */}
                {stage === 'complete' && uploadedVideoId && (
                  <Alert>
                    <CheckCircle className="h-4 w-4" />
                    <AlertDescription>
                      Video uploaded successfully! Redirecting to video page...
                    </AlertDescription>
                  </Alert>
                )}

                {/* Submit */}
                <div className="flex gap-3">
                  <Button
                    type="submit"
                    disabled={isUploading || !file || stage === 'complete'}
                    className="flex-1"
                  >
                    {isUploading ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Uploading...
                      </>
                    ) : (
                      <>
                        <Upload className="h-4 w-4 mr-2" />
                        Upload Video
                      </>
                    )}
                  </Button>

                  {stage === 'error' && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setStage('idle');
                        setError(null);
                      }}
                    >
                      Try Again
                    </Button>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
