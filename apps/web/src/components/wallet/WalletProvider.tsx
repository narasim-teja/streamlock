'use client';

import { AptosWalletAdapterProvider } from '@aptos-labs/wallet-adapter-react';
import { Network } from '@aptos-labs/ts-sdk';
import { PropsWithChildren } from 'react';

export function WalletProvider({ children }: PropsWithChildren) {
  const network =
    (process.env.NEXT_PUBLIC_APTOS_NETWORK as Network) || Network.TESTNET;

  return (
    <AptosWalletAdapterProvider
      autoConnect={true}
      dappConfig={{
        network,
        mizuwallet: {
          manifestURL:
            'https://assets.mz.xyz/static/config/mizuwallet-connect-manifest.json',
        },
      }}
    >
      {children}
    </AptosWalletAdapterProvider>
  );
}
