/**
 * Trace and HyperSync Types for ParaLens
 */

export interface TransactionTrace {
  txHash: string;
  blockNumber: number;
  from: string;
  to: string;
  calldata: string;
  value?: string;
  readSlots: string[];
  writeSlots: string[];
}

export interface DynamicSlotAccess {
  mappingSlot: number;
  key: string;
  derivedSlotHash: string;
  accessType: 'READ' | 'WRITE';
  txHash: string;
}

export interface HyperSyncConfig {
  url?: string;
  apiToken?: string;
  fallbackToFixture?: boolean;
  offline?: boolean;
}

export interface HyperSyncHarvestResult {
  source: 'HYPERSYNC_LIVE' | 'OFFLINE_FIXTURE';
  blockRange: { from: number; to: number };
  totalTransactions: number;
  traces: TransactionTrace[];
  detectedCollisions: number;
  harvestDurationMs: number;
}
