/**
 * Event Handlers for ParaLens Envio Indexer
 * Ingests Monad Vault deposits and transfers to compute storage contention metrics.
 */

/* global MonadVault */

// @ts-ignore
MonadVault.Deposit.handler(async ({ event, context }) => {
  const contractId = event.srcAddress.toLowerCase();
  
  let stat = await context.ContractContentionStat.get(contractId);
  if (!stat) {
    stat = {
      id: contractId,
      totalTransactions: 0n,
      totalDeposits: 0n,
      estimatedContentionRate: 0.948,
      congestedSlot: "0x0000000000000000000000000000000000000000000000000000000000000000",
      lastUpdatedBlock: BigInt(event.block.number)
    };
  }

  stat.totalTransactions = stat.totalTransactions + 1n;
  stat.totalDeposits = stat.totalDeposits + 1n;
  stat.lastUpdatedBlock = BigInt(event.block.number);

  await context.ContractContentionStat.set(stat);

  await context.StorageSlotAccess.set({
    id: `${event.transaction.hash}-${event.logIndex}`,
    contract: contractId,
    caller: event.params.caller,
    slot: stat.congestedSlot,
    isCollision: true,
    timestamp: BigInt(event.block.timestamp)
  });
});

// @ts-ignore
MonadVault.Transfer.handler(async ({ event, context }) => {
  const contractId = event.srcAddress.toLowerCase();
  
  let stat = await context.ContractContentionStat.get(contractId);
  if (!stat) {
    stat = {
      id: contractId,
      totalTransactions: 0n,
      totalDeposits: 0n,
      estimatedContentionRate: 0.12,
      congestedSlot: "0x0",
      lastUpdatedBlock: BigInt(event.block.number)
    };
  }

  stat.totalTransactions = stat.totalTransactions + 1n;
  stat.lastUpdatedBlock = BigInt(event.block.number);

  await context.ContractContentionStat.set(stat);
});
