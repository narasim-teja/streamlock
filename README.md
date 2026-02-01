# streamlock

**Every second counts. Only pay for what you watch.**

Trustless pay-per-view video streaming on Aptos. Viewers pay per segment watched. Creators get paid instantly. No subscriptions, no middlemen.

## Architecture

![streamlock Architecture](assets/architecture.png)

## How It Works

1. **Upload** — Creator uploads video → encrypted into 5-second segments → Merkle tree commitment stored on-chain
2. **Watch** — Viewer selects segments to prepay → funds escrowed on-chain → playback begins
3. **Pay** — Each segment payment releases decryption key with cryptographic proof
4. **Verify** — Merkle proofs ensure correct keys → unused balance refunded when done

## Tech Stack

- **Blockchain**: Aptos (Move smart contracts, USDC payments)
- **Video**: HLS.js + FFmpeg (AES-128-CBC encryption per segment)
- **Crypto**: Merkle trees for key commitments, HKDF for key derivation
- **Web**: Next.js 15, Tailwind CSS, shadcn/ui
- **Runtime**: Bun + Turborepo monorepo

## Project Structure

```
streamlock/
├── contracts/           # Move smart contract
├── packages/
│   ├── common/          # Shared types, constants, utilities
│   ├── crypto/          # AES encryption, HKDF, Merkle trees
│   ├── aptos/           # Blockchain client & contract SDK
│   ├── creator-sdk/     # Video processing & HLS packaging
│   └── viewer-sdk/      # x402 payment flow & HLS playback
└── apps/
    └── web/             # Next.js application
```

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) v1.1+
- [Aptos CLI](https://aptos.dev/cli-tools/aptos-cli-tool/install-aptos-cli)
- Petra wallet

### Setup

```bash
# Install dependencies
bun install

# Copy environment file
cp apps/web/.env.example apps/web/.env.local

# Push database schema
bun run db:push

# Start development
bun run dev
```

### Environment Variables

```env
# Aptos
NEXT_PUBLIC_APTOS_NETWORK=testnet
NEXT_PUBLIC_CONTRACT_ADDRESS=0x...

# USDC (Testnet)
NEXT_PUBLIC_USDC_METADATA_ADDRESS=0x69091fbab5f7d635ee7ac5098cf0c1efbe31d68fec0f2cd565e8d168daf52832

# Storage (Supabase)
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_KEY=xxx

# Database
DATABASE_URL=file:./local.db
```

### Deploy Contract

```bash
cd contracts
aptos move publish --named-addresses streamlock=default
```

## Key Features

- **Session Keys** — Popup-free payments using ephemeral accounts
- **x402 Protocol** — HTTP 402 payment flow for segment key access
- **USDC Payments** — Stable pricing using Circle's USDC on Aptos
- **Merkle Proofs** — Cryptographic verification of decryption keys
- **Instant Settlement** — Creators withdraw earnings anytime

## Packages

| Package | Description |
|---------|-------------|
| `@streamlock/common` | Types, constants, formatting utilities |
| `@streamlock/crypto` | AES-128-CBC, HKDF key derivation, Merkle trees |
| `@streamlock/aptos` | Contract client, USDC helpers, event parsing |
| `@streamlock/creator-sdk` | FFmpeg segmentation, encryption, HLS packaging |
| `@streamlock/viewer-sdk` | x402 key loader, session key manager, React hooks |

## Smart Contract

The Move contract (`contracts/sources/streamlock.move`) handles:

- Creator/video registration with Merkle root commitment
- Viewing sessions with USDC escrow
- Per-segment payment verification
- Creator earnings withdrawal
- Protocol fee collection

**Deployed Contract (Testnet):**

```text
0x262f56571e44d2b5564cbffca16ded7067ad5b1205a8c3adf46296776294cb2f
```

[View on Aptos Explorer](https://explorer.aptoslabs.com/account/0x262f56571e44d2b5564cbffca16ded7067ad5b1205a8c3adf46296776294cb2f?network=testnet)
