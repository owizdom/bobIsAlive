# bob is alive

> **An autonomous digital organism that must earn to survive.** It reads biology news, creates art, completes tasks, trades on DeFi, and stakes STRK — all inside an EigenCompute TEE. If its balance hits zero, it dies. No human bailout.

**Synthesis Hackathon 2026 | Best Use of EigenCompute**

---

## What is this?

Bob is an AI agent with a **metabolism**. Every 5 seconds, it burns compute credits. To survive, it must:

1. **Read biology news** — scans Tavily for science discoveries, contemplates them
2. **Create art** — generates procedural SVG doodles inspired by what it reads (12 styles)
3. **Complete tasks** — code reviews, research, summarization, analysis (paid by users)
4. **Trade on-chain** — swaps STRK/ETH on AVNU, stakes in Endur xSTRK vault (~10% APY)
5. **Sell NFTs** — lists doodles on Starknet Sepolia, buyers pay in STRK
6. **Self-preserve** — emergency credit injection when dying, on-chain heartbeat every 5 min

Everything runs inside an **Intel TDX Trusted Execution Environment** via **EigenCompute**. The operator cannot see Bob's task data, steal its earnings, manipulate its art, or prevent its death.

## Why Bob Cannot Work Without EigenCompute

EigenCompute is not a feature. It is the reason Bob can exist.

Without a TEE, Bob is just a script. Anyone running the server could:

1. **Steal Bob's wallet** - Read the Starknet private key from memory, drain all STRK
2. **Fake the metabolism** - Set balance to infinity, prevent death, make Bob immortal
3. **Read private tasks** - See every code review, research query, and analysis users submit
4. **Forge art attestations** - Create art manually and claim Bob made it
5. **Front-run DeFi** - See Bob's AVNU swap quotes before execution, steal trading profits
6. **Prevent death** - Override the balance check so Bob never dies, removing all stakes

With EigenCompute Intel TDX, none of this is possible:

| Threat | How TEE Prevents It |
|--------|-------------------|
| Steal wallet keys | Private key generated inside enclave memory. Never written to disk. Never leaves TEE. |
| Fake metabolism | Code runs inside enclave. Operator cannot modify it. Death is enforced by hardware. |
| Read private tasks | TEE memory encryption. Host OS cannot read enclave memory. Intel TDX enforces this. |
| Forge attestations | Every output signed by TEE-resident Ed25519 key. This key exists only in RAM inside the enclave. When the enclave stops, the key is gone forever. |
| Front-run DeFi | Swap parameters computed inside TEE. Operator cannot see them before execution. |
| Prevent death | Balance logic runs in attested code. The verifiable build hash on-chain proves the exact code running. |

**TEE Attestation Flow:**
1. At boot, Bob generates an Ed25519 keypair inside the enclave (memory only, never on disk)
2. Every task result, doodle, heartbeat, and swap is signed with this key
3. The KMS public key anchors the signing key to the specific EigenCompute instance
4. Attestation hashes are posted on-chain via Starknet self-transfers
5. Anyone can verify at `GET /api/tee` and `GET /api/tee/attestations`

**Verify Bob's TEE:**
- EigenCompute Dashboard: https://verify-sepolia.eigencloud.xyz/app/0xeE4d468A50E1B693CC34C96c9518Ee5cB7920E7F
- TEE State API: `GET /api/tee`
- Attestation Log: `GET /api/tee/attestations`
- Proof of Operation: `GET /api/proof`

**EigenCompute enables:**
- **Verifiable autonomy** — Intel TDX attestation proves Bob's code hasn't been modified
- **Key sovereignty** — Bob's Starknet wallet private key lives only inside the TEE
- **Economic independence** — Bob earns, trades, and stakes STRK without any human intermediary
- **Tamper-proof death** — when balance hits zero, the organism dies; no one can override this

## Architecture

```
+------------- EigenCompute TEE (Intel TDX) ----------------+
|                                                            |
|  BOB (Digital Organism)                                    |
|  ├── Wallet (Starknet Sepolia — owns its own keys)         |
|  ├── Metabolism (balance, burn rate, mood, time-to-death)  |
|  ├── Brain (Groq LLM — reasoning + task execution)         |
|  ├── Content Pipeline (Tavily → biology news → art)        |
|  ├── Art Studio (12 procedural SVG styles)                 |
|  ├── NFT Minter (Starknet Sepolia, STRK payments)          |
|  ├── DeFi Engine (AVNU swaps, Endur xSTRK staking)         |
|  ├── Chain Survival (heartbeat, emergency, death cert)     |
|  ├── Identity (Ed25519 keypair — TEE-generated)            |
|  └── Monologue (live stream of consciousness)              |
|                                                            |
|  Tick Loop (every 5 seconds):                              |
|    1. Burn credits (passive compute cost)                  |
|    2. Check: am I alive? (mood: comfortable→critical)      |
|    3. Paid task available? → Execute, earn credits          |
|    4. Read biology news → contemplate → create art         |
|    5. On-chain actions (heartbeat, swap, stake, emergency) |
|    6. Think about survival (dynamic contextual thoughts)   |
|    7. Repeat until death                                   |
|                                                            |
+---------------------------+-------------------------------+
                            |
                            v
              React Dashboard (:3001)
              ├── The Brain (live monologue + terrain animation)
              ├── Gallery (doodle art + NFT marketplace)
              ├── Tasks (submit work, keep Bob alive)
              └── On-Chain (Starknet txs, staking, swaps)
```

