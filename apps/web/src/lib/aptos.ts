/**
 * Aptos client initialization
 */

import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk';

function getNetwork(): Network {
  const network = process.env.NEXT_PUBLIC_APTOS_NETWORK || 'testnet';
  switch (network) {
    case 'mainnet':
      return Network.MAINNET;
    case 'devnet':
      return Network.DEVNET;
    default:
      return Network.TESTNET;
  }
}

const config = new AptosConfig({ network: getNetwork() });
export const aptosClient = new Aptos(config);

export function getContractAddress(): string {
  const address = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS;
  if (!address) {
    throw new Error('NEXT_PUBLIC_CONTRACT_ADDRESS not set');
  }
  return address;
}

export function getKeyServerUrl(): string {
  return process.env.NEXT_PUBLIC_KEY_SERVER_URL || 'http://localhost:3000/api';
}
