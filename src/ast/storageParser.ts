import parser from '@solidity-parser/parser';
import type {
  StorageVariable,
  ContractStorageLayout,
} from './types.js';

/**
 * Calculates byte size of a Solidity type string
 */
export function getTypeByteSize(typeStr: string): number {
  const clean = typeStr.trim();

  // Fixed size array: e.g. uint256[16], uint128[4], address[2]
  const arrayMatch = clean.match(/^(.+)\[(\d+)\]$/);
  if (arrayMatch) {
    const baseType = arrayMatch[1].trim();
    const len = parseInt(arrayMatch[2], 10);
    const baseSize = getTypeByteSize(baseType);
    if (baseSize >= 32) {
      return len * baseSize;
    }
    const elemsPerSlot = Math.floor(32 / baseSize);
    return Math.ceil(len / elemsPerSlot) * 32;
  }

  if (clean === 'bool') return 1;
  if (clean === 'address' || clean === 'address payable') return 20;

  // uint / int sizes
  const intMatch = clean.match(/^(?:u?int)(\d+)?$/);
  if (intMatch) {
    const bits = intMatch[1] ? parseInt(intMatch[1], 10) : 256;
    return Math.ceil(bits / 8);
  }

  // bytesN sizes
  const bytesMatch = clean.match(/^bytes(\d+)$/);
  if (bytesMatch) {
    return parseInt(bytesMatch[1], 10);
  }

  // dynamic bytes, string, mappings, and dynamic arrays default to 32 bytes base slot
  return 32;
}

/**
 * Resolves AST type name node to a readable type string and metadata
 */
function resolveTypeDetails(
  typeNameNode: any,
  enums: Map<string, number>,
  udvts: Map<string, string>,
  structs: Map<string, any>,
  interfaces: Set<string>
): {
  typeStr: string;
  byteSize: number;
  isFixedArray: boolean;
  arrayLength: number;
  baseTypeStr?: string;
  isStruct: boolean;
  structSlots?: number;
} {
  if (!typeNameNode) {
    return { typeStr: 'unknown', byteSize: 32, isFixedArray: false, arrayLength: 0, isStruct: false };
  }

  if (typeNameNode.type === 'ElementaryTypeName') {
    const name = typeNameNode.name;
    return {
      typeStr: name,
      byteSize: getTypeByteSize(name),
      isFixedArray: false,
      arrayLength: 0,
      isStruct: false,
    };
  }

  if (typeNameNode.type === 'Mapping') {
    const key = resolveTypeDetails(typeNameNode.keyType, enums, udvts, structs, interfaces).typeStr;
    const value = resolveTypeDetails(typeNameNode.valueType, enums, udvts, structs, interfaces).typeStr;
    return {
      typeStr: `mapping(${key} => ${value})`,
      byteSize: 32,
      isFixedArray: false,
      arrayLength: 0,
      isStruct: false,
    };
  }

  if (typeNameNode.type === 'ArrayTypeName') {
    const base = resolveTypeDetails(typeNameNode.baseTypeName, enums, udvts, structs, interfaces);
    let lenStr = '';
    let arrayLength = 0;
    if (typeNameNode.length) {
      if (typeNameNode.length.number) {
        lenStr = typeNameNode.length.number;
        arrayLength = parseInt(lenStr, 10);
      } else if (typeNameNode.length.value !== undefined) {
        lenStr = String(typeNameNode.length.value);
        arrayLength = parseInt(lenStr, 10);
      } else if (typeNameNode.length.name) {
        lenStr = typeNameNode.length.name;
      }
    }

    if (arrayLength > 0) {
      const typeStr = `${base.typeStr}[${arrayLength}]`;
      const byteSize = getTypeByteSize(typeStr);
      return {
        typeStr,
        byteSize,
        isFixedArray: true,
        arrayLength,
        baseTypeStr: base.typeStr,
        isStruct: false,
      };
    }

    return {
      typeStr: `${base.typeStr}[]`,
      byteSize: 32,
      isFixedArray: false,
      arrayLength: 0,
      isStruct: false,
    };
  }

  if (typeNameNode.type === 'UserDefinedTypeName') {
    const namePath = typeNameNode.namePath || 'UserDefined';

    // Check enums (1 byte)
    if (enums.has(namePath)) {
      const enumBytes = enums.get(namePath) || 1;
      return {
        typeStr: namePath,
        byteSize: enumBytes,
        isFixedArray: false,
        arrayLength: 0,
        isStruct: false,
      };
    }

    // Check UDVTs (type Shares is uint128)
    if (udvts.has(namePath)) {
      const underlying = udvts.get(namePath)!;
      return {
        typeStr: namePath,
        byteSize: getTypeByteSize(underlying),
        isFixedArray: false,
        arrayLength: 0,
        isStruct: false,
      };
    }

    // Check interfaces / contract references (20 bytes address)
    if (interfaces.has(namePath)) {
      return {
        typeStr: namePath,
        byteSize: 20,
        isFixedArray: false,
        arrayLength: 0,
        isStruct: false,
      };
    }

    // Check structs
    if (structs.has(namePath)) {
      const structNode = structs.get(namePath)!;
      const { structSlots, totalBytes } = computeStructLayout(structNode, enums, udvts, structs, interfaces);
      return {
        typeStr: namePath,
        byteSize: totalBytes,
        isFixedArray: false,
        arrayLength: 0,
        isStruct: true,
        structSlots,
      };
    }

    // Default user-defined type
    return {
      typeStr: namePath,
      byteSize: 32,
      isFixedArray: false,
      arrayLength: 0,
      isStruct: false,
    };
  }

  return { typeStr: 'unknown', byteSize: 32, isFixedArray: false, arrayLength: 0, isStruct: false };
}

