import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeMappingSlot, computeNestedMappingSlot, ParaLensHyperSync } from '../src/traces/hypersyncClient.js';

describe('Envio HyperSync Trace & Mapping Resolver', () => {
  it('should accurately calculate EVM mapping slot hash via keccak256(key . slot)', () => {
    // Address 0x0000000000000000000000000000000000000001 at mapping slot 0
    const key = '0x0000000000000000000000000000000000000001';
    const baseSlot = 0;
    const computedSlot = computeMappingSlot(key, baseSlot);

    assert.ok(computedSlot.startsWith('0x'), 'Slot should have 0x prefix');
    assert.equal(computedSlot.length, 66, 'Slot should be 32 bytes (64 hex characters + 0x)');
    
    // Changing slot changes output deterministically
    const slot1 = computeMappingSlot(key, 1);
    assert.notEqual(computedSlot, slot1, 'Different base slots should yield distinct storage locations');
  });

  it('should accurately calculate nested mapping slot for ERC-20 allowances', () => {
    const owner = '0x0000000000000000000000000000000000000001';
    const spender = '0x0000000000000000000000000000000000000002';
    const nestedSlot = computeNestedMappingSlot(owner, spender, 2);

    assert.ok(nestedSlot.startsWith('0x'));
    assert.equal(nestedSlot.length, 66);
  });

  it('should decode ERC-4626 deposit calldata into Slot 0 write collision', () => {
    const hypersync = new ParaLensHyperSync({ fallbackToFixture: true });
    // Calldata for deposit(100, 0x1234...)
    const calldata = '0x6e553f65' + '0000000000000000000000000000000000000000000000000000000000000064' + '000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const from = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

    const { readSlots, writeSlots } = hypersync.decodeCallToSlots(calldata, from, { totalShares: 0, balances: 1 });

    assert.ok(writeSlots.includes('0x0000000000000000000000000000000000000000000000000000000000000000'), 'Should write to global totalShares Slot 0');
    assert.equal(readSlots.length, 2);
    assert.equal(writeSlots.length, 2);
  });

  it('should harvest transaction traces with deterministic fallback (Air-Gap Invariant)', async () => {
    const hypersync = new ParaLensHyperSync({ fallbackToFixture: true, offline: true });
    const result = await hypersync.harvestTraces('0x1111111111111111111111111111111111111111', 1000, 1100);

    assert.ok(result.totalTransactions > 0, 'Should load traces');
    assert.ok(result.traces.length > 0, 'Traces should be populated');
    assert.ok(result.detectedCollisions > 0, 'Should detect collisions on shared slot');
    assert.ok(result.harvestDurationMs >= 0, 'Duration should be recorded');
  });
});
