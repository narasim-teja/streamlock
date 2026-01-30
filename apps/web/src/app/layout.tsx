import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import '@/styles/globals.css';
import { WalletProvider } from '@/components/wallet/WalletProvider';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'StreamLock - Pay-Per-Second Video Streaming',
  description:
    'Trustless pay-per-second video streaming protocol on Aptos blockchain',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
