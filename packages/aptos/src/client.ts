/**
 * Aptos client wrapper
 */

import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk';
import { NETWORKS, type NetworkName } from '@streamlock/common';
import type { NetworkConfig } from './types';

/** Create Aptos client for a specific network */
export function createAptosClient(network: NetworkName): Aptos {
  const networkConfig = getNetworkConfig(network);

  const config = new AptosConfig({
    network: getAptosNetwork(network),
    fullnode: networkConfig.nodeUrl,
    faucet: networkConfig.faucetUrl ?? undefined,
  });

  return new Aptos(config);
}

/** Get network configuration */
export function getNetworkConfig(network: NetworkName): NetworkConfig {
  return NETWORKS[network];
}

/** Map network name to Aptos SDK Network enum */
function getAptosNetwork(network: NetworkName): Network {
  switch (network) {
    case 'mainnet':
      return Network.MAINNET;
    case 'testnet':
      return Network.TESTNET;
    case 'devnet':
      return Network.DEVNET;
    default:
      return Network.TESTNET;
  }
}

/** Check if connected to network */
export async function checkConnection(client: Aptos): Promise<boolean> {
  try {
    await client.getLedgerInfo();
    return true;
  } catch {
    return false;
  }
}

/** Get current ledger version */
export async function getLedgerVersion(client: Aptos): Promise<bigint> {
  const info = await client.getLedgerInfo();
  return BigInt(info.ledger_version);
}

/** Get account balance in octas */
export async function getAccountBalance(
  client: Aptos,
  address: string
): Promise<bigint> {
  try {
    const resources = await client.getAccountResources({ accountAddress: address });
    const coinStore = resources.find(
      (r) => r.type === '0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>'
    );

    if (!coinStore) {
      return 0n;
    }

    const data = coinStore.data as { coin: { value: string } };
    return BigInt(data.coin.value);
  } catch {
    return 0n;
  }
}
