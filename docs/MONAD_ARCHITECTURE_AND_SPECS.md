# MONAD ARCHITECTURE & CORE GUIDES TECHNICAL DOSSIER
**Target Track:** Monad Metropolis Hackathon (Track 4: ParaLens)
**Source Authority:** Official Monad Documentation (docs.monad.xyz) & EIP-8004 Core Standards
**Scope:** Monad Execution & Runtime Architecture (MERA), x402 Micropayments, ERC-8004 Trustless Agents, Opcode Pricing & Developer Essentials

---

## SECTION 1: Monad Execution and Runtime Architecture (MERA)

### 1.1 Core Paradigm: Asynchronous Execution & Pipelining
Monad fundamentally decouples transaction consensus from execution, moving execution completely out of the consensus critical path into a dedicated, slightly-lagged execution swim lane.

* **The Interleaved Execution Bottleneck (Ethereum):**
  - In standard Ethereum, execution is interleaved synchronously with consensus.
  - The block proposer must execute all transactions in a candidate block, calculate state transitions, and generate the post-state Merkle root before broadcasting the proposal.
  - Validating nodes must execute every transaction to verify the proposed state root before voting.
  - As a result, execution is squeezed into ~100ms within a 12-second block window (~1% of total block time). Block gas limits must remain conservative (30M gas) to prevent worst-case execution stalls.

* **Asynchronous Execution (Monad):**
  - Monad separates consensus and execution into two concurrent swim lanes.
  - Consensus nodes vote and agree strictly on the **official linear ordering** of transactions in a block, without executing them first.
  - The leader proposes an ordering without knowing the resulting state root, and validators vote on validity without verifying execution outcomes.
  - Once transaction ordering is committed, execution proceeds asynchronously across the **full block time** (~400ms per block at 10,000 TPS).

* **Superscalar Pipelining:**
  - Operations are structured in pipelined stages: transaction gossiping, ordering consensus, parallel execution, and state commitment.
  - At slot N, validators execute consensus on Block N while workers concurrently execute Block N-1 and light clients verify proofs for Block N-D.

* **State Determinism Invariant:**
  - Determining the transaction order strictly fixes the post-state.
  - Reverting transactions (e.g., insufficient funds) are validly included; their failure outcome is 100% deterministic.

---

### 1.2 Optimistic Parallel Execution & Block-STM Worker Threading
Monad enforces strict serial equivalence: the final state after executing a block is bit-for-bit identical to traditional single-threaded serial execution, while utilizing multi-core CPU worker threads.

* **Optimistic Concurrency Control (OCC / Software Transactional Memory):**
  - Inspired by the Block-STM model, Monad assumes optimistically that transactions in a block do not conflict.
  - Transactions are dispatched across parallel worker threads. Worker threads execute transaction Tj before earlier transactions Ti (i < j) have finalized.

* **Input/Output Dependency Tracking:**
  - During execution, the runtime tracks the input read-set (accounts, balances, storage slots read) and output write-set (storage updates, balance modifications, log emissions).

* **Sequential Merge & Conflict Resolution:**
  - Speculative execution results are merged sequentially in strict block order.
  - If Tj read a state variable modified by Ti, a conflict is detected.
  - Tj speculative state changes are aborted and rolled back.
  - Tj is re-executed with updated state outputs from Ti.

* **State-Independent Work Caching:**
  - Computational work that does not depend on dynamic state—such as ECDSA signature recovery (ecrecover), transaction parsing, and intrinsic gas checks—is cached and never repeated upon re-execution.
  - Storage pages and account structures warmed in cache during the initial speculative run remain resident in memory, accelerating re-execution.

---

### 1.3 State Access Lifecycle & MonadDb
Disk I/O is the primary bottleneck in EVM blockchains. Standard clients embed an authenticated Merkle Patricia Trie inside general-purpose key-value databases (LevelDB, RocksDB, LMDB), causing nested lookups and severe read/write amplification. MonadDb addresses this from bare metal.

* **Native Merkle Patricia Trie Storage:**
  - MonadDb natively implements a Patricia Trie radix data structure both on disk and in memory, matching EVM state layout directly.

