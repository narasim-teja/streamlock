'use client';

import { useWallet } from '@aptos-labs/wallet-adapter-react';
import Link from 'next/link';
import { ConnectButton } from '@/components/wallet/ConnectButton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export default function CreatorDashboard() {
  const { connected, account } = useWallet();

  return (
    <main className="min-h-screen">
      {/* Header */}
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <Link href="/" className="text-2xl font-bold text-primary">
            StreamLock
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
            <h2 className="text-2xl font-bold mb-4">Connect Your Wallet</h2>
            <p className="text-muted-foreground mb-6">
              Connect your Aptos wallet to access the creator dashboard
            </p>
            <ConnectButton />
          </div>
        ) : (
          <>
            <div className="flex justify-between items-center mb-8">
              <h1 className="text-3xl font-bold">Creator Dashboard</h1>
              <Link href="/creator/upload">
                <Button>Upload Video</Button>
              </Link>
            </div>

            {/* Stats */}
            <div className="grid md:grid-cols-3 gap-6 mb-8">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Total Earnings</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold">0.00 APT</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Pending Withdrawal</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold">0.00 APT</p>
                  <Button variant="outline" size="sm" className="mt-2" disabled>
                    Withdraw
                  </Button>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Total Videos</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold">0</p>
                </CardContent>
              </Card>
            </div>

            {/* Videos */}
            <Card>
              <CardHeader>
                <CardTitle>Your Videos</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-center py-12 text-muted-foreground">
                  <p>No videos uploaded yet</p>
                  <Link href="/creator/upload">
                    <Button variant="outline" className="mt-4">
                      Upload Your First Video
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </main>
  );
}
