/**
 * ParaLens: The Observability & Storage Contention Profiler for Monad Parallel EVM
 * Pure Track 4: Trust, Identity, and AI Infrastructure
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

// Envio HyperSync Trace Replayer & Dynamic Mapping Resolver
export * from './traces/types.js';
export {
  ParaLensHyperSync,
  computeMappingSlot,
  computeNestedMappingSlot,
} from './traces/hypersyncClient.js';

// Qwen 3.8 Max Auto-Refactoring Engine
export * from './refactor/types.js';
export { QwenRefactorEngine } from './refactor/qwenRefactorEngine.js';

// Alchemy RPC & Bytecode Verification Adapter
export * from './adapters/alchemyAdapter.js';
export { AlchemyAdapter } from './adapters/alchemyAdapter.js';

// x402 Micropayment Protocol & EIP-8004 Trust Attestation (Track 4 Core)
export * from './gateway/x402Handler.js';
export { X402Handler } from './gateway/x402Handler.js';
export * from './attestation/erc8004.js';
export { Erc8004AttestationEngine } from './attestation/erc8004.js';
