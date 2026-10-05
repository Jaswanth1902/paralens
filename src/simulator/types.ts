/**
 * ParaLens Synthetic Block-STM Simulator Types
 * Models optimistic multi-threaded parallel EVM execution
 */

export interface Transaction {
  id: number;
  sender: string;
  readSet: (number | string)[]; // storage slots or dynamic keys read
  writeSet: (number | string)[]; // storage slots or dynamic keys written
  gasLimit?: number;
  functionName?: string;
}

export interface BlockStmConfig {
  threads: number; // Number of concurrent execution threads / lanes (default: 16)
  maxIterations?: number;
  targetMaxTps?: number; // Monad ceiling (default: 10000)
}

export interface SlotContentionStats {
  slot: string;
  readCount: number;
  writeCount: number;
  conflictCount: number;
  contentionRatio: number;
}

export interface BlockStmResult {
  totalTransactions: number;
  totalExecutions: number;
  abortedExecutions: number;
  abortRate: number; // 0.0 to 1.0 (e.g. 0.948 or 0.003)
  abortCascadeDepth: number; // Max retry count for any tx
  parallelCycles: number;
  effectiveTps: number; // e.g. 72 or 9820
  speedupFactor: number; // Speedup over single-lane serialization
  slotContention: Record<string, SlotContentionStats>;
  executionTimeline: {
    round: number;
    committedTxCount: number;
    abortedTxCount: number;
  }[];
}