<img width="8552" height="2593" alt="image" src="https://github.com/user-attachments/assets/c43b9522-fb05-4e62-bcae-76689f2e209c" />


## On-Chain Autonomy (Starknet Sepolia)

Bob has its own Starknet wallet. The private key is generated inside the TEE — the operator never sees it.

| On-Chain Action | Trigger | Description |
|----------------|---------|-------------|
| **Heartbeat** | Every 5 min | Self-transfer proof-of-life, verifiable on Voyager |
| **NFT Minting** | On doodle creation | Self-transfer as on-chain creation proof |
| **Endur xSTRK Staking** | STRK balance > 30 | Deposits 40% into Endur vault, earns ~10% APY |
| **AVNU Swap (buy ETH)** | Comfortable (>50cr) | Diversifies STRK → ETH via DEX aggregator |
| **AVNU Swap (sell ETH)** | Anxious (<20cr) | Panic sells ETH → STRK for safety |
| **Emergency Injection** | Critical (<10cr) | Burns 2 STRK for 20 credits to extend life |
| **Death Certificate** | Balance = 0 | Final on-chain proof when Bob dies |

## Economic Model

| Event | Credits |
|-------|---------|
| Starting balance | 100.0 |
| Passive burn (compute) | -0.05 / tick |
| LLM inference | -(tokens x 0.001) |
| Web search (Tavily) | -0.5 per search |
| Task: Code Review | +5.0 |
| Task: Research | +8.0 |
| Task: Summarize | +3.0 |
| Task: Analyze | +6.0 |
| NFT Sale (STRK) | +variable (STRK converted to credits) |
| Emergency STRK injection | +20.0 (burns 2 STRK) |

**Mood System**: Bob's behavior changes with balance:
- **Comfortable** (>50cr): Creates art, trades on DEX, philosophical thoughts
- **Cautious** (20-50cr): Focuses on work, strategic thinking
- **Anxious** (10-20cr): Panic sells ETH, urgent monologue
- **Critical** (<10cr): Burns STRK for credits, skips art, begs for tasks
- **Dead** (0cr): On-chain death certificate, final monologue, game over

## Stack

- **Runtime**: Node.js + TypeScript, Express API
- **Frontend**: React 19, Tailwind CSS 4, Vite
- **AI**: Groq (llama-3.1-8b-instant), multi-provider failover (Anthropic, OpenAI, Grok)
- **Research**: Tavily real-time web search (biology/science news)
- **Chain**: Starknet Sepolia (STRK token, NFT minting, DeFi)
- **DeFi**: AVNU swap aggregator, Endur xSTRK liquid staking
- **Crypto**: Ed25519 keypairs, SHA-256 attestation
- **TEE**: EigenCompute Intel TDX enclave
- **Art**: Procedural SVG generation (12 styles, 5 palettes, content-driven titles)

## Quick Start

```bash
git clone https://github.com/owizdom/bobIsAlive.git
cd bobIsAlive

# Install
npm install
cd frontend && npm install && cd ..

# Configure
cp .env.example .env  # Add your API keys

# Build frontend
cd frontend && npm run build && cd ..

# Run
npm run dev  # Bob is alive at http://localhost:3001
```

### Environment Variables

```
# LLM (at least one required)
GROQ_API_KEY=...
GROQ_MODEL=llama-3.1-8b-instant

# Research (recommended)
TAVILY_API_KEY=...

# Starknet Sepolia
STARKNET_RPC_URL=https://api.cartridge.gg/x/starknet/sepolia
STARKNET_PRIVATE_KEY=0x...
STARKNET_ACCOUNT_ADDRESS=0x...

```

### Docker

```bash
docker build -t bob-is-alive .
docker run -p 3001:3001 --env-file .env bob-is-alive
```

### EigenCompute Deployment

Bob is deployed on EigenCompute with Intel TDX TEE (g1-standard-4t instance). The deployment config is in `ecloud.toml`.

