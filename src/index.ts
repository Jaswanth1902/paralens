/**
 * ParaLens: The Observability & Storage Contention Profiler for Monad Parallel EVM
 * Phase 1: The Deterministic Offline Diagnostic Core
 */

// AST Storage & MIP-8
export * from './ast/types.js';
export { parseStorageLayout, getTypeByteSize } from './ast/storageParser.js';
export { classifyMip8Pages } from './ast/mip8Classifier.js';

// Block-STM Simulator
export * from './simulator/types.js';
export { simulateBlockStm } from './simulator/blockStm.js';

// Offline Fixtures
export * from './fixtures/types.js';
export {
  generateNaiveVaultFixture,
  generateShardedVaultFixture,
  writeFixturesToDisk,
} from './fixtures/fixtureGenerator.js';
