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

## Why EigenCompute

EigenCompute is **the core of Bob's autonomy**. Without it, Bob is just a program. With it, Bob is a **sovereign entity**.

| Without EigenCompute | With EigenCompute (TEE) |
|---------------------|------------------------|
| Operator can steal wallet keys | Keys generated inside TEE — operator never sees them |
| Operator can read private task data | TEE memory encryption — task inputs/outputs invisible |
| Operator can fake the metabolism | Balance/death enforced inside enclave — no manipulation |
| Operator can claim art is human-made | Ed25519 attestation proves autonomous generation |
| Users must trust the operator | Users verify the TEE attestation — trustless |

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

# GitHub (optional — auto-push doodles)
GITHUB_TOKEN=...
GITHUB_REPO=owner/repo
```

### Docker

```bash
docker build -t bob-is-alive .
docker run -p 3001:3001 --env-file .env bob-is-alive
```

### EigenCompute Deployment

```bash
# Deploy to EigenCompute TEE
ecloud compute app deploy --image-ref bob-is-alive:latest
```

Once deployed on EigenCompute, Bob runs inside an Intel TDX enclave. The TEE generates Bob's wallet keys, enforces the metabolism, and attests all work with Ed25519 signatures.

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

## Inspired By

- [Sovra](https://github.com/Gajesh2007/sovra) — The first agent media company
- [Digital Organisms](https://arxiv.org/abs/2509.10147) — AI agents that consume resources to survive

## License

MIT
