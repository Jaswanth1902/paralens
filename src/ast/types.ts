/**
 * ParaLens AST Storage Types
 * Conforms to Monad MIP-8 128-slot storage page specification
 */

export interface StorageVariable {
  name: string;
  type: string;
  slot: number;
  offset: number; // 0 to 31 bytes
  bytes: number; // Size in bytes
  mip8Page: number; // Math.floor(slot / 128)
  mip8PageOffset: number; // slot % 128
  isConstantOrImmutable: boolean;
  isTransient?: boolean;
}

export interface ContractStorageLayout {
  contractName: string;
  variables: StorageVariable[];
  totalSlots: number;
  totalMip8Pages: number;
  pageMap: Record<number, number[]>; // pageIndex -> array of slot numbers
  slotMap: Record<number, StorageVariable[]>; // slotNumber -> variables packed in that slot
  baseContracts?: string[];
}

export interface Mip8PageInfo {
  pageIndex: number;
  slotCount: number;
  slots: number[];
  variables: StorageVariable[];
}

export interface Mip8Hotspot {
  mip8Page: number;
  slot?: number;
  contentionScore: number; // 0.0 to 1.0
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  reason: string;
}

export interface Mip8ClassificationResult {
  totalPages: number;
  pages: Mip8PageInfo[];
  hotspots: Mip8Hotspot[];
  slotHotspots: Mip8Hotspot[];
}

export interface SlotAccessEvent {
  slot: number;
  accessFrequency: number;
  accessType: 'READ' | 'WRITE';
}
