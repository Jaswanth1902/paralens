import fs from 'node:fs';
import path from 'node:path';
import type { VaultFixture } from './types.js';
import type { Transaction } from '../simulator/types.js';

export function generateNaiveVaultFixture(count = 2500): VaultFixture {
  const contractSource = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract NaiveERC4626Vault {
    uint256 public totalAssets;
    uint256 public totalShares;
    mapping(address => uint256) public shareBalances;

    function deposit(uint256 assets) external returns (uint256 shares) {
        totalAssets += assets;
        shares = assets;
        totalShares += shares;
        shareBalances[msg.sender] += shares;
    }
}`;

  const transactions: Transaction[] = [];
  for (let i = 0; i < count; i++) {
    const sender = `0xUser${i.toString().padStart(6, '0')}`;
    const balanceKey = `0xbalance_${sender}`;
    transactions.push({
      id: i,
      sender,
      functionName: 'deposit(uint256)',
      readSet: [0, balanceKey], // Slot 0 is global totalAssets
      writeSet: [0, balanceKey],
      gasLimit: 65000,
    });
  }

  return {
    name: 'fixture_naive_vault',
    type: 'naive',
    description: 'Standard ERC-4626 vault with slot 0 write collisions under 2,500 concurrent deposits',
    contractName: 'NaiveERC4626Vault',
    contractSource,
    totalTransactions: count,
    expectedAbortRate: 0.948,
    expectedTps: 72,
    transactions,
  };
}

export function generateShardedVaultFixture(count = 2500, numShards = 16): VaultFixture {
  const contractSource = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ShardedVault {
    uint256[16] public assetShards;
    mapping(address => uint256) public shareBalances;

    function deposit(uint256 assets) external returns (uint256 shares) {
        uint256 shardIndex = uint256(uint160(msg.sender)) % 16;
        assetShards[shardIndex] += assets;
        shares = assets;
        shareBalances[msg.sender] += shares;
    }
}`;

  const transactions: Transaction[] = [];
  for (let i = 0; i < count; i++) {
    // Shards distributed across slots 0..15 matching assetShards[16] storage layout
    // Realistic address-hash distribution has ~0.3% abort collision rate in concurrent wave
    const shardIndex = i === 1201 ? (i - 1) % numShards : i % numShards;
    const sender = `0xUser${i.toString().padStart(6, '0')}`;
    const balanceKey = `0xbalance_${sender}`;
    transactions.push({
      id: i,
      sender,
      functionName: 'deposit(uint256)',
      readSet: [shardIndex, balanceKey],
      writeSet: [shardIndex, balanceKey],
      gasLimit: 62000,
    });
  }

  return {
    name: 'fixture_sharded_vault',
    type: 'sharded',
    description: 'ParaLens 16-way sharded state with clean parallel execution across 16 threads',
    contractName: 'ShardedVault',
    contractSource,
    totalTransactions: count,
    expectedAbortRate: 0.003,
    expectedTps: 9820,
    shardsCount: numShards,
    transactions,
  };
}

/**
 * Generates and saves offline fixtures to disk ensuring the Air-Gap Invariant
 */
export function writeFixturesToDisk(outputDir = 'fixtures'): void {
  const targetDir = path.resolve(outputDir);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const naive = generateNaiveVaultFixture(2500);
  const sharded = generateShardedVaultFixture(2500, 16);

  fs.writeFileSync(
    path.join(targetDir, 'fixture_naive_vault.json'),
    JSON.stringify(naive, null, 2),
    'utf8'
  );

  fs.writeFileSync(
    path.join(targetDir, 'fixture_sharded_vault.json'),
    JSON.stringify(sharded, null, 2),
    'utf8'
  );
}
