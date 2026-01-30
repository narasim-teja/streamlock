/**
 * StreamLock contract deployment script
 */

import {
  Aptos,
  AptosConfig,
  Network,
  Account,
  Ed25519PrivateKey,
} from '@aptos-labs/ts-sdk';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

async function deploy() {
  // Get network from args
  const args = process.argv.slice(2);
  const networkArg = args.find((arg) => arg.startsWith('--network='));
  const network = networkArg?.split('=')[1] || 'testnet';

  console.log(`Deploying StreamLock to ${network}...`);

  // Set up Aptos client
  const aptosConfig = new AptosConfig({
    network: network === 'mainnet' ? Network.MAINNET : Network.TESTNET,
  });
  const client = new Aptos(aptosConfig);

  // Load deployer private key from environment
  const privateKeyHex = process.env.APTOS_PRIVATE_KEY;
  if (!privateKeyHex) {
    console.error('Error: APTOS_PRIVATE_KEY environment variable not set');
    process.exit(1);
  }

  const privateKey = new Ed25519PrivateKey(privateKeyHex);
  const deployer = Account.fromPrivateKey({ privateKey });

  console.log(`Deployer address: ${deployer.accountAddress.toString()}`);

  // Check balance
  const balance = await client.getAccountAPTAmount({
    accountAddress: deployer.accountAddress,
  });
  console.log(`Deployer balance: ${balance / 100_000_000} APT`);

  if (balance < 10_000_000) {
    console.error('Error: Insufficient balance for deployment (need at least 0.1 APT)');
    process.exit(1);
  }

  // Compile the Move package
  console.log('\nCompiling Move package...');
  const contractsDir = join(__dirname, '..');

  try {
    execSync(
      `aptos move compile --package-dir ${contractsDir} --named-addresses streamlock=${deployer.accountAddress.toString()}`,
      { stdio: 'inherit' }
    );
  } catch (error) {
    console.error('Compilation failed');
    process.exit(1);
  }

  // Publish the package
  console.log('\nPublishing package...');

  try {
    execSync(
      `aptos move publish --package-dir ${contractsDir} --named-addresses streamlock=${deployer.accountAddress.toString()} --assume-yes --private-key ${privateKeyHex}`,
      { stdio: 'inherit' }
    );
  } catch (error) {
    console.error('Publishing failed');
    process.exit(1);
  }

  console.log('\n✅ Contract deployed successfully!');
  console.log(`Contract address: ${deployer.accountAddress.toString()}`);

  // Initialize the protocol
  console.log('\nInitializing protocol...');

  const initTx = await client.transaction.build.simple({
    sender: deployer.accountAddress,
    data: {
      function: `${deployer.accountAddress.toString()}::protocol::initialize`,
      functionArguments: [
        deployer.accountAddress.toString(), // treasury
        100, // protocol_fee_bps (1%)
      ],
    },
  });

  const pendingTx = await client.signAndSubmitTransaction({
    signer: deployer,
    transaction: initTx,
  });

  await client.waitForTransaction({ transactionHash: pendingTx.hash });

  console.log('✅ Protocol initialized!');
  console.log(`\nAdd this to your .env.local:`);
  console.log(`NEXT_PUBLIC_CONTRACT_ADDRESS=${deployer.accountAddress.toString()}`);
}

deploy().catch(console.error);
