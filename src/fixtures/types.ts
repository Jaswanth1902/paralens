import type { Transaction } from '../simulator/types.js';

export interface VaultFixture {
  name: string;
  type: 'naive' | 'sharded';
  description: string;
  contractName: string;
  contractSource: string;
  totalTransactions: number;
  expectedAbortRate: number;
  expectedTps: number;
  shardsCount?: number;
  transactions: Transaction[];
}
