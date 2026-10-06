/**
 * Types for Qwen 3.8 Max Auto-Refactoring Engine
 */

export interface ContentionDiagnostic {
  contractName: string;
  contendedSlot: number | string;
  variableName: string;
  conflictType: 'RAW_WRITE_COLLISION' | 'GLOBAL_ACCUMULATOR' | 'REENTRANCY_LOCK';
  currentTps: number;
  currentAbortRate: number;
}

export interface RefactorResult {
  engine: 'QWEN_3.8_MAX_LIVE' | 'DETERMINISTIC_RULES_ENGINE';
  originalCode: string;
  refactoredCode: string;
  diff: string;
  explanation: string;
  projectedTps: number;
  projectedAbortRate: number;
  appliedPattern: string;
}
