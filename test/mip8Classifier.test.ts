import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseStorageLayout } from '../src/ast/storageParser.js';
import { classifyMip8Pages } from '../src/ast/mip8Classifier.js';

describe('Monad MIP-8 Page Classifier', () => {
  it('should categorize storage slots into 128-slot MIP-8 pages and detect high density', () => {
    const code = `
      // SPDX-License-Identifier: MIT
      pragma solidity ^0.8.20;

      contract StakingPool {
          uint256 public totalStaked;   // slot 0, page 0
          uint256 public rewardRate;    // slot 1, page 0
          uint256 public lastUpdateTime;// slot 2, page 0
          mapping(address => uint256) public userStakes; // slot 3, page 0
      }
    `;

    const layout = parseStorageLayout(code, 'StakingPool');
    const classification = classifyMip8Pages(layout, [
      { slot: 0, accessFrequency: 2500, accessType: 'WRITE' },
      { slot: 1, accessFrequency: 2500, accessType: 'READ' },
      { slot: 2, accessFrequency: 2500, accessType: 'WRITE' },
    ]);

    assert.equal(classification.totalPages, 1);
    assert.equal(classification.pages[0].pageIndex, 0);
    assert.equal(classification.pages[0].slotCount, 4);
    assert.equal(classification.pages[0].slots.length, 4);

    // Contention hotspot on Page 0 due to concurrent writes on slots 0 and 2
    assert.ok(classification.hotspots.length > 0);
    const page0Hotspot = classification.hotspots.find((h) => h.mip8Page === 0);
    assert.ok(page0Hotspot !== undefined);
    assert.ok(page0Hotspot!.contentionScore > 0.8);
    assert.equal(page0Hotspot!.riskLevel, 'CRITICAL');
  });

  it('should distinguish clean sharded pages across multiple MIP-8 pages', () => {
    // 16 shards spaced apart across different MIP-8 page boundaries
    const vars = [];
    for (let i = 0; i < 16; i++) {
      vars.push(`uint256 public shard_${i};`);
    }
    const code = `
      // SPDX-License-Identifier: MIT
      pragma solidity ^0.8.20;

      contract ShardedVaultState {
          ${vars.join('\n          ')}
      }
    `;

    const layout = parseStorageLayout(code, 'ShardedVaultState');
    // Each shard has an access frequency of ~156 writes evenly distributed
    const accesses = [];
    for (let i = 0; i < 16; i++) {
      accesses.push({ slot: i, accessFrequency: 156, accessType: 'WRITE' as const });
    }

    const classification = classifyMip8Pages(layout, accesses);

    assert.equal(classification.totalPages, 1);
    assert.equal(classification.pages[0].slotCount, 16);
    // Evenly distributed writes have lower single-slot contention score than monolithic 2500 writes
    const maxSlotHotspot = classification.slotHotspots.reduce((max, s) => s.contentionScore > max ? s.contentionScore : max, 0);
    assert.ok(maxSlotHotspot < 0.2);
  });
});
