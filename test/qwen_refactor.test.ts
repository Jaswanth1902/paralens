import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { QwenRefactorEngine } from '../src/refactor/qwenRefactorEngine.js';

describe('Qwen 3.8 Max Auto-Refactoring Engine', () => {
  const naiveCode = `// SPDX-License-Identifier: MIT
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

  it('should transform global totalShares write collisions into 16-way sharded state', async () => {
    const engine = new QwenRefactorEngine();
    const result = await engine.refactorContract(naiveCode, {
      contractName: 'NaiveERC4626Vault',
      contendedSlot: 1,
      variableName: 'totalShares',
      conflictType: 'GLOBAL_ACCUMULATOR',
      currentTps: 72,
      currentAbortRate: 0.948
    });

    assert.ok(result.refactoredCode.includes('_shardedShares'), 'Should declare sharded shares array');
    assert.ok(result.refactoredCode.includes('msg.sender'), 'Should index shards by sender hash');
    assert.ok(result.refactoredCode.includes('function totalShares()'), 'Should provide aggregated view getter');
    assert.equal(result.projectedTps, 9820, 'Should project 9,820 TPS');
    assert.equal(result.projectedAbortRate, 0.003, 'Should project 0.3% abort rate');
    assert.ok(result.diff.includes('--- a/NaiveERC4626Vault.sol'), 'Should produce unified diff');
  });

  it('should transform persistent reentrancy locks into transient storage', async () => {
    const lockCode = `contract Pool {
    uint256 private _status;
    function swap() external {
        _status = 2;
        // swap logic
        _status = 1;
    }
}`;
    const engine = new QwenRefactorEngine();
    const result = await engine.refactorContract(lockCode, {
      contractName: 'Pool',
      contendedSlot: 0,
      variableName: '_status',
      conflictType: 'REENTRANCY_LOCK',
      currentTps: 310,
      currentAbortRate: 0.65
    });

    assert.ok(result.refactoredCode.includes('Transient Storage'), 'Should use transient storage');
    assert.ok(result.appliedPattern.includes('Transient Storage'), 'Pattern should reflect EIP-1153');
  });
});