/**
 * Computes slot count and byte size of a struct definition according to EVM packing rules
 */
function computeStructLayout(
  structNode: any,
  enums: Map<string, number>,
  udvts: Map<string, string>,
  structs: Map<string, any>,
  interfaces: Set<string>
): { structSlots: number; totalBytes: number } {
  let sSlot = 0;
  let sOffset = 0;

  for (const m of structNode.members || []) {
    const details = resolveTypeDetails(m.typeName, enums, udvts, structs, interfaces);
    if (details.isFixedArray || details.isStruct || details.byteSize >= 32) {
      if (sOffset > 0) {
        sSlot++;
        sOffset = 0;
      }
      const needed = details.structSlots || Math.ceil(details.byteSize / 32);
      sSlot += Math.max(1, needed);
      sOffset = 0;
    } else {
      if (sOffset + details.byteSize > 32) {
        sSlot++;
        sOffset = 0;
      }
      sOffset += details.byteSize;
      if (sOffset === 32) {
        sSlot++;
        sOffset = 0;
      }
    }
  }

  const structSlots = sOffset > 0 ? sSlot + 1 : Math.max(1, sSlot);
  return { structSlots, totalBytes: structSlots * 32 };
}

/**
 * Linearizes base contracts in root-to-derived order
 */
function linearizeContracts(
  targetName: string,
  contracts: Map<string, any>
): string[] {
  const result: string[] = [];
  const visited = new Set<string>();

  function dfs(name: string) {
    if (visited.has(name)) return;
    visited.add(name);

    const contractNode = contracts.get(name);
    if (contractNode && contractNode.baseContracts) {
      for (const base of contractNode.baseContracts) {
        const baseName = base.baseName?.namePath;
        if (baseName && contracts.has(baseName)) {
          dfs(baseName);
        }
      }
    }
    result.push(name);
  }

  dfs(targetName);
  return result;
}

/**
 * Parses Solidity source code and calculates physical storage layout and Monad MIP-8 pages
 */
