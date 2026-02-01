import Link from 'next/link';
import { ConnectButton } from '@/components/wallet/ConnectButton';

export default function Home() {
  return (
    <main className="min-h-screen">
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

      {/* Hero Section */}
      <section className="container mx-auto px-4 py-20 text-center">
        <h2 className="text-5xl font-bold mb-6">
          Pay-Per-Second Video Streaming
        </h2>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
          Trustless video streaming on Aptos blockchain. Viewers pay only for
          what they watch. Creators get paid instantly. Cryptographic proofs
          ensure fairness.
        </p>
        <div className="flex gap-4 justify-center">
          <Link
            href="/creator"
            className="bg-primary text-primary-foreground px-6 py-3 rounded-lg font-medium hover:opacity-90 transition"
          >
            Start Creating
          </Link>
          <Link
            href="/browse"
            className="bg-secondary text-secondary-foreground px-6 py-3 rounded-lg font-medium hover:opacity-90 transition"
          >
            Browse Videos
          </Link>
        </div>
      </section>

      {/* How It Works */}
      <section className="bg-muted py-20">
        <div className="container mx-auto px-4">
          <h3 className="text-3xl font-bold text-center mb-12">How It Works</h3>
          <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            <div className="bg-card p-6 rounded-lg">
              <div className="text-4xl mb-4">1</div>
              <h4 className="text-xl font-semibold mb-2">Upload & Encrypt</h4>
              <p className="text-muted-foreground">
                Creators upload videos. Each segment is encrypted with a unique
                key. A Merkle tree commits to all keys on-chain.
              </p>
            </div>
            <div className="bg-card p-6 rounded-lg">
              <div className="text-4xl mb-4">2</div>
              <h4 className="text-xl font-semibold mb-2">Prepay & Watch</h4>
              <p className="text-muted-foreground">
                Viewers deposit USDC to start watching. Each 5-second segment
                payment releases the decryption key with proof.
              </p>
            </div>
            <div className="bg-card p-6 rounded-lg">
              <div className="text-4xl mb-4">3</div>
              <h4 className="text-xl font-semibold mb-2">Verify & Refund</h4>
              <p className="text-muted-foreground">
                Merkle proofs verify keys are correct. Unused prepayment is
                refunded when you stop watching.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20">
        <div className="container mx-auto px-4">
          <h3 className="text-3xl font-bold text-center mb-12">
            Key Features
          </h3>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
            <div className="p-6 border rounded-lg">
              <h4 className="font-semibold mb-2">Trustless</h4>
              <p className="text-sm text-muted-foreground">
                Cryptographic proofs ensure viewers get correct keys
              </p>
            </div>
            <div className="p-6 border rounded-lg">
              <h4 className="font-semibold mb-2">Fair Pricing</h4>
              <p className="text-sm text-muted-foreground">
                Pay only for what you watch, per-second granularity
              </p>
            </div>
            <div className="p-6 border rounded-lg">
              <h4 className="font-semibold mb-2">Instant Payments</h4>
              <p className="text-sm text-muted-foreground">
                Creators receive payments in real-time on Aptos
              </p>
            </div>
            <div className="p-6 border rounded-lg">
              <h4 className="font-semibold mb-2">x402 Standard</h4>
              <p className="text-sm text-muted-foreground">
                HTTP 402 native payment flow for seamless UX
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8">
        <div className="container mx-auto px-4 text-center text-muted-foreground">
          <p>Built for the Aptos Hackathon</p>
        </div>
      </footer>
    </main>
  );
}