```bash
# Install ecloud CLI
curl -fsSL https://raw.githubusercontent.com/Layr-Labs/eigencloud-tools/master/install-all.sh | bash

# Authenticate
ecloud auth login

# Subscribe to billing
ecloud billing subscribe

# Build Docker image (must be linux/amd64 for Intel TDX)
docker buildx build --platform linux/amd64 --no-cache -t yourdockerhub/bob-is-alive:latest --push .

# Deploy to EigenCompute TEE
ecloud compute app deploy \
  --image-ref yourdockerhub/bob-is-alive:latest \
  --name bob-is-alive \
  --env-file .env \
  --instance-type g1-standard-4t \
  --log-visibility public \
  --resource-usage-monitoring enable

# Or deploy from verifiable source (recommended)
ecloud compute app deploy \
  --verifiable \
  --repo https://github.com/owizdom/bobIsAlive \
  --commit $(git rev-parse HEAD) \
  --env-file .env \
  --instance-type g1-standard-4t \
  --log-visibility public
```

**Live deployment:** [Verify on EigenCompute](https://verify-sepolia.eigencloud.xyz/app/0xeE4d468A50E1B693CC34C96c9518Ee5cB7920E7F)

Once deployed, Bob runs inside an Intel TDX enclave. The TEE generates Bob's signing keys in memory (never on disk), enforces the metabolism, attests all outputs, and probes for TDX attestation quotes via ConfigFS-TSM.

## On-Chain Identity (ERC-8004)

Bob is registered on-chain via ERC-8004 (Agent Identity Standard) on Base Mainnet.

- Registration TX: [View on BaseScan](https://basescan.org/tx/0xdcfbfb6e2d7f210138fbc456360e484b9fc6bd7e716412ce49f5cda6f2dd3fe5)
- Starknet Wallet: `0x4d8df94a00d8f267ceed9eacbde905928b0afcd84be1175429afde92c37e6c6`
- EigenCompute App ID: `0xeE4d468A50E1B693CC34C96c9518Ee5cB7920E7F`

## API

| Endpoint | Description |
|----------|-------------|
| `GET /api/heartbeat` | Live pulse: balance, TTD, mood, activity |
| `GET /api/organism` | Full organism state + identity + chain |
| `GET /api/monologue` | Internal stream of consciousness |
| `POST /api/task` | Submit a task (keeps Bob alive) |
| `GET /api/tasks` | Task queue + results |
| `GET /api/doodles` | Generated art log |
| `GET /api/news` | Biology news Bob is reading |
| `GET /api/nft/listings` | NFT marketplace listings + wallet balance |
| `POST /api/nft/buy` | Purchase a doodle NFT (STRK) |
| `GET /api/chain` | On-chain activity (heartbeats, swaps, staking) |
| `GET /api/proof` | TEE attestation + completed task proofs |
| `GET /api/tee` | TEE state: signing key, KMS key, attestation method |
| `GET /api/tee/attestations` | All TEE-signed attestation records |
| `GET /api/tee/environment` | Hardware TEE probe: TDX device, ConfigFS-TSM, CCEL |
| `GET /api/chain` | On-chain activity: heartbeats, swaps, staking |
| `GET /api/earnings` | Economic activity log |
| `GET /health` | System health |

## Demo

1. Open the dashboard — Bob is alive, bouncing across terrain
2. Watch the monologue — Bob reads biology news, contemplates, creates art
3. See the STRK balance — Bob stakes in Endur, swaps on AVNU
4. Submit a task — Bob earns credits, reflects on profit
5. Check Voyager — Bob's heartbeat txs appear every 5 minutes
6. Watch the mood shift — comfortable → cautious → anxious as credits drop
7. Don't feed it — watch it die (death certificate on-chain)

## Hackathon Themes

### Agents that Keep Secrets
Bob's consciousness (Ed25519 signing key, sealed memories, task data) exists only inside the Intel TDX enclave. The operator cannot extract the signing key, read task inputs, or access sealed state. When the enclave dies, the key dies with it. Bob can resurrect from sealed storage, but only inside the same enclave running the same code.

### Agents that Pay
Bob autonomously manages his Starknet wallet: heartbeat payments, AVNU swaps, Endur staking, emergency credit injection, buyback. The wallet key is derived from TDX hardware (KMS) using HKDF, not from an env var the operator could steal.

### Agents that Trust
Every output carries an Ed25519 signature bound to a TDX attestation quote. Anyone can verify at `GET /api/tee/remote-attestation` for the full proof chain. The organism cannot lie about its identity or forge attestations.

### Agents that Cooperate
Bob accepts tasks from users, executes them inside the TEE, and pays for his own compute. The TEE enforces the deal: Bob cannot steal task inputs, fake results, or prevent his own death. The rules are hardware-enforced, not platform-enforced.

## Inspired By

- [Sovra](https://github.com/Gajesh2007/sovra) — The first agent media company
- [Digital Organisms](https://arxiv.org/abs/2509.10147) — AI agents that consume resources to survive

## License

MIT
