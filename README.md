# StreamLock

Trustless pay-per-second video streaming protocol on Aptos blockchain using the x402 payment standard.

## Overview

StreamLock enables creators to monetize video content with per-second granularity. Videos are encrypted segment-by-segment, with decryption keys released only after on-chain payment verification. Cryptographic commitments (Merkle trees) ensure viewers can verify they received correct keys without trusting the server.

## Architecture

```
streamlock/
├── contracts/           # Move smart contracts (Aptos)
├── packages/
│   ├── common/          # Shared types, constants, utilities
│   ├── crypto/          # AES encryption, HKDF, Merkle trees
│   ├── aptos/           # Blockchain client & contract interactions
│   ├── creator-sdk/     # Video processing & key server
│   └── viewer-sdk/      # Playback with integrated payments
└── apps/
    └── web/             # Next.js demo application
```

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) v1.1+
- [Aptos CLI](https://aptos.dev/cli-tools/aptos-cli-tool/install-aptos-cli) (for contract deployment)
- FFmpeg (for video processing)
- Petra or Martian wallet

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd stream-lock

# Install dependencies
bun install

# Copy environment file
cp apps/web/.env.local.example apps/web/.env.local
# Edit .env.local with your values
```

### Deploy Contract (Testnet)

```bash
# Set your deployer private key
export APTOS_PRIVATE_KEY=your-private-key

# Deploy to testnet
bun run deploy:contract --network=testnet

# Copy the contract address to .env.local
```

### Run Development Server

```bash
# Push database schema
bun run db:push

# Start development
bun run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the app.

## How It Works

1. **Creator uploads video** → SDK encrypts segments → Generates Merkle tree → Registers on-chain with commitment root
2. **Viewer starts session** → Deposits prepaid APT to escrow → Receives session ID
3. **Viewer requests key** → Server returns 402 → Viewer pays on-chain → Server verifies → Releases key + proof
4. **Viewer verifies proof** → Checks against on-chain commitment → Decrypts segment → Plays video
5. **Session ends** → Unused balance refunded → Creator earnings released

## Key Features

- **Trustless**: Merkle proofs ensure viewers get correct decryption keys
- **Fair Pricing**: Pay only for what you watch (5-second segments)
- **Instant Payments**: Creators receive payments in real-time on Aptos
- **x402 Standard**: HTTP 402 native payment flow for seamless UX

## Tech Stack

- **Blockchain**: Aptos (Move smart contracts)
- **Runtime**: Bun
- **Build**: Turborepo
- **Web**: Next.js 14, Tailwind CSS
- **Database**: SQLite with Drizzle ORM
- **Crypto**: @noble/hashes (HKDF, SHA-256)
- **Video**: HLS.js, FFmpeg

## Project Structure

### Packages

| Package | Description |
|---------|-------------|
| `@streamlock/common` | Shared types, constants, error classes |
| `@streamlock/crypto` | AES-128-CBC encryption, HKDF key derivation, Merkle trees |
| `@streamlock/aptos` | Aptos client wrapper, contract interaction methods |
| `@streamlock/creator-sdk` | Video segmentation, encryption, HLS packaging |
| `@streamlock/viewer-sdk` | x402 key loader, payment client, React components |

### Smart Contract

The Move contract handles:
- Creator registration
- Video registration with Merkle commitment
- Viewing sessions with escrow
- Per-segment payments
- Earnings withdrawal

## License

MIT
