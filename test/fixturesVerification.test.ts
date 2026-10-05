import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { simulateBlockStm } from '../src/simulator/blockStm.js';
import type { VaultFixture } from '../src/fixtures/types.js';

describe('Deterministic Offline Test Fixtures (Air-Gap Invariant)', () => {
  const fixturesDir = path.resolve('fixtures');
  const naivePath = path.join(fixturesDir, 'fixture_naive_vault.json');
  const shardedPath = path.join(fixturesDir, 'fixture_sharded_vault.json');

  it('should have valid deterministic JSON fixture files on disk', () => {
    assert.ok(fs.existsSync(naivePath), `Fixture missing: ${naivePath}`);
    assert.ok(fs.existsSync(shardedPath), `Fixture missing: ${shardedPath}`);

    const naiveFixture: VaultFixture = JSON.parse(fs.readFileSync(naivePath, 'utf8'));
    const shardedFixture: VaultFixture = JSON.parse(fs.readFileSync(shardedPath, 'utf8'));

    assert.equal(naiveFixture.type, 'naive');
    assert.equal(naiveFixture.totalTransactions, 2500);
    assert.equal(naiveFixture.transactions.length, 2500);
    assert.ok(naiveFixture.expectedAbortRate > 0.8);
    assert.ok(naiveFixture.expectedTps < 150);

    assert.equal(shardedFixture.type, 'sharded');
    assert.equal(shardedFixture.totalTransactions, 2500);
    assert.equal(shardedFixture.transactions.length, 2500);
    assert.ok(shardedFixture.expectedAbortRate < 0.05);
    assert.ok(shardedFixture.expectedTps > 8500);
  });

  it('should reproduce benchmark directly from fixture_naive_vault.json offline', () => {
    const naiveFixture: VaultFixture = JSON.parse(fs.readFileSync(naivePath, 'utf8'));
    const result = simulateBlockStm(naiveFixture.transactions, { threads: 16 });

    assert.equal(result.totalTransactions, 2500);
    assert.ok(result.abortRate >= 0.85, `Expected >= 85% aborts, got ${(result.abortRate * 100).toFixed(1)}%`);
    assert.ok(result.effectiveTps >= 50 && result.effectiveTps <= 150, `Expected TPS ~72, got ${result.effectiveTps}`);
  });

  it('should reproduce benchmark directly from fixture_sharded_vault.json offline', () => {
    const shardedFixture: VaultFixture = JSON.parse(fs.readFileSync(shardedPath, 'utf8'));
    const result = simulateBlockStm(shardedFixture.transactions, { threads: 16 });

    assert.equal(result.totalTransactions, 2500);
    assert.ok(result.abortRate < 0.02, `Expected < 2% aborts, got ${(result.abortRate * 100).toFixed(2)}%`);
    assert.ok(result.effectiveTps >= 8500, `Expected TPS >= 8500, got ${result.effectiveTps}`);
  });

  it('should verify storage layouts of fixture contract sources match physical EVM slots', async () => {
    const { parseStorageLayout } = await import('../src/ast/storageParser.js');
    const naiveFixture: VaultFixture = JSON.parse(fs.readFileSync(naivePath, 'utf8'));
    const shardedFixture: VaultFixture = JSON.parse(fs.readFileSync(shardedPath, 'utf8'));

    const naiveLayout = parseStorageLayout(naiveFixture.contractSource);
    assert.equal(naiveLayout.contractName, 'NaiveERC4626Vault');
    assert.equal(naiveLayout.totalSlots, 3);
    assert.equal(naiveLayout.variables[0].name, 'totalAssets');
    assert.equal(naiveLayout.variables[0].slot, 0);

    const shardedLayout = parseStorageLayout(shardedFixture.contractSource);
    assert.equal(shardedLayout.contractName, 'ShardedVault');
    assert.equal(shardedLayout.totalSlots, 17);
    assert.equal(shardedLayout.variables[0].name, 'assetShards');
    assert.equal(shardedLayout.variables[0].slot, 0);
    assert.equal(shardedLayout.variables[0].bytes, 512); // 16 * 32 bytes
    assert.equal(shardedLayout.variables[1].name, 'shareBalances');
    assert.equal(shardedLayout.variables[1].slot, 16);
  });
});
