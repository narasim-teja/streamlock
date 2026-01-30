'use client';

import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { truncateAddress } from '@streamlock/common';

export function ConnectButton() {
  const { account, connected, connect, disconnect, wallets } = useWallet();

  if (connected && account) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">
          {truncateAddress(account.address)}
        </span>
        <button
          onClick={disconnect}
          className="bg-secondary text-secondary-foreground px-4 py-2 rounded-lg text-sm hover:opacity-90 transition"
        >
          Disconnect
        </button>
      </div>
    );
  }

  // Find Petra wallet
  const petraWallet = wallets?.find((w) => w.name === 'Petra');

  return (
    <button
      onClick={() => {
        if (petraWallet) {
          connect(petraWallet.name);
        } else if (wallets && wallets.length > 0) {
          connect(wallets[0].name);
        }
      }}
      className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm hover:opacity-90 transition"
    >
      Connect Wallet
    </button>
  );
}
