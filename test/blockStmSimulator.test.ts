import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { simulateBlockStm } from '../src/simulator/blockStm.js';
import type { Transaction } from '../src/simulator/types.js';

describe('Synthetic Block-STM Concurrency Simulator', () => {
  it('should achieve 0 aborts and near-linear speedup on disjoint transactions', () => {
    // 100 transactions each writing to a distinct slot
    const txs: Transaction[] = [];
    for (let i = 0; i < 100; i++) {
      txs.push({
        id: i,
        sender: `0xUser${i.toString().padStart(4, '0')}`,
        readSet: [i + 1000],
        writeSet: [i + 1000],
      });
    }

    const result = simulateBlockStm(txs, { threads: 16 });

    assert.equal(result.totalTransactions, 100);
    assert.equal(result.abortedExecutions, 0);
    assert.equal(result.abortRate, 0);
    assert.equal(result.abortCascadeDepth, 0);
    assert.ok(result.effectiveTps > 5000, `Expected TPS > 5000, got ${result.effectiveTps}`);
  });

  it('should detect write collisions on a shared slot and compute high abort cascade depth', () => {
    // 50 transactions all reading and writing to Slot 0
    const txs: Transaction[] = [];
    for (let i = 0; i < 50; i++) {
      txs.push({
        id: i,
        sender: `0xUser${i.toString().padStart(4, '0')}`,
        readSet: [0],
        writeSet: [0],
      });
    }

    const result = simulateBlockStm(txs, { threads: 16 });

    assert.equal(result.totalTransactions, 50);
    assert.ok(result.abortedExecutions > 0, 'Expected non-zero aborts');
    assert.ok(result.abortRate > 0.5, `Expected abort rate > 50%, got ${result.abortRate}`);
    assert.ok(result.abortCascadeDepth > 1, `Expected cascade depth > 1, got ${result.abortCascadeDepth}`);
    assert.ok(result.effectiveTps < 2000, `Expected serialized TPS < 2000, got ${result.effectiveTps}`);
  });

  it('should reproduce canonical benchmark: Naive Vault (72 TPS, ~94.8% aborts) vs Sharded Vault (9,820 TPS, ~0.3% aborts)', () => {
    // 1. Naive Vault: 2,500 deposits colliding on Slot 0
    const naiveTxs: Transaction[] = [];
    for (let i = 0; i < 2500; i++) {
      const userSlot = `0xbalance_${i}`;
      naiveTxs.push({
        id: i,
        sender: `0xUser${i}`,
        readSet: [0, userSlot], // slot 0 = totalAssets
        writeSet: [0, userSlot],
      });
    }

    const naiveResult = simulateBlockStm(naiveTxs, { threads: 16 });

    // Abort rate ~94.8% (tolerance 85% to 99%)
    assert.ok(
      naiveResult.abortRate >= 0.85 && naiveResult.abortRate <= 0.99,
      `Expected naive abort rate between 85% and 99%, got ${(naiveResult.abortRate * 100).toFixed(1)}%`
    );
    // Realized TPS ~72 (tolerance: 50 to 120 TPS)
    assert.ok(
      naiveResult.effectiveTps >= 50 && naiveResult.effectiveTps <= 150,
      `Expected naive TPS around 72, got ${naiveResult.effectiveTps}`
    );

    // 2. Sharded Vault: 2,500 deposits distributed across 16 slot shards
    const shardedTxs: Transaction[] = [];
    for (let i = 0; i < 2500; i++) {
      const shardSlot = 1 + (i % 16); // Shards across slots 1..16
      const userSlot = `0xbalance_${i}`;
      shardedTxs.push({
        id: i,
        sender: `0xUser${i}`,
        readSet: [shardSlot, userSlot],
        writeSet: [shardSlot, userSlot],
      });
    }

    const shardedResult = simulateBlockStm(shardedTxs, { threads: 16 });

    // Abort rate ~0.3% (tolerance < 2.0%)
    assert.ok(
      shardedResult.abortRate < 0.02,
      `Expected sharded abort rate < 2%, got ${(shardedResult.abortRate * 100).toFixed(2)}%`
    );
    // Realized TPS ~9,820 (tolerance: > 8,500 TPS)
    assert.ok(
      shardedResult.effectiveTps >= 8500,
      `Expected sharded TPS >= 8500, got ${shardedResult.effectiveTps}`
    );

    // Speedup factor >= 50x (target 136x)
    const speedup = shardedResult.effectiveTps / naiveResult.effectiveTps;
    assert.ok(speedup >= 50, `Expected speedup >= 50x, got ${speedup.toFixed(1)}x`);
  });

  it('should scale simulation gracefully across 1,000 to 10,000 tx blocks', () => {
    for (const blockSize of [1000, 5000, 10000]) {
      const txs: Transaction[] = [];
      for (let i = 0; i < blockSize; i++) {
        const shard = 1 + (i % 32);
        txs.push({
          id: i,
          sender: `0xUser${i}`,
          readSet: [shard],
          writeSet: [shard],
        });
      }

      const res = simulateBlockStm(txs, { threads: 32 });
      assert.equal(res.totalTransactions, blockSize);
      assert.ok(res.effectiveTps > 7000);
      assert.ok(res.abortCascadeDepth < 5);
    }
  });

  it('should handle edge cases: empty txs, missing sets, custom targetMaxTps and thread configurations', () => {
    // 1. Empty transactions
    const emptyRes = simulateBlockStm([]);
    assert.equal(emptyRes.totalTransactions, 0);
    assert.equal(emptyRes.effectiveTps, 0);
    assert.equal(emptyRes.abortRate, 0);

    // 2. Transactions with missing or partial read/write sets
    const partialTxs: Transaction[] = [
      { id: 0, sender: '0xAlice', readSet: [], writeSet: [1] },
      { id: 1, sender: '0xBob', readSet: [1], writeSet: [] },
    ];
    const partialRes = simulateBlockStm(partialTxs, { threads: 2 });
    assert.equal(partialRes.totalTransactions, 2);
    assert.equal(partialRes.slotContention['1'].writeCount, 1);
    // tx 1 retried after tx 0 wrote slot 1, so readCount was accessed across both executions
    assert.equal(partialRes.slotContention['1'].readCount, 2);
    assert.equal(partialRes.abortedExecutions, 1);

    // 3. Custom targetMaxTps limit
    const disjointTxs: Transaction[] = [];
    for (let i = 0; i < 50; i++) {
      disjointTxs.push({ id: i, sender: `0xUser${i}`, readSet: [i], writeSet: [i] });
    }
    const cappedRes = simulateBlockStm(disjointTxs, { threads: 16, targetMaxTps: 5000 });
    assert.ok(cappedRes.effectiveTps <= 5000, `Expected <= 5000, got ${cappedRes.effectiveTps}`);

    // 4. Execution timeline integrity
    assert.ok(cappedRes.executionTimeline.length > 0);
    const totalCommitted = cappedRes.executionTimeline.reduce((sum, r) => sum + r.committedTxCount, 0);
    assert.equal(totalCommitted, 50);
  });
});
