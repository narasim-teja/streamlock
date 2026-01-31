'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { Aptos, Network } from '@aptos-labs/ts-sdk';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Copy, ExternalLink, LogOut, ChevronDown, Wallet } from 'lucide-react';
import { truncateAddress, octasToApt } from '@streamlock/common';
import { WalletModal } from './WalletModal';

export function ConnectButton() {
  const { account, connected, disconnect, network } = useWallet();
  const [modalOpen, setModalOpen] = useState(false);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [copied, setCopied] = useState(false);

  // Fetch balance when connected
  useEffect(() => {
    if (!connected || !account?.address) {
      setBalance(null);
      return;
    }

    const fetchBalance = async () => {
      try {
        const aptosNetwork =
          (process.env.NEXT_PUBLIC_APTOS_NETWORK as Network) || Network.TESTNET;
        const client = new Aptos({ network: aptosNetwork });
        const resources = await client.getAccountResources({
          accountAddress: account.address,
        });

        const coinStore = resources.find(
          (r) => r.type === '0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>'
        );

        if (coinStore) {
          const data = coinStore.data as { coin: { value: string } };
          setBalance(BigInt(data.coin.value));
        }
      } catch (error) {
        console.error('Failed to fetch balance:', error);
      }
    };

    fetchBalance();
    // Refresh balance every 30 seconds
    const interval = setInterval(fetchBalance, 30000);
    return () => clearInterval(interval);
  }, [connected, account?.address]);

  const copyAddress = async () => {
    if (account?.address) {
      await navigator.clipboard.writeText(account.address.toString());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const openExplorer = () => {
    if (account?.address) {
      const baseUrl =
        network?.name === 'mainnet'
          ? 'https://explorer.aptoslabs.com'
          : 'https://explorer.aptoslabs.com';
      const networkParam = network?.name === 'mainnet' ? '' : '?network=testnet';
      window.open(
        `${baseUrl}/account/${account.address}${networkParam}`,
        '_blank'
      );
    }
  };

  if (connected && account) {
    return (
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className="flex items-center gap-2 bg-secondary hover:bg-secondary/80 text-secondary-foreground px-4 py-2 rounded-lg text-sm transition">
            <Wallet className="w-4 h-4" />
            <div className="flex flex-col items-start">
              <span className="font-medium">
                {truncateAddress(account.address)}
              </span>
              {balance !== null && (
                <span className="text-xs text-muted-foreground">
                  {octasToApt(balance).toFixed(4)} APT
                </span>
              )}
            </div>
            <ChevronDown className="w-4 h-4 ml-1" />
          </button>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="min-w-[200px] bg-background border border-border rounded-lg shadow-lg p-1 z-50"
            sideOffset={8}
            align="end"
          >
            <div className="px-3 py-2 border-b border-border mb-1">
              <div className="text-xs text-muted-foreground mb-1">
                Connected to {network?.name || 'testnet'}
              </div>
              <div className="font-mono text-sm truncate">
                {truncateAddress(account.address, 8)}
              </div>
            </div>

            <DropdownMenu.Item
              className="flex items-center gap-2 px-3 py-2 text-sm rounded cursor-pointer hover:bg-muted outline-none"
              onClick={copyAddress}
            >
              <Copy className="w-4 h-4" />
              {copied ? 'Copied!' : 'Copy Address'}
            </DropdownMenu.Item>

            <DropdownMenu.Item
              className="flex items-center gap-2 px-3 py-2 text-sm rounded cursor-pointer hover:bg-muted outline-none"
              onClick={openExplorer}
            >
              <ExternalLink className="w-4 h-4" />
              View on Explorer
            </DropdownMenu.Item>

            <DropdownMenu.Separator className="h-px bg-border my-1" />

            <DropdownMenu.Item
              className="flex items-center gap-2 px-3 py-2 text-sm rounded cursor-pointer hover:bg-destructive/10 text-destructive outline-none"
              onClick={disconnect}
            >
              <LogOut className="w-4 h-4" />
              Disconnect
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    );
  }

  return (
    <>
      <button
        onClick={() => setModalOpen(true)}
        className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm hover:opacity-90 transition flex items-center gap-2"
      >
        <Wallet className="w-4 h-4" />
        Connect Wallet
      </button>
      <WalletModal open={modalOpen} onOpenChange={setModalOpen} />
    </>
  );
}