export function parseStorageLayout(
  sourceCode: string,
  targetContractName?: string
): ContractStorageLayout {
  let ast: any;
  try {
    ast = parser.parse(sourceCode, { tolerant: true, loc: true });
  } catch (err: any) {
    throw new Error(`Solidity AST parse error: ${err.message || String(err)}`);
  }

  // Registry maps for user types
  const enums = new Map<string, number>();
  const udvts = new Map<string, string>();
  const structs = new Map<string, any>();
  const contracts = new Map<string, any>();
  const interfaces = new Set<string>();

  parser.visit(ast, {
    EnumDefinition(node: any) {
      enums.set(node.name, node.members?.length > 256 ? 2 : 1);
    },
    TypeDefinition(node: any) {
      if (node.definition?.name) {
        udvts.set(node.name, node.definition.name);
      }
    },
    StructDefinition(node: any) {
      structs.set(node.name, node);
    },
    ContractDefinition(node: any) {
      contracts.set(node.name, node);
      if (node.kind === 'interface') {
        interfaces.add(node.name);
      }
    },
  });

  const contractList = Array.from(contracts.values()).filter(
    (c) => c.kind === 'contract' || c.kind === 'abstract'
  );

  if (contractList.length === 0) {
    throw new Error('No contract definitions found in provided Solidity code');
  }

  // Match target contract or default to first contract
  const target = targetContractName
    ? contracts.get(targetContractName) || contractList[0]
    : contractList[0];

  const targetName = target.name;
  const linearizedNames = linearizeContracts(targetName, contracts);

  const variables: StorageVariable[] = [];
  const slotMap: Record<number, StorageVariable[]> = {};
  const pageMap: Record<number, number[]> = {};

  let currentSlot = 0;
  let currentOffset = 0; // 0..31

  // Process contracts in inheritance order (root base contracts first)
  for (const cName of linearizedNames) {
    const contractNode = contracts.get(cName);
    if (!contractNode) continue;

    for (const node of contractNode.subNodes || []) {
      if (node.type !== 'StateVariableDeclaration') continue;

      for (const v of node.variables || []) {
        const isConstOrImmutable = Boolean(v.isDeclaredConst || v.isImmutable);
        const isTransient = Boolean(v.isTransient);
        const details = resolveTypeDetails(v.typeName, enums, udvts, structs, interfaces);

        if (isConstOrImmutable || isTransient) {
          variables.push({
            name: v.name,
            type: details.typeStr,
            slot: -1,
            offset: -1,
            bytes: details.byteSize,
            mip8Page: -1,
            mip8PageOffset: -1,
            isConstantOrImmutable: true,
            isTransient,
          });
          continue;
        }

        let assignedSlot = currentSlot;
        let assignedOffset = currentOffset;
        let slotsOccupied = 1;

        if (details.isFixedArray) {
          // Array always starts at a new slot
          if (currentOffset > 0) {
            currentSlot++;
            currentOffset = 0;
          }
          assignedSlot = currentSlot;
          assignedOffset = 0;

          const elemByteSize = details.baseTypeStr ? getTypeByteSize(details.baseTypeStr) : 32;
          if (elemByteSize >= 32) {
            slotsOccupied = details.arrayLength * Math.ceil(elemByteSize / 32);
          } else {
            const perSlot = Math.floor(32 / elemByteSize);
            slotsOccupied = Math.ceil(details.arrayLength / perSlot);
          }

          currentSlot += slotsOccupied;
          currentOffset = 0; // Next item starts on new slot
        } else if (details.isStruct) {
          // Struct always starts at a new slot
          if (currentOffset > 0) {
            currentSlot++;
            currentOffset = 0;
          }
          assignedSlot = currentSlot;
          assignedOffset = 0;
          slotsOccupied = details.structSlots || 1;

          currentSlot += slotsOccupied;
          currentOffset = 0; // Next item starts on new slot
        } else if (details.byteSize >= 32) {
          // Align to slot boundary
          if (currentOffset > 0) {
            currentSlot++;
            currentOffset = 0;
          }
          assignedSlot = currentSlot;
          assignedOffset = 0;
          slotsOccupied = Math.ceil(details.byteSize / 32);

          currentSlot += slotsOccupied;
          currentOffset = 0;
        } else {
          // Value type < 32 bytes (uintN, intN, address, bool, enum, udvt)
          if (currentOffset + details.byteSize > 32) {
            currentSlot++;
            currentOffset = 0;
          }
          assignedSlot = currentSlot;
          assignedOffset = currentOffset;
          slotsOccupied = 1;

          currentOffset += details.byteSize;
          if (currentOffset === 32) {
            currentSlot++;
            currentOffset = 0;
          }
        }

        const mip8Page = Math.floor(assignedSlot / 128);
        const mip8PageOffset = assignedSlot % 128;

        const storageVar: StorageVariable = {
          name: v.name,
          type: details.typeStr,
          slot: assignedSlot,
          offset: assignedOffset,
          bytes: details.byteSize,
          mip8Page,
          mip8PageOffset,
          isConstantOrImmutable: false,
          isTransient: false,
        };

        variables.push(storageVar);

        // Populate slotMap and pageMap across all slots occupied by this variable
        for (let s = assignedSlot; s < assignedSlot + slotsOccupied; s++) {
          if (!slotMap[s]) {
            slotMap[s] = [];
          }
          slotMap[s].push(storageVar);

          const p = Math.floor(s / 128);
          if (!pageMap[p]) {
            pageMap[p] = [];
          }
          if (!pageMap[p].includes(s)) {
            pageMap[p].push(s);
          }
        }
      }
    }
  }

  const totalSlots = currentOffset > 0 ? currentSlot + 1 : currentSlot;
  const totalMip8Pages = totalSlots === 0 ? 0 : Math.floor((totalSlots - 1) / 128) + 1;

  return {
    contractName: targetName,
    variables,
    totalSlots,
    totalMip8Pages,
    pageMap,
    slotMap,
    baseContracts: linearizedNames.filter((n) => n !== targetName),
  };
}
