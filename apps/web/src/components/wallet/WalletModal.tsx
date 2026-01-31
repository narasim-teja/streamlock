'use client';

import { useWallet, WalletReadyState, type WalletName } from '@aptos-labs/wallet-adapter-react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

interface WalletModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WalletModal({ open, onOpenChange }: WalletModalProps) {
  const { wallets, connect } = useWallet();

  const handleConnect = async (walletName: WalletName) => {
    try {
      await connect(walletName);
      // Save last used wallet
      localStorage.setItem('streamlock_last_wallet', walletName);
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to connect wallet:', error);
    }
  };

  // Sort wallets: installed first, then by name
  const sortedWallets = [...(wallets || [])].sort((a, b) => {
    const aInstalled = a.readyState === WalletReadyState.Installed;
    const bInstalled = b.readyState === WalletReadyState.Installed;
    if (aInstalled && !bInstalled) return -1;
    if (!aInstalled && bInstalled) return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-background border border-border rounded-xl shadow-xl p-6 w-full max-w-md z-50">
          <div className="flex items-center justify-between mb-6">
            <Dialog.Title className="text-lg font-semibold">
              Connect Wallet
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="p-1 rounded-lg hover:bg-muted transition">
                <X className="w-5 h-5" />
              </button>
            </Dialog.Close>
          </div>

          <div className="space-y-2">
            {sortedWallets.map((wallet) => {
              const isInstalled = wallet.readyState === WalletReadyState.Installed;
              const isLoadable = wallet.readyState === WalletReadyState.Loadable;

              return (
                <button
                  key={wallet.name}
                  onClick={() => {
                    if (isInstalled || isLoadable) {
                      handleConnect(wallet.name);
                    } else if (wallet.url) {
                      window.open(wallet.url, '_blank');
                    }
                  }}
                  className="w-full flex items-center gap-4 p-4 rounded-lg border border-border hover:bg-muted/50 transition group"
                >
                  <div className="w-10 h-10 rounded-lg overflow-hidden bg-muted flex items-center justify-center">
                    {wallet.icon && (
                      <img
                        src={wallet.icon}
                        alt={wallet.name}
                        className="w-8 h-8"
                      />
                    )}
                  </div>
                  <div className="flex-1 text-left">
                    <div className="font-medium">{wallet.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {isInstalled
                        ? 'Installed'
                        : isLoadable
                          ? 'Click to connect'
                          : 'Not installed'}
                    </div>
                  </div>
                  {!isInstalled && !isLoadable && (
                    <span className="text-xs text-primary bg-primary/10 px-2 py-1 rounded">
                      Install
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-6 pt-4 border-t border-border">
            <p className="text-xs text-muted-foreground text-center">
              By connecting a wallet, you agree to the StreamLock Terms of
              Service and Privacy Policy.
            </p>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
