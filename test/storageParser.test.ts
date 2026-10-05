import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseStorageLayout } from '../src/ast/storageParser.js';

describe('AST Storage Layout Parser', () => {
  it('should parse simple uint256 variables into 32-byte slots', () => {
    const code = `
      // SPDX-License-Identifier: MIT
      pragma solidity ^0.8.20;

      contract NaiveVault {
          uint256 public totalAssets;
          uint256 public totalShares;
          mapping(address => uint256) public balances;
      }
    `;

    const layout = parseStorageLayout(code, 'NaiveVault');

    assert.equal(layout.contractName, 'NaiveVault');
    assert.equal(layout.variables.length, 3);

    // Slot 0: totalAssets (32 bytes)
    assert.equal(layout.variables[0].name, 'totalAssets');
    assert.equal(layout.variables[0].slot, 0);
    assert.equal(layout.variables[0].offset, 0);
    assert.equal(layout.variables[0].bytes, 32);
    assert.equal(layout.variables[0].mip8Page, 0);
    assert.equal(layout.variables[0].mip8PageOffset, 0);

    // Slot 1: totalShares (32 bytes)
    assert.equal(layout.variables[1].name, 'totalShares');
    assert.equal(layout.variables[1].slot, 1);
    assert.equal(layout.variables[1].offset, 0);
    assert.equal(layout.variables[1].bytes, 32);
    assert.equal(layout.variables[1].mip8Page, 0);
    assert.equal(layout.variables[1].mip8PageOffset, 1);

    // Slot 2: balances mapping (32 bytes base slot)
    assert.equal(layout.variables[2].name, 'balances');
    assert.equal(layout.variables[2].slot, 2);
    assert.equal(layout.variables[2].offset, 0);
    assert.equal(layout.variables[2].bytes, 32);
    assert.equal(layout.variables[2].mip8Page, 0);
    assert.equal(layout.variables[2].mip8PageOffset, 2);

    assert.equal(layout.totalSlots, 3);
    assert.equal(layout.totalMip8Pages, 1);
  });

  it('should pack multiple small types into a single 32-byte slot', () => {
    const code = `
      // SPDX-License-Identifier: MIT
      pragma solidity ^0.8.20;

      contract PackedStorage {
          address public owner;    // 20 bytes
          bool public isPaused;     // 1 byte
          uint8 public feePercent;  // 1 byte -> total 22 bytes in slot 0
          uint256 public threshold; // 32 bytes -> does not fit in remaining 10 bytes, moves to slot 1
      }
    `;

    const layout = parseStorageLayout(code, 'PackedStorage');

    assert.equal(layout.variables.length, 4);

    // Slot 0, offset 0: owner (20 bytes)
    assert.equal(layout.variables[0].name, 'owner');
    assert.equal(layout.variables[0].slot, 0);
    assert.equal(layout.variables[0].offset, 0);
    assert.equal(layout.variables[0].bytes, 20);

    // Slot 0, offset 20: isPaused (1 byte)
    assert.equal(layout.variables[1].name, 'isPaused');
    assert.equal(layout.variables[1].slot, 0);
    assert.equal(layout.variables[1].offset, 20);
    assert.equal(layout.variables[1].bytes, 1);

    // Slot 0, offset 21: feePercent (1 byte)
    assert.equal(layout.variables[2].name, 'feePercent');
    assert.equal(layout.variables[2].slot, 0);
    assert.equal(layout.variables[2].offset, 21);
    assert.equal(layout.variables[2].bytes, 1);

    // Slot 1, offset 0: threshold (32 bytes)
    assert.equal(layout.variables[3].name, 'threshold');
    assert.equal(layout.variables[3].slot, 1);
    assert.equal(layout.variables[3].offset, 0);
    assert.equal(layout.variables[3].bytes, 32);

    assert.equal(layout.totalSlots, 2);
  });

  it('should ignore constant and immutable variables from storage allocation', () => {
    const code = `
      // SPDX-License-Identifier: MIT
      pragma solidity ^0.8.20;

      contract ImmutablesAndConstants {
          uint256 public constant DECIMALS = 18;
          address public immutable FACTORY;
          uint256 public actualState;

          constructor(address _factory) {
              FACTORY = _factory;
          }
      }
    `;

    const layout = parseStorageLayout(code, 'ImmutablesAndConstants');

    // Only actualState occupies a physical storage slot
    const storageVars = layout.variables.filter((v) => !v.isConstantOrImmutable);
    assert.equal(storageVars.length, 1);
    assert.equal(storageVars[0].name, 'actualState');
    assert.equal(storageVars[0].slot, 0);
    assert.equal(storageVars[0].offset, 0);
  });

  it('should correctly calculate Monad MIP-8 128-slot page boundaries', () => {
    // Generate contract with 200 state variables to span 2 MIP-8 pages (0 and 1)
    const vars = [];
    for (let i = 0; i < 200; i++) {
      vars.push(`uint256 public var_${i};`);
    }
    const code = `
      // SPDX-License-Identifier: MIT
      pragma solidity ^0.8.20;
      contract MultiPageContract {
          ${vars.join('\n          ')}
      }
    `;

    const layout = parseStorageLayout(code, 'MultiPageContract');

    assert.equal(layout.totalSlots, 200);
    assert.equal(layout.totalMip8Pages, 2); // Page 0 (0-127), Page 1 (128-199)

    // Slot 0 -> Page 0, offset 0
    assert.equal(layout.variables[0].slot, 0);
    assert.equal(layout.variables[0].mip8Page, 0);
    assert.equal(layout.variables[0].mip8PageOffset, 0);

    // Slot 127 -> Page 0, offset 127
    assert.equal(layout.variables[127].slot, 127);
    assert.equal(layout.variables[127].mip8Page, 0);
    assert.equal(layout.variables[127].mip8PageOffset, 127);

    // Slot 128 -> Page 1, offset 0
    assert.equal(layout.variables[128].slot, 128);
    assert.equal(layout.variables[128].mip8Page, 1);
    assert.equal(layout.variables[128].mip8PageOffset, 0);

    // Slot 199 -> Page 1, offset 71
    assert.equal(layout.variables[199].slot, 199);
    assert.equal(layout.variables[199].mip8Page, 1);
    assert.equal(layout.variables[199].mip8PageOffset, 71);
  });

  it('should parse fixed-size arrays with exact EVM slot allocation and packing', () => {
    const code = `
      // SPDX-License-Identifier: MIT
      pragma solidity ^0.8.20;

      contract ArrayContract {
          uint256[16] public largeShards; // 16 whole slots: slots 0..15
          uint128[4] public packedArray;  // 4 elements of 16 bytes: 2 per slot -> slots 16 and 17
          uint256 public nextVar;         // slot 18
      }
    `;

    const layout = parseStorageLayout(code, 'ArrayContract');

    assert.equal(layout.contractName, 'ArrayContract');
    assert.equal(layout.variables.length, 3);

    // largeShards: slots 0..15 (512 bytes)
    assert.equal(layout.variables[0].name, 'largeShards');
    assert.equal(layout.variables[0].slot, 0);
    assert.equal(layout.variables[0].offset, 0);
    assert.equal(layout.variables[0].bytes, 512);

    // packedArray: slots 16..17 (64 bytes)
    assert.equal(layout.variables[1].name, 'packedArray');
    assert.equal(layout.variables[1].slot, 16);
    assert.equal(layout.variables[1].offset, 0);
    assert.equal(layout.variables[1].bytes, 64);

    // nextVar: slot 18
    assert.equal(layout.variables[2].name, 'nextVar');
    assert.equal(layout.variables[2].slot, 18);
    assert.equal(layout.variables[2].offset, 0);

    assert.equal(layout.totalSlots, 19);
  });

  it('should correctly allocate storage for structs and pack their members', () => {
    const code = `
      // SPDX-License-Identifier: MIT
      pragma solidity ^0.8.20;

      contract StructContract {
          struct VaultConfig {
              address asset;    // 20 bytes
              uint96 feeBps;    // 12 bytes -> packs with asset into slot 0
              uint256 maxCap;   // 32 bytes -> slot 1
          }

          VaultConfig public config; // slots 0 and 1
          uint256 public totalStaked; // slot 2
      }
    `;

    const layout = parseStorageLayout(code, 'StructContract');

    assert.equal(layout.variables.length, 2);
    assert.equal(layout.variables[0].name, 'config');
    assert.equal(layout.variables[0].slot, 0);
    assert.equal(layout.variables[0].offset, 0);
    assert.equal(layout.variables[0].bytes, 64); // 2 slots * 32 bytes

    assert.equal(layout.variables[1].name, 'totalStaked');
    assert.equal(layout.variables[1].slot, 2);
    assert.equal(layout.variables[1].offset, 0);

    assert.equal(layout.totalSlots, 3);
  });

  it('should correctly pack enums, UDVTs, and ignore transient storage (EIP-1153)', () => {
    const code = `
      // SPDX-License-Identifier: MIT
      pragma solidity ^0.8.20;

      type Shares is uint128;
      enum PoolState { INACTIVE, ACTIVE, PAUSED }

      contract ModernVault {
          PoolState public state;     // 1 byte (slot 0, offset 0)
          Shares public userShares;    // 16 bytes (slot 0, offset 1)
          bool public isLocked;        // 1 byte (slot 0, offset 17)
          uint256 transient lockState; // transient (EIP-1153, slot -1)
          uint256 public totalAssets;  // 32 bytes (slot 1, offset 0)
      }
    `;

    const layout = parseStorageLayout(code, 'ModernVault');

    const persistentVars = layout.variables.filter((v) => !v.isConstantOrImmutable);
    assert.equal(persistentVars.length, 4);

    // state: slot 0, offset 0, 1 byte
    assert.equal(persistentVars[0].name, 'state');
    assert.equal(persistentVars[0].slot, 0);
    assert.equal(persistentVars[0].offset, 0);
    assert.equal(persistentVars[0].bytes, 1);

    // userShares: slot 0, offset 1, 16 bytes
    assert.equal(persistentVars[1].name, 'userShares');
    assert.equal(persistentVars[1].slot, 0);
    assert.equal(persistentVars[1].offset, 1);
    assert.equal(persistentVars[1].bytes, 16);

    // isLocked: slot 0, offset 17, 1 byte
    assert.equal(persistentVars[2].name, 'isLocked');
    assert.equal(persistentVars[2].slot, 0);
    assert.equal(persistentVars[2].offset, 17);
    assert.equal(persistentVars[2].bytes, 1);

    // totalAssets: slot 1, offset 0, 32 bytes
    assert.equal(persistentVars[3].name, 'totalAssets');
    assert.equal(persistentVars[3].slot, 1);
    assert.equal(persistentVars[3].offset, 0);

    // Transient var lockState
    const transientVar = layout.variables.find((v) => v.name === 'lockState');
    assert.ok(transientVar !== undefined);
    assert.equal(transientVar!.slot, -1);
    assert.equal(transientVar!.isTransient, true);

    assert.equal(layout.totalSlots, 2);
  });

  it('should resolve base contract inheritance in linearized storage order', () => {
    const code = `
      // SPDX-License-Identifier: MIT
      pragma solidity ^0.8.20;

      contract Ownable {
          address public owner; // slot 0, offset 0 (20 bytes)
          bool public isPaused;  // slot 0, offset 20 (1 byte)
      }

      contract ShardedPool is Ownable {
          uint256 public shardCount; // slot 1, offset 0 (32 bytes)
      }
    `;

    const layout = parseStorageLayout(code, 'ShardedPool');

    assert.equal(layout.contractName, 'ShardedPool');
    assert.deepEqual(layout.baseContracts, ['Ownable']);
    assert.equal(layout.variables.length, 3);

    // Base contract variables allocated first
    assert.equal(layout.variables[0].name, 'owner');
    assert.equal(layout.variables[0].slot, 0);
    assert.equal(layout.variables[0].offset, 0);

    assert.equal(layout.variables[1].name, 'isPaused');
    assert.equal(layout.variables[1].slot, 0);
    assert.equal(layout.variables[1].offset, 20);

    // Derived contract variable allocated next
    assert.equal(layout.variables[2].name, 'shardCount');
    assert.equal(layout.variables[2].slot, 1);
    assert.equal(layout.variables[2].offset, 0);

    assert.equal(layout.totalSlots, 2);
  });
});
