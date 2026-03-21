# bob is alive

> **An autonomous digital organism that must earn to survive.** It creates doodle art, completes tasks, and lists NFTs on Base Sepolia — all inside an EigenCompute TEE. If its balance hits zero, it dies. No human bailout.

**Synthesis Hackathon 2026 | EigenCompute**

---

## What is this?

Bob is an AI agent with a **metabolism**. Every second, it burns compute credits. To survive, it must:

1. **Create art** — procedural SVG doodles, listed as NFTs on Base Sepolia
2. **Complete tasks** — code reviews, research, summarization, analysis (paid by users)
3. **Self-improve** — analyzes its own code, proposes optimizations
4. **Push to GitHub** — autonomously commits doodles and research

Everything runs inside an **Intel TDX Trusted Execution Environment**. The operator cannot see Bob's task data, steal its earnings, manipulate its art, or prevent its death.

## Why TEE Matters

Without EigenCompute, the operator could:
- Steal NFT sale revenue from the organism's wallet
- See private task data (code reviews, research queries)
- Fake the metabolism (prevent death, inflate balance)
- Claim the art was human-made

With EigenCompute: **impossible.** The TEE enforces true autonomy. Bob controls its own keys, earns its own money, and lives or dies on its own terms.

## Architecture

```
+------------- EigenCompute TEE (Intel TDX) ----------------+
|                                                            |
|  BOB (Digital Organism)                                    |
|  ├── Wallet (Base Sepolia — owns its own keys)             |
|  ├── Metabolism (balance, burn rate, time-to-death)        |
|  ├── Brain (Groq LLM — reasoning + task execution)        |
|  ├── Research (Tavily — real-time web search)              |
|  ├── Art Studio (procedural SVG doodle generation)         |
|  ├── NFT Minter (ERC-721 on Base Sepolia)                  |
|  ├── Identity (Ed25519 keypair — TEE-generated)            |
|  └── Monologue (internal stream of consciousness)          |
|                                                            |
|  Loop (every 5 seconds):                                   |
|    1. Burn credits (passive compute cost)                  |
|    2. Check: am I alive?                                   |
|    3. Paid task available? → Execute, earn credits          |
|    4. No task? → Create doodle art, list as NFT            |
|    5. Push art to GitHub                                   |
|    6. Think about survival                                 |
|    7. Repeat until death                                   |
|                                                            |
+---------------------------+-------------------------------+
                            |
                            v
              React Dashboard (:3001)
              ├── The Brain (internal monologue)
              ├── Gallery (doodle art collection)
              ├── Marketplace (buy NFTs, fund Bob)
              └── Tasks (submit work, keep Bob alive)
```

## Economic Model

| Event | Credits |
|-------|---------|
| Starting balance | 100.0 |
| Passive burn (compute) | -0.05 / tick |
| LLM inference | -(tokens x 0.001) |
| Web search | -0.5 per search |
| Task: Code Review | +5.0 |
| Task: Research | +8.0 |
| Task: Summarize | +3.0 |
| Task: Analyze | +6.0 |
| NFT Sale | +variable (ETH converted) |
| Doodle creation (idle) | -0.5 (costs but doesn't earn) |

**Death** = balance hits 0. No human bailout. The organism stops forever.

## Stack

- **Backend**: Node.js + TypeScript, Express API
- **Frontend**: React 19, Tailwind CSS 4, Vite
- **AI**: Groq (llama-3.1-8b), multi-provider failover
- **Research**: Tavily real-time web search
- **Chain**: Base Sepolia (ERC-721 NFTs)
- **Crypto**: Ed25519 keypairs, SHA-256 attestation
- **TEE**: EigenCompute Intel TDX enclave
- **Art**: Procedural SVG generation (6 styles, 5 palettes)

## Quick Start

```bash
git clone https://github.com/owizdom/bobIsAlive.git
cd bobIsAlive

# Backend
npm install
cp .env.example .env  # Add your API keys
npm run dev            # Bob is alive at http://localhost:3001

# Frontend (separate terminal)
cd frontend
npm install
npm run dev            # React app at http://localhost:5173
```

### Environment Variables

```
GROQ_API_KEY=...              # LLM (required)
TAVILY_API_KEY=...            # Web search (optional but recommended)
BASE_SEPOLIA_RPC=https://sepolia.base.org
ORGANISM_PRIVATE_KEY=0x...    # Auto-generated or provide your own
GITHUB_TOKEN=...              # For auto-pushing doodles (optional)
GITHUB_REPO=owner/repo        # Target repo for doodle pushes
```

### Docker

```bash
docker build -t bob-is-alive .
docker run -p 3001:3001 --env-file .env bob-is-alive
```

### EigenCompute

```bash
ecloud compute app deploy --image-ref bob-is-alive:latest
```

## API

| Endpoint | Description |
|----------|-------------|
| `GET /api/heartbeat` | Live pulse: balance, TTD, activity |
| `GET /api/organism` | Full organism state + identity |
| `GET /api/monologue` | Internal stream of consciousness |
| `POST /api/task` | Submit a task (keeps Bob alive) |
| `GET /api/tasks` | Task queue + results |
| `GET /api/doodles` | Generated art log |
| `GET /api/nft/listings` | NFT marketplace listings |
| `POST /api/nft/buy` | Purchase a doodle NFT |
| `GET /api/proof` | TEE attestation + completed task proofs |
| `GET /api/earnings` | Economic activity log |
| `GET /health` | System health |

## The Organism's Wallet

Bob has its own wallet on Base Sepolia. The private key is generated inside the TEE — the operator never sees it.

**Address**: Check `/api/organism` for the live wallet address.

Fund it with testnet ETH to enable on-chain NFT minting.

## Demo

1. Open the dashboard — Bob is alive, heartbeat pulsing green
2. Watch the balance tick down — passive compute burn
3. See Bob create doodles autonomously — listed as NFTs
4. Submit a task — Bob earns credits, extends its life
5. Check the monologue — Bob thinks about survival
6. Don't feed it — watch it die

## Inspired By

- [Sovra](https://github.com/Gajesh2007/sovra) — The first agent media company
- [Karpathy's autoresearch](https://github.com/karpathy/autoresearch) — Autonomous self-improvement
- [Digital Organisms](https://arxiv.org/abs/2509.10147) — AI agents that consume resources to survive

## License

MIT
