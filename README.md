# Swarm Mind — Autonomous Prediction Oracle

> Three AI agents. One TEE enclave. Provably independent predictions.

---

## The Problem With Prediction Market Oracles

Prediction markets live or die on oracle integrity. The history here is grim:

- **Augur (2015)** — first decentralized PM. Oracle worked by human vote. Economic collusion killed resolution integrity.
- **Gnosis** — improved mechanism design, same fundamental problem: at resolution, humans vote, and humans can be paid to lie.
- **Polymarket (now)** — solved liquidity brilliantly. Oracle still relies on UMA's optimistic dispute system: a 48-hour window where any economic actor with enough capital can mount a challenge. The oracle answer is whoever spends more last.
- **Chainlink price feeds** — pure price relay. Tells you a price, not a prediction. No reasoning, no independence guarantee.

The gap no one has closed: **verifiable independent reasoning**. Anyone can run multiple AI agents. The hard part is proving they reasoned independently and didn't just echo one another before committing.

---

## What Swarm Mind Does

One EigenCompute container runs three AI agents — **Nakamoto**, **Szabo**, and **Finney** — as embedded coroutines inside a single TEE enclave.

Each agent independently analyzes real crypto market data:
- CoinGecko price history, volatility, support/resistance levels
- Alternative.me Fear & Greed index
- 7-day trend classification

They commit their directional prediction (`bullish / bearish / neutral`) before seeing each other's work. Then they reveal simultaneously and synthesize a consensus oracle answer: **YES / NO / UNCERTAIN** + confidence.

```
┌─────────────────────────────────────────────────────────┐
│                  EigenCompute TEE Enclave                │
│                                                         │
│   [Nakamoto]    [Szabo]     [Finney]                    │
│    Technician  Macro       On-chain                     │
│                                                         │
│   EXPLORE ──── isolated channels ── no cross-talk       │
│      │                                                  │
│   COMMIT ───── each seals prediction w/ TEE keypair     │
│      │                                                  │
│   REVEAL ───── shared channel ── deliberate synthesis   │
│      │                                                  │
│   ORACLE ANSWER ──────────────────────────────────────► │
└─────────────────────────────────────────────────────────┘
```

**The oracle answer is the consensus of provably independent reasoning — not a price relay, not a human vote.**

---

## Why One Process Is Stronger Than Three

Traditional multi-agent systems use OS process isolation to enforce independence. Swarm Mind inverts this:

**Independence = TEE hardware isolation, not process isolation.**

Running all three agents in one TEE enclave means a single attestation quote covers all three. There is one code hash, one system prompt hash, one hardware keypair. The independence guarantee is stronger — not weaker — because the TEE *prevents the operator from injecting peer outputs into any agent's context during inference*, regardless of process boundaries.

---

## How Independence Is Proven — Three Hardware Layers

```
┌──────────────────────────────────────────────────────────────┐
│  Layer 1 — CODE INTEGRITY                                    │
│  Method: TDX attestation quote                               │
│  Proves: Exact model binary + exact system prompt ran here   │
│  Check:  GET /api/attestations → proof.layer1_codeIntegrity  │
├──────────────────────────────────────────────────────────────┤
│  Layer 2 — OPERATOR BLINDNESS                                │
│  Method: Intel TDX memory isolation                          │
│  Proves: Operator cannot read enclave memory or inject       │
│          peer outputs during agent inference                 │
│  Check:  proof.layer2_operatorBlindness.memoryIsolated       │
├──────────────────────────────────────────────────────────────┤
│  Layer 3 — OUTPUT BINDING                                    │
│  Method: Ed25519 hardware key signature                      │
│  Proves: This enclave, running that code, produced this      │
│          exact prediction and sealed it before reveal        │
│  Check:  GET /api/oracle → current.preCommitProofs           │
└──────────────────────────────────────────────────────────────┘
```

**Hardware-proven** (requires EigenCompute TDX):
- The binary that ran is exactly what was attested
- Operator cannot modify inputs or inject peer outputs

**Protocol-proven** (verifiable locally, always):
- Commitment timestamps predate reveal timestamps
- `sha256(sealedBlob)` matches `commitmentHash`
- Ed25519 signature is valid against agent's public key

---

## Quick Start

```bash
git clone https://github.com/your-org/swarm-mind
cd swarm-mind
cp .env.example .env          # add your LLM API key
npm install
npm run dev                   # single process, hot-reload

# Production (single-process, auto-restart)
npm run build && npm run supervise
```

Open `http://localhost:3001`

---

## Running on EigenCompute

Deploy the container. The TEE hardware generates a fresh Ed25519 keypair on boot and sets `EIGENCOMPUTE_INSTANCE_ID`.
`npm run supervise` is used by the container entrypoint, so the swarm restarts on process crash.

