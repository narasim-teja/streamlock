'use client';

import { AptosWalletAdapterProvider } from '@aptos-labs/wallet-adapter-react';
import { Network } from '@aptos-labs/ts-sdk';
import { PetraWallet } from 'petra-plugin-wallet-adapter';
import { PropsWithChildren, useMemo } from 'react';

export function WalletProvider({ children }: PropsWithChildren) {
  const network =
    (process.env.NEXT_PUBLIC_APTOS_NETWORK as Network) || Network.TESTNET;

  // Initialize wallet plugins
  const wallets = useMemo(() => [new PetraWallet()], []);

  return (
    <AptosWalletAdapterProvider
      plugins={wallets}
      autoConnect={true}
      dappConfig={{
        network,
      }}
      onError={(error) => {
        console.error('Wallet error:', error);
      }}
    >
      {children}
    </AptosWalletAdapterProvider>
  );
}