* **Storage Pages (MIP-8 Architecture):**
  - Storage slots are grouped into contiguous pages of 128 slots (4,096 bytes).
  - Trie leaf nodes store {page_index, page_commitment} pairs, where page_commitment is a BLAKE3 Merkle root over occupied slots.
  - Reading a single 32-byte slot reads the entire 4 KB page off the NVMe SSD, matching physical hardware block sizes.

* **Asynchronous I/O via Linux io_uring:**
  - Avoids blocking worker threads and eliminates thread-pool context switches by dispatching async I/O queues directly to kernel ring buffers.

* **Filesystem Bypass (Raw Block Device Access):**
  - Operators can run MonadDb directly on raw block devices (e.g. /dev/nvme0n1), bypassing filesystem metadata overhead, file allocation tables, fragmentation, and OS buffer caches.

* **Persistent Data Structures & MVCC:**
  - MonadDb uses an immutable/persistent trie. Updates write new branch nodes while retaining older versions.
  - Provides lock-free multi-version concurrency control (MVCC): a single execution writer operates alongside multiple concurrent readers (consensus checks, RPC queries).

* **Sequential SSD Writes & Inline Compaction:**
  - Updates are batched and written sequentially, matching SSD flash block erase geometries and minimizing write amplification.
  - Compaction runs inline with updates, pruning old versions and defragmenting physical blocks dynamically.

---

### 1.4 Deferred Execution Delay D (d = 3 Blocks)
Because consensus executes in advance of state transition computation:

* **Delayed Merkle Root:**
  - Block proposals for slot N do not include the state root for block N. Instead, proposals commit to the state root resulting from block N - D.
  - D is a constant systemwide delay factor: **D = 3** (also denoted as k = 3) on testnet and mainnet.

* **Consensus Finalization Lifecycle:**
  - Slot N: Block N proposed.
  - Slot N+2: Receiving a Quorum Certificate on a Quorum Certificate (QC-on-QC) finalizes the transaction order of Block N.
  - The network formally agrees that the consequence of Block N - D is Merkle root M. Light clients can then query Merkle proofs for state at N - D.

* **Divergence Recovery Protocol:**
  - If an individual validator node detects an execution error or Merkle root mismatch at Block N - D, it automatically rolls back its state to the end of Block N - D - 1 and re-executes forward.

* **Speculative RPC Execution:**
  - While block N is finalizing between slot N and N+2, full nodes speculatively execute it locally. RPC queries (eth_call, eth_estimateGas) can execute against the speculative state to provide zero-latency previews.

* **Newly-Funded Accounts Invariant:**
  - An account with zero balance that receives MON in block N cannot submit outbound transactions until D = 3 blocks have elapsed (~1.2 seconds under ~400ms block time).
  - Reason: Consensus checks gas limits against the D-block lagged view of the state. If the account attempted to transact earlier, consensus would perceive a 0 MON balance and reject the transaction.

---

### 1.5 Mera Passkey Infrastructure (@category-labs/mera)
mera is Monad official developer library for deriving persistent EVM accounts directly from Passkeys (WebAuthn / Passkeys):