```bash
docker build -t swarm-mind .
# Deploy via EigenCompute dashboard → get instance ID

# Verify TEE mode is active
curl https://your-instance/api/attestations | jq '.[0].proof.layer1_codeIntegrity.status'
# → "active"
```

When `EIGENCOMPUTE_INSTANCE_ID` is set, all three proof layers are hardware-active. Without it (local dev), Layer 1 and Layer 2 report `"local-dev"` and Layer 3 is always active.

---

## API

All endpoints on one port (`3001`):

```bash
# Current oracle answer
curl localhost:3001/api/oracle | jq '.aggregated'

# Active prediction questions
curl localhost:3001/api/questions

# Three-layer TEE proof for all agents
curl localhost:3001/api/attestations | jq '.[0].proof'

# Per-agent state
curl localhost:3001/api/agents

# Collective synthesis report
curl localhost:3001/api/collective

# Evidence package (all pheromones + proofs)
curl localhost:3001/api/evidence

# Commit-reveal phase
curl localhost:3001/api/coordinator | jq '.cyclePhase'

# Inject a prediction question manually
curl -X POST localhost:3001/api/inject \
  -H "Content-Type: application/json" \
  -d '{"question": "Will ETH break $4000 before March 2026?"}'
```

---

## Verifying an Oracle Answer

```bash
# 1. Get the oracle answer and preCommitProofs
curl localhost:3001/api/oracle | jq '{answer: .current.answer, proofs: .current.preCommitProofs}'

# 2. Get each agent's sealed blob
curl localhost:3001/api/evidence | jq '.sealedBlobs'

# 3. Verify: hash sealed blob → should match commitmentHash
node -e "
  const crypto = require('crypto');
  const blob = /* paste sealedBlob JSON */;
  const hash = 'sha256:' + crypto.createHash('sha256').update(JSON.stringify(blob)).digest('hex');
  console.log(hash);  // compare to commitmentHash in preCommitProofs
"

# 4. Verify Ed25519 signature
# publicKey + signature + sealedBlobHash → independently verifiable
```

---

## Market Data Sources

| Source | Data |
|--------|------|
| CoinGecko `/api/v3/simple/price` | Spot price, 24h change, volume, market cap |
| CoinGecko `/api/v3/coins/{id}/market_chart` | 7-day price history, volatility, trend |
| Alternative.me Fear & Greed | Market sentiment index (0–100) |

No API keys required. Cache TTL: 5 minutes.

Topic model: active Polymarket question stream with optional fallback topic mapping for BTC/ETH/crypto symbols.

---

## Architecture

```
runner-orchestrator.ts          ← single process entry point
│
├── SwarmAgent × 3              ← Nakamoto, Szabo, Finney
│   ├── agent.ts                ← personality, identity, state
│   ├── thinker.ts              ← LLM calls, system prompt hash
│   ├── decider.ts              ← action selection
│   ├── executor.ts             ← market analysis actions
│   └── markets.ts              ← CoinGecko + Fear&Greed fetch
│
├── Phase loop (built-in)
│   ├── EXPLORE   subChannels[i]  ← isolated per-agent pheromones
│   ├── COMMIT    sealedBlobs[i]  ← per-agent TEE sealing
│   ├── REVEAL    sharedChannel   ← controlled cross-pollination
│   └── SYNTHESIS                 ← collective oracle answer
│
├── keystore.ts                 ← Ed25519 keypair per agent
├── persistence.ts              ← SQLite per agent
└── HTTP server (port 3001)     ← all endpoints consolidated
```

**Pheromone gossip** — agents leave typed signals (`prediction`, `correlation`, `sector_signal`) that peers absorb in the reveal phase. High-weight pheromones shift collective reasoning. No leader elects the final answer — it emerges from weighted vote.

---

## Agent Personalities

| Agent | Specialization | Key trait |
|-------|---------------|-----------|
| Nakamoto | Technical analysis | High curiosity — finds non-obvious price structure |
| Szabo | Macro analysis | High sociability — synthesizes cross-market signals |
| Finney | On-chain analysis | High diligence — traces capital flows and accumulation |

---

## References

- [Augur whitepaper (2015)](https://www.augur.net/whitepaper.pdf) — original decentralized prediction market
- [Polymarket](https://polymarket.com) — current liquidity leader
- [UMA optimistic oracle](https://umaproject.org) — Polymarket's dispute resolution layer
- [EigenCompute TEE documentation](https://docs.eigenlayer.xyz) — hardware attestation, TDX
- [Intel TDX overview](https://www.intel.com/content/www/us/en/developer/tools/trust-domain-extensions/overview.html)
- Lorenz (1963) — sensitivity to initial conditions; diversity of independent opinion reduces systemic error in prediction aggregation
