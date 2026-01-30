'use client';

import { useState } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import Link from 'next/link';
import { ConnectButton } from '@/components/wallet/ConnectButton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export default function UploadPage() {
  const { connected } = useWallet();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('0.001');
  const [uploading, setUploading] = useState(false);
  const [stage, setStage] = useState<string>('');
  const [progress, setProgress] = useState(0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    setUploading(true);
    setStage('Preparing upload...');
    setProgress(10);

    try {
      const formData = new FormData();
      formData.append('video', file);
      formData.append('title', title);
      formData.append('description', description);
      formData.append('pricePerSegment', price);

      setStage('Uploading video...');
      setProgress(30);

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      setStage('Processing complete!');
      setProgress(100);

      const result = await response.json();
      console.log('Upload result:', result);

      // Redirect to video page
      // router.push(`/watch/${result.videoId}`);
    } catch (error) {
      console.error('Upload error:', error);
      setStage('Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <main className="min-h-screen">
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
            <h2 className="text-2xl font-bold mb-4">Connect Your Wallet</h2>
            <p className="text-muted-foreground mb-6">
              Connect your Aptos wallet to upload videos
            </p>
            <ConnectButton />
          </div>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Upload Video</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Video File */}
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Video File
                  </label>
                  <input
                    type="file"
                    accept="video/*"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    className="block w-full text-sm border rounded-lg p-2"
                    required
                    disabled={uploading}
                  />
                </div>

                {/* Title */}
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Title
                  </label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="block w-full border rounded-lg p-2"
                    required
                    disabled={uploading}
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Description
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="block w-full border rounded-lg p-2"
                    rows={3}
                    disabled={uploading}
                  />
                </div>

                {/* Price */}
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Price per segment (APT)
                  </label>
                  <input
                    type="number"
                    step="0.0001"
                    min="0.0001"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    className="block w-full border rounded-lg p-2"
                    required
                    disabled={uploading}
                  />
                  <p className="text-sm text-muted-foreground mt-1">
                    Each segment is ~5 seconds
                  </p>
                </div>

                {/* Progress */}
                {uploading && (
                  <div>
                    <p className="text-sm mb-2">{stage}</p>
                    <div className="w-full bg-secondary rounded-full h-2">
                      <div
                        className="bg-primary h-2 rounded-full transition-all"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Submit */}
                <Button type="submit" disabled={uploading || !file}>
                  {uploading ? 'Uploading...' : 'Upload Video'}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
