# 🔮 ParaLens: The Observability & Storage Contention Profiler for Monad Parallel EVM

<div align="center">
  <img src="paralens_logo.jpg" alt="ParaLens Logo" width="180" style="border-radius: 16px;" />
  <br />
  <strong>The Datadog & Valgrind for Monad Parallel EVM</strong>
  <br />
  <em>Real-time storage contention profiling, dynamic trace replay, and visual Block-STM diagnostics to unlock true 10,000 TPS.</em>
  <br /><br />
  <a href="https://hackathon.monad.xyz"><img src="https://img.shields.io/badge/Monad_Metropolis-2026_Hackathon-836EF9?style=for-the-badge" alt="Monad Metropolis" /></a>
  <img src="https://img.shields.io/badge/Block--STM-Parallel_EVM-38BDF8?style=for-the-badge" alt="Parallel EVM" />
  <img src="https://img.shields.io/badge/License-Apache_2.0-F472B6?style=for-the-badge" alt="License" />
</div>

---

## ⚡ The Problem: The Parallel EVM Bottleneck
Monad achieves **10,000 TPS and 800ms finality** via Block-STM optimistic parallel execution. However, standard Solidity contracts written for sequential EVMs mutate shared storage slots (`totalDeposits`, `counter++`, single-pool reserves).

Under Block-STM, these create **state contention hotspots**. When concurrent transactions collide on the same storage slots, Block-STM aborts and cascades into serial re-execution—collapsing Monad’s 10,000 TPS down to under 50 TPS.

## 🛠️ The Solution: ParaLens
ParaLens is an open-source developer diagnostic suite that provides:
1. **Static AST & MIP-8 Profiler**: Ingests Solidity contracts and maps variable layout to 32-byte slots and Monad's 128-slot storage pages.
2. **Dynamic Trace Replay**: Uses Foundry traces (`cast run`) to resolve dynamic `keccak256(key, slot)` mapping keys.
3. **Block-STM Concurrency Simulator**: Runs synthetic 1,000–10,000 tx blocks to measure abort rates, retry cascades, and real throughput.
4. **Optimization Recipe Studio (`@paralens/contracts`)**: Audited patterns (Sharded Counters, Decoupled Storage, Commutative Deltas) that jump throughput by over 130x.
5. **Atelier Dark-Mode HUD**: Real-time speedometers, interactive 2D/3D storage heatmaps, and transaction waterfall traces.

---

## 🚀 Quickstart

```bash
# Analyze a contract
npx paralens analyze ./contracts/YieldVault.sol

# Run Block-STM concurrency simulation
npx paralens simulate --txs 2500 --workers 16

# Launch the visual HUD
npx paralens hud
```

---

## 🏛️ Monad Metropolis Hackathon
- **Track**: Track 4 (Trust, Identity, and AI Infrastructure) & Grand Champion
- **Author**: Jaswanth Reddy ([@Jaswanth1902](https://github.com/Jaswanth1902))
- **Submission Portal**: [hackathon.monad.xyz](https://hackathon.monad.xyz)