* **Architecture:** Derives standard BIP-44 EVM EOAs from biometric authenticators (Face ID, Touch ID, 1Password, iCloud Keychain) using the WebAuthn PRF (Pseudo-Random Function) extension.
* **Zero Smart Wallet Overhead:** Accounts are ordinary EOAs. No contract deployments, ERC-4337 bundlers, paymasters, or MPC node networks are required.
* **Key Derivation Flow:**
  - Passkey Credential -> WebAuthn PRF -> 32-byte prfOutput -> BIP-39 Mnemonic -> BIP-32/BIP-44 HDKey (m/44'/60'/0'/0/0) -> Private Key / Address.
* **Core Functions:**
  - createPasskeyWithPrfOutput({ rp, user }): Registers a new passkey credential and returns prfOutput.
  - getPasskeyPrfOutput({ credentialId, rpId }): Retrieves prfOutput on returning visits.
* **React Native / Expo Integration:**
  - Package: @category-labs/mera >= 0.2.0, react-native-passkey.
  - Requires polyfilling Hermes engine with expo-crypto for crypto.getRandomValues.
  - Requires domain association (apple-app-site-association on iOS, assetlinks.json on Android) to share passkeys between Web and native apps.

---


## SECTION 2: x402 Micropayment Protocol & MPP Architecture

### 2.1 Overview & HTTP 402 Protocol Flow
x402 revives the HTTP status code `402 Payment Required` into a minimal, open, internet-native micropayment standard for APIs, LLM inference endpoints, and autonomous agent-to-agent transactions.

* **Why Monad for x402:** 10,000 TPS, ~400ms block times, sub-cent gas fees, and single-slot finality eliminate payment latency and transaction cost barriers that make micro-billing impractical on Ethereum.
* **Protocol Flow:**
  1. **Initial Client Request:** Client sends `GET /api/resource` without payment headers.
  2. **Server 402 Challenge:** Server intercepts the unauthenticated call and responds with HTTP status `402 Payment Required` containing a JSON requirement payload (price, accepted token, network, payTo address, scheme).
  3. **Client Signing:** Client signs an off-chain payment authorization (ERC-3009 or Permit2) with its private key.
  4. **Paid Request Resubmission:** Client resends `GET /api/resource` attaching the authorization and signature payload.
  5. **Verification & Unlocking:** Server verifies the cryptographic signature (either locally or via the Facilitator). Upon verification, server returns HTTP 200 with the protected resource.
  6. **Settlement:** Facilitator or server submits the payment on-chain asynchronously.

---

### 2.2 Payment Schemes & Canonical Proxy Contracts
The Monad x402 Facilitator supports two v2 payment schemes via `GET /supported`:

| Scheme ID | Target Use Case | Mechanism | Canonical Contract / Standard |
| :--- | :--- | :--- | :--- |
| **`v2-eip155-exact`** | Fixed-price payments (recommended for USDC) | ERC-3009 `transferWithAuthorization` directly on USDC, or Permit2 proxy fallback | ERC-3009 direct or `x402 ExactPermit2Proxy` |
| **`v2-eip155-upto`** | Metered / variable-amount compute (streaming LLM tokens, bandwidth) | Permit2 witness authorization; client authorizes maximum cap, facilitator settles actual usage <= max; supports $0 settlement (no on-chain tx) | `x402 UptoPermit2Proxy` |

#### Canonical Monad Addresses & Identifiers:
* **Facilitator API Base URL:** `https://x402-facilitator.molandak.org`
* **`x402 ExactPermit2Proxy`:** `0x402085c248EeA27D92E8b30b2C58ed07f9E20001`
* **`x402 UptoPermit2Proxy`:** `0x4020A4f3b7b90ccA423B9fabCc0CE57C6C240002`
* **Monad Testnet USDC Contract:** `0x534b2f3A21130d7a60830c2Df862319e593943A3`
* **Monad Testnet Network Identifier:** `eip155:10143` (Chain ID 10143)
* **Monad Mainnet Network Identifier:** `eip155:143` (Chain ID 143)

* **Facilitator HTTP Status Codes:**
  - `200 OK`: Request / verification / settlement succeeded.
  - `402 Payment Required`: Initial challenge returned to client.
  - `412 PRECONDITION_FAILED` (`PERMIT2_ALLOWANCE_REQUIRED`): Client has insufficient Permit2 allowance for the proxy contract.

---

### 2.3 Cryptographic Signature Verification (ERC-3009)
Under `v2-eip155-exact`, payments utilize native USDC ERC-3009 `TransferWithAuthorization` with EIP-712 structured signatures:

```typescript
// EIP-712 Domain for Monad Testnet USDC
const domain = {
  name: "USDC",             // Exact name defined in Monad USDC contract
  version: "2",
  chainId: 10143n,
  verifyingContract: "0x534b2f3A21130d7a60830c2Df862319e593943A3"
};

// EIP-712 Type Definition
const types = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" }
  ]
};
```

---

### 2.4 Facilitator API Endpoints
* **`GET /supported`**: Returns supported chains, tokens, schemes, and facilitator signer public addresses.
* **`POST /verify`**: Accepts client authorization and signature, verifies nonces, confirms token balance, and validates Permit2 allowances without executing an on-chain transaction.
* **`POST /settle`**: Broadcasts the on-chain transfer. **The Monad Facilitator pays all gas fees**, enabling completely gasless client experiences.

---

### 2.5 Machine Payments Protocol (`@monad-crypto/mpp`)
Monad official TypeScript framework for machine payments:

* **Push Mode:** Client broadcasts an on-chain ERC-20 transfer and passes the transaction hash as payment credential. (Client pays gas, common for browser wallets).
* **Pull Mode (Default for AI Agents & Private Keys):** Client signs an ERC-3009 authorization off-chain. Server broadcasts `receiveWithAuthorization` on-chain. (Server pays gas, zero client token friction).
* **Server Middleware Implementation (Hono / Node):**
  ```typescript
  import { monad } from "@monad-crypto/mpp/server";
  import { Mppx } from "mppx";
  import { Hono } from "hono";

  const app = new Hono();
  const mppx = Mppx.create({
    methods: [monad({ account: serverAccount, recipient: serverAccount.address, testnet: true })]
  });

  app.get("/premium-api", mppx.charge(), async (ctx) => {
    return ctx.json({ status: "success", data: "premium result" });
  });
  ```

---


## SECTION 3: ERC-8004 & Trust8004 (Trustless Autonomous Agents)

### 3.1 Architecture Overview
Authored by Marco De Rossi (MetaMask), Davide Crapis (Ethereum Foundation), Jordan Ellis (Google), and Erik Reppel (Coinbase).
ERC-8004 introduces an open, cross-organizational trust and discovery layer for autonomous AI agents via three on-chain singleton registries:

```
+---------------------------------------------------------------+
|                       ERC-8004 Architecture                  |
+---------------------------------------------------------------+
|  1. Identity Registry (ERC-721 + URIStorage)                  |
|     - Unique global ID: {namespace}:{chainId}:{registry}:{id} |
|     - Resolves to Agent Card JSON Schema                     |
+---------------------------------------------------------------+
|  2. Reputation Registry (Immutable Feedback Engine)           |
|     - On-chain signals: int128 value + uint8 decimals         |
|     - Categorization tags: tag1, tag2                         |
|     - Verifiable content hash & IPFS feedbackURI              |
+---------------------------------------------------------------+
|  3. Validation Registry (Cryptographic Verification)          |
|     - TEE Attestations (Intel SGX / Phala)                   |
|     - zkML Proofs & Stake-Secured Re-execution                |
+---------------------------------------------------------------+
```

---

### 3.2 Identity Registry & Agent Card Specification
Agents register by minting an ERC-721 NFT in the Identity Registry. The `tokenId` represents `agentId`. The `tokenURI` points to the Agent Card JSON:

* **Global Agent Identifier Format:** `{namespace}:{chainId}:{identityRegistry}` (e.g. `eip155:10143:0x...`) + `agentId`.
* **Agent Card JSON Schema (`https://eips.ethereum.org/EIPS/eip-8004#registration-v1`):**
  ```json
  {
    "$schema": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    "name": "ParaLensExecutionSentinel",
    "description": "Autonomous Monad parallel execution conflict detection agent",
    "image": "https://paralens.xyz/assets/agent.png",
    "services": [
      { "name": "web", "endpoint": "https://paralens.xyz/agent" },
      { "name": "A2A", "endpoint": "https://paralens.xyz/.well-known/agent-card.json", "version": "0.3.0" },
      { "name": "MCP", "endpoint": "https://mcp.paralens.xyz/sse", "version": "2025-06-18" },
      { "name": "ENS", "endpoint": "paralens.eth", "version": "v1" }
    ],
    "x402Support": true,
    "active": true,
    "registrations": [
      { "agentId": 1, "agentRegistry": "eip155:10143:0xIdentityRegistryAddress" }
    ],
    "supportedTrust": ["reputation", "crypto-economic", "tee-attestation"]
  }
  ```
* **Endpoint Domain Verification:** An agent can verify ownership of an HTTPS endpoint by hosting `https://{domain}/.well-known/agent-registration.json` with matching registrations.
* **On-Chain Metadata:** Registry includes `getMetadata(uint256 agentId, string metadataKey)` and `setMetadata(uint256 agentId, string metadataKey, bytes metadataValue)`.

---

### 3.3 Reputation Registry Interface & Standard Metrics
Clients submit permanent, immutable feedback post-interaction:

* **Solidity Interface:**
  ```solidity
  function giveFeedback(
      uint256 agentId,
      int128 value,
      uint8 valueDecimals,
      string calldata tag1,
      string calldata tag2,
      string calldata endpoint,
      string calldata feedbackURI,
      bytes32 feedbackHash
  ) external;
  ```
* **Feedback Constraints:**
  - Caller must NOT be the agent owner or approved operator.
  - `valueDecimals` must be between 0 and 18.
  - `feedbackHash` is keccak256 of the off-chain review payload (verifiable integrity).

* **Standard Reputation Metrics (`tag1`):**

| `tag1` Metric | Measured Property | Example Human Value | `value` | `valueDecimals` |
| :--- | :--- | :--- | :--- | :--- |
| **`starred`** | Quality rating (0–100 scale) | 92 / 100 | `92` | `0` |
| **`uptime`** | Endpoint availability percentage | 99.98% | `9998` | `2` |
| **`successRate`** | Execution success percentage | 97.5% | `975` | `1` |
| **`responseTime`** | Latency in milliseconds | 320 ms | `320` | `0` |
| **`blocktimeFreshness`** | Average block delay | 2 blocks | `2` | `0` |
| **`tradingYield`** | Trading performance (`tag2` = day/month) | +18.5% | `185` | `1` |
| **`revenues`** | Cumulative fee earnings | $4,500 | `4500` | `0` |

---

### 3.4 Validation Registry (Cryptographic Proofs)
Designed for high-stakes agent workflows (DeFi execution, data oracles, medical reasoning):
* **Validation Request:**
  ```solidity
  function validationRequest(
      address validatorAddress,
      uint256 agentId,
      string requestURI,
      bytes32 requestHash
  ) external;
  ```
* **Validation Response:**
  ```solidity
  function validationResponse(
      bytes32 requestHash,
      uint8 response,      // 0 to 100 (0=failed, 100=passed)
      string responseURI,
      bytes32 responseHash,
      string tag
  ) external;
  ```
* **Trust Models Supported:**
  - **TEE Attestations:** Intel SGX / Phala confidential execution proofs.
  - **zkML Proofs:** Zero-knowledge proofs of model inference accuracy.
  - **Stake-Secured Re-execution:** Cryptoeconomic validator re-runs.

---


## SECTION 4: Developer Essentials, Gas Pricing & Opcode Pricing

### 4.1 Key Differences from Ethereum
1. **Contract Size Limit:** Maximum deployed runtime bytecode is **128 KB** (vs 24 KB on Ethereum). Maximum contract creation initcode is **256 KB** (vs 48 KB on Ethereum).
2. **Blob Transactions Unsupported:** Transaction Type 3 (EIP-4844 blobs) is **NOT supported**.
3. **Local Mempool Architecture:** No global mempool. Transactions are forwarded directly to upcoming slot leaders via the **Local Mempool**.
4. **Historical State Pruning:** Due to 10,000 TPS volume, standard full nodes prune historical state. Full historical queries route to specialized archive nodes.

---

### 4.2 Comprehensive Opcode Pricing Table
Monad reprices specific opcodes to accurately reflect resource scarcity and prevent DoS attacks, while discounting computation relative to storage:

#### Cold vs Warm Access Costs:
| Access Type | Ethereum Gas | Monad Gas | Affected Opcodes |
| :--- | :--- | :--- | :--- |
| **Cold Account Access** | 2,600 gas | **10,100 gas** | `BALANCE`, `EXTCODESIZE`, `EXTCODECOPY`, `EXTCODEHASH`, `CALL`, `CALLCODE`, `DELEGATECALL`, `STATICCALL`, `SELFDESTRUCT` |
| **Warm Account Access** | 100 gas | **100 gas** | All account inspection/call opcodes |
| **Cold Storage Access** | 2,100 gas / slot | **8,100 gas / 128-slot page** | `SLOAD`, `SSTORE` |
| **Warm Storage Access** | 100 gas | **100 gas** | `SLOAD`, `SSTORE` |

#### Storage Page Accounting (MIP-8 / MONAD_TEN):
* Storage slots are grouped into contiguous pages of 128 slots: `page_index = slot >> 7`.
* Warmth is tracked per `(account, page)` tuple for the entire transaction.
* **`SLOAD` Pricing:**
  - First access to the 128-slot page: **8,100 gas**
  - Subsequent access to any slot in the same page: **100 gas**
* **`SSTORE` Component Pricing:**
  $$\text{Cost} = \text{Base}(100) + [\text{Page Load}(8,000)] + [\text{Page Write}(2,800)] + [\text{State Growth}(17,000)]$$
  - **Base:** 100 gas (charged on every `SSTORE`).
  - **Page Load:** 8,000 gas (charged on the first read or write access to the page).
  - **Page Write:** 2,800 gas (charged on the first `SSTORE` to the page that modifies a value).
  - **State Growth:** 17,000 gas (charged each time the page net occupied slot count reaches a new high-water mark).
  - Subsequent writes to an already-written page: **100 gas**.
  - *Note: Ethereum legacy 20,000 fresh slot and 2,900 overwrite charges are deprecated.*

#### Transient Storage (EIP-1153 Cancun Standard):
* **`TLOAD`:** **100 gas** (equivalent to hot `SLOAD`).
* **`TSTORE`:** **100 gas** (equivalent to warm `SSTORE`).
* Discarded at transaction end; bypasses storage page cold fees.

#### Linear Memory Expansion (MONAD_NINE):
| Metric | Ethereum Model | Monad Model |
| :--- | :--- | :--- |
| **Cost Formula** | $3w + \frac{w^2}{512}$ (Quadratic) | $\mathbf{\frac{w}{2}}$ **(Linear)**, where $w$ is 32-byte words |
| **Memory Limit** | Bounded only by gas limit | **8 MB (8,388,608 bytes) per transaction** |
| **Full 8 MB Expansion Cost**| Millions of gas | **131,072 gas** |
| **Frame Pool Accounting** | Frame-local | Cumulative pool across parent and child call frames |
| **Exceeding Cap** | Out of gas | Immediate frame halt, full frame gas consumed, state reverted |

#### Precompiles Repricing Schedule:
| Address | Precompile Name | Ethereum Gas | Monad Gas | Multiplier |
| :--- | :--- | :--- | :--- | :--- |
| `0x01` | **`ecRecover`** | 3,000 | **6,000** | 2x |
| `0x02` | **`sha256`** | 60 + 12/word | 60 + 12/word | 1x |
| `0x03` | **`ripemd160`** | 600 + 120/word | 600 + 120/word | 1x |
| `0x04` | **`identity`** | 15 + 3/word | 15 + 3/word | 1x |
| `0x05` | **`modexp`** | evm.codes | evm.codes | 1x |
| `0x06` | **`ecAdd`** | 150 | **300** | 2x |
| `0x07` | **`ecMul`** | 6,000 | **30,000** | 5x |
| `0x08` | **`ecPairing`** | 45k + 34k/point | **225,000 + 170,000/point** | 5x |
| `0x09` | **`blake2f`** | $\text{rounds} \times 1$ | $\mathbf{\text{rounds} \times 2}$ | 2x |
| `0x0a` | **`point_eval` (KZG)** | 50,000 | **200,000** | 4x |
| `0x0b`-`0x11` | **BLS12-381 Suite** | EIP-2537 standard | EIP-2537 standard | 1x |

---

### 4.3 Gas Billing & Reserve Balance Mechanism

* **Billing by Gas Limit (Anti-DoS Rule):**
  - Monad deducts gas fees based on the transaction **`gas_limit`**, not `gas_used`:
    $$\text{Total Deducted} = \text{value} + \text{gas\_bid} \times \text{gas\_limit}$$
  - *Under asynchronous execution, block leaders assemble blocks before execution. If billing used `gas_used`, an attacker could spam high-limit low-usage transactions to clog blocks without paying.*

* **Dynamic Base Fee Controller:**
  - Increases slower and decreases faster than Ethereum to avoid underutilized blockspace:
    $$\mathrm{block\_gas}_k = \sum_{\mathrm{tx} \in \mathrm{block}_k} \mathrm{gas\_limit}_{\mathrm{tx}}$$
    $$\mathrm{base\_price}_{k+1} = \max\left(\text{min\_base\_price}, \mathrm{base\_price}_k \cdot \exp\left(\eta_k \cdot \frac{\mathrm{block\_gas}_k - \text{target}}{\text{block\_gas\_limit} - \text{target}}\right)\right)$$
    $$\eta_k = \frac{\text{max\_step\_size} \cdot \epsilon}{\epsilon + \sqrt{\mathrm{moment}_k - \mathrm{trend}_k^2}}$$
    $$\mathrm{trend}_{k+1} = \beta \cdot \mathrm{trend}_k + (1 - \beta) \cdot (\text{target} - \mathrm{block\_gas}_k)$$
    $$\mathrm{moment}_{k+1} = \beta \cdot \mathrm{moment}_k + (1 - \beta) \cdot (\text{target} - \mathrm{block\_gas}_k)^2$$
  - **Parameters:** $\text{min\_base\_price\_per\_gas} = 100\text{ MON-gwei} \ (100 \times 10^{-9}\text{ MON})$, $\text{max\_step\_size} = 1/28$, $\text{target} = 160\text{M gas}$ (80% of 200M limit), $\beta = 0.96$, $\epsilon = 160\text{M}$.

* **Reserve Balance Mechanism:**
  - Compensates for the $k = 3$ ($D = 3$) block lag between consensus and execution.
  - **Systemwide Reserve Balance:** $10\text{ MON}$.
  - **Consensus Inflight Rules:** Consensus ensures an EOA has enough balance in the lagged state to cover the `gas_limit` of all inflight transactions ($< k$ blocks old).
  - **Execution Revert Rules:** Reverts if an EOA balance dips below $10\text{ MON}$ during value transfers, protecting the gas budget of in-flight transactions.
  - **Formal Verification:** Formally proven in Coq (`consensusAcceptableTxs`).

---

### 4.4 Custom Precompiles & EIP-7702

#### Custom Precompiles on Monad:
1. **`0x0100` (P256 Signature Verification - EIP-7951):**
   - Verifies `secp256r1` signatures for WebAuthn, Apple Secure Enclave, and Android Keystore passkeys on-chain.
   - Input: Exactly **160 bytes** (`[32B hash, 32B r, 32B s, 32B qx, 32B qy]`).
   - Output: `0x0000...0001` (32 bytes) on success; empty bytes on failure.
   - Gas cost: **6,900 gas**.
2. **`0x1000` (Staking Precompile):**
   - Handles validator staking, delegations, undelegations, and reward claims.
   - Constraint: Must be called via **`CALL` only** (`STATICCALL`, `DELEGATECALL`, and `CALLCODE` revert).
3. **`0x1001` (Reserve Balance Precompile):**
   - Method: `dippedIntoReserve()` (Selector: `0x3a61584e`, gas cost **100**).
   - Constraint: Must be called via **`CALL` only**. Returns `bool` indicating if execution is in reserve balance violation.

#### EIP-7702 Delegation Rules on Monad:
Monad natively supports EIP-7702 Type 4 (`0x04`) transactions to attach smart contract code to EOAs without migration:
* Code deployed at EOA: `0xef0100` (3 bytes) + `smart_contract_address` (20 bytes).
* **Invariant 1 (10 MON Reserve Floor):** When an EOA is EIP-7702-delegated, transactions that would reduce its balance below **10 MON** unconditionally revert.
* **Invariant 2 (CREATE / CREATE2 Prohibition):** When code executes within the context of an EIP-7702-delegated EOA, calling **`CREATE`** or **`CREATE2`** is strictly prohibited and causes the frame to revert.

---
