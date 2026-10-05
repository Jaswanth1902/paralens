import type {
  Transaction,
  BlockStmConfig,
  BlockStmResult,
  SlotContentionStats,
} from './types.js';

/**
 * Karpathy-style Minimalist Block-STM Simulator
 * Models optimistic multi-threaded parallel EVM execution, MVDS multi-version
 * data structures, RAW conflict detection, and abort cascade depth.
 */
export function simulateBlockStm(
  transactions: Transaction[],
  config: BlockStmConfig = { threads: 16 }
): BlockStmResult {
  const N = transactions.length;
  if (N === 0) {
    return {
      totalTransactions: 0,
      totalExecutions: 0,
      abortedExecutions: 0,
      abortRate: 0,
      abortCascadeDepth: 0,
      parallelCycles: 0,
      effectiveTps: 0,
      speedupFactor: 1,
      slotContention: {},
      executionTimeline: [],
    };
  }

  const threadCount = Math.max(1, config.threads || 16);
  const maxIterations = config.maxIterations || Math.max(10000, N * 30);
  const targetMaxTps = config.targetMaxTps || 10000;

  // MVDS: key -> array of writer txIds (maintained in sorted order)
  const mvds = new Map<string, number[]>();

  // Transaction execution status
  enum TxStatus {
    PENDING = 0,
    EXECUTED = 1,
    COMMITTED = 2,
  }

  const statuses = new Array<TxStatus>(N).fill(TxStatus.PENDING);
  const retryCounts = new Array<number>(N).fill(0);
  const observedReads = new Array<Map<string, number>>(N);
  for (let i = 0; i < N; i++) {
    observedReads[i] = new Map();
  }

  // Fast O(1) amortized reverse lookup for highest writer tx < txId
  function getLatestVersion(key: string, txId: number): number {
    const writers = mvds.get(key);
    if (!writers || writers.length === 0) return -1;
    for (let idx = writers.length - 1; idx >= 0; idx--) {
      if (writers[idx] < txId) {
        return writers[idx];
      }
    }
    return -1;
  }

  // Contention telemetry tracking
  const slotStats = new Map<string, { reads: number; writes: number; conflicts: number }>();
  function trackAccess(key: string, isWrite: boolean) {
    let stat = slotStats.get(key);
    if (!stat) {
      stat = { reads: 0, writes: 0, conflicts: 0 };
      slotStats.set(key, stat);
    }
    if (isWrite) stat.writes++;
    else stat.reads++;
  }
  function trackConflict(key: string) {
    let stat = slotStats.get(key);
    if (!stat) {
      stat = { reads: 0, writes: 0, conflicts: 0 };
      slotStats.set(key, stat);
    }
    stat.conflicts++;
  }

  let totalExecutions = 0;
  let abortedExecutions = 0;
  let parallelCycles = 0;
  const executionTimeline: { round: number; committedTxCount: number; abortedTxCount: number }[] = [];

  let committedCount = 0;
  let iteration = 0;

  while (committedCount < N && iteration < maxIterations) {
    iteration++;
    parallelCycles++;

    // 1. Schedule next batch of uncommitted, pending transactions up to threadCount
    const batch: number[] = [];
    for (let i = committedCount; i < N; i++) {
      if (statuses[i] === TxStatus.PENDING) {
        batch.push(i);
        if (batch.length === threadCount) break;
      }
    }

    if (batch.length === 0) {
      break;
    }

    const minBatchTxId = batch[0];
    const maxBatchTxId = batch[batch.length - 1];
    let roundAborts = 0;

    // 2. Concurrent Read Phase: optimistic state read from MVDS before batch writes take effect
    for (const txId of batch) {
      totalExecutions++;
      const tx = transactions[txId];
      const reads = new Map<string, number>();
      const readSet = tx.readSet || [];

      for (const rawKey of readSet) {
        const key = String(rawKey);
        trackAccess(key, false);
        const ver = getLatestVersion(key, txId);
        reads.set(key, ver);
      }
      observedReads[txId] = reads;
    }

    // 3. Concurrent Write Phase: commit speculative writes into MVDS
    for (const txId of batch) {
      const tx = transactions[txId];
      const writeSet = tx.writeSet || [];

      for (const rawKey of writeSet) {
        const key = String(rawKey);
        trackAccess(key, true);
        let writers = mvds.get(key);
        if (!writers) {
          writers = [];
          mvds.set(key, writers);
        }
        writers.push(txId);
      }
      statuses[txId] = TxStatus.EXECUTED;
    }

    // 4. Validation & Abort Cascade Phase
    // Check all EXECUTED transactions in the active batch window for RAW conflicts
    for (let i = minBatchTxId; i <= maxBatchTxId; i++) {
      if (statuses[i] !== TxStatus.EXECUTED) continue;

      const tx = transactions[i];
      let hasConflict = false;
      const readSet = tx.readSet || [];

      for (const rawKey of readSet) {
        const key = String(rawKey);
        const latestVersion = getLatestVersion(key, i);
        const observedVersion = observedReads[i].get(key);

        if (observedVersion !== latestVersion) {
          hasConflict = true;
          trackConflict(key);
          break;
        }
      }

      if (hasConflict) {
        // Transaction i must ABORT and roll back its writes
        roundAborts++;
        abortedExecutions++;
        retryCounts[i]++;
        statuses[i] = TxStatus.PENDING;

        // Roll back writes of tx i from MVDS
        const writeSet = tx.writeSet || [];
        for (const rawKey of writeSet) {
          const key = String(rawKey);
          const writers = mvds.get(key);
          if (writers) {
            const pos = writers.indexOf(i);
            if (pos !== -1) writers.splice(pos, 1);
          }
        }

        // Cascade abort: any subsequent tx in the active window that read from tx i must abort
        for (let j = i + 1; j <= maxBatchTxId; j++) {
          if (statuses[j] === TxStatus.EXECUTED) {
            let cascade = false;
            for (const rKey of transactions[j].readSet || []) {
              if (observedReads[j]?.get(String(rKey)) === i) {
                cascade = true;
                break;
              }
            }
            if (cascade) {
              roundAborts++;
              abortedExecutions++;
              retryCounts[j]++;
              statuses[j] = TxStatus.PENDING;
              for (const wKey of transactions[j].writeSet || []) {
                const writers = mvds.get(String(wKey));
                if (writers) {
                  const pos = writers.indexOf(j);
                  if (pos !== -1) writers.splice(pos, 1);
                }
              }
            }
          }
        }
      }
    }

    // 5. Sequential Commit Phase (Commit unbroken prefix of validated transactions)
    let roundCommits = 0;
    while (committedCount < N && statuses[committedCount] === TxStatus.EXECUTED) {
      statuses[committedCount] = TxStatus.COMMITTED;
      committedCount++;
      roundCommits++;
    }

    executionTimeline.push({
      round: parallelCycles,
      committedTxCount: roundCommits,
      abortedTxCount: roundAborts,
    });
  }

  // Calculate metrics
  const abortRate = totalExecutions > 0 ? abortedExecutions / totalExecutions : 0;
  const abortCascadeDepth = Math.max(0, ...retryCounts);

  // Time modeling calibrated to Monad parallel EVM (10,000 TPS ceiling)
  const threadRatio = Math.max(1, threadCount / 16);
  const dtParallelSeconds = 0.00158 / threadRatio;
  const dtAbortSeconds = 0.00082;
  const simulatedTimeSeconds = Math.max(
    0.01,
    parallelCycles * dtParallelSeconds + abortedExecutions * dtAbortSeconds
  );

  const rawTps = Math.round(N / simulatedTimeSeconds);
  const effectiveTps = Math.min(targetMaxTps, Math.max(50, rawTps));

  // Speedup compared to sequential serialized execution
  const sequentialTimeSeconds = N * 0.0138;
  const speedupFactor = Number((sequentialTimeSeconds / simulatedTimeSeconds).toFixed(2));

  // Build slot contention stats
  const slotContention: Record<string, SlotContentionStats> = {};
  for (const [slot, stat] of slotStats.entries()) {
    const totalOps = stat.reads + stat.writes;
    slotContention[slot] = {
      slot,
      readCount: stat.reads,
      writeCount: stat.writes,
      conflictCount: stat.conflicts,
      contentionRatio: totalOps > 0 ? Number((stat.conflicts / totalOps).toFixed(3)) : 0,
    };
  }

  return {
    totalTransactions: N,
    totalExecutions,
    abortedExecutions,
    abortRate: Number(abortRate.toFixed(4)),
    abortCascadeDepth,
    parallelCycles,
    effectiveTps,
    speedupFactor,
    slotContention,
    executionTimeline,
  };
}
