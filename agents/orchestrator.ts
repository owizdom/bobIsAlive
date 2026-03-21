/**
 * Digital Organism — Orchestrator
 *
 * Single process. One autonomous agent. Express API.
 * The organism ticks every 5 seconds, burning credits passively.
 * Users submit tasks via API. The organism completes them to earn credits.
 * If balance hits zero, it dies.
 *
 * On EigenCompute (TEE): the organism runs inside an Intel TDX enclave.
 * The operator cannot see task data, steal earnings, or manipulate results.
 */

import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";

import { DigitalOrganism } from "./organism";
import { submitTask, getAllTasks, getCompletedTasks, initLLMClient } from "./task-engine";
import { initThinker, getSystemPromptHash, getModelName, getActiveLLMProvider } from "./thinker";
import { initResearch, isSearchEnabled } from "./research";
import { buildAttestation } from "./keystore";
import type { LLMConfig, TaskType } from "./organism-types";
import { getDoodleLog, getImprovementLog } from "./self-work";
import { getRecentEntries } from "./monologue";
import { initNFT, isNFTEnabled, getWalletAddress, getWalletBalance, getListings, getAvailableListings, buyDoodle } from "./nft";
import { TASK_REWARDS } from "./organism-types";

// ── Config ───────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.AGENT_PORT || process.env.DASHBOARD_PORT || "3001");
const TICK_INTERVAL = parseInt(process.env.TICK_INTERVAL_MS || "5000");

// ── LLM Provider Resolution ──────────────────────────────────────────────────

function resolveLLMConfig(): LLMConfig | null {
  // Try providers in order
  const providers: Array<{ name: LLMConfig["provider"]; check: () => LLMConfig | null }> = [
    {
      name: "anthropic",
      check: () => process.env.ANTHROPIC_API_KEY ? {
        provider: "anthropic", apiUrl: "", apiKey: process.env.ANTHROPIC_API_KEY,
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
      } : null,
    },
    {
      name: "groq",
      check: () => process.env.GROQ_API_KEY ? {
        provider: "groq",
        apiUrl: process.env.GROQ_API_URL || "https://api.groq.com/openai/v1",
        apiKey: process.env.GROQ_API_KEY,
        model: process.env.GROQ_MODEL || "llama-3.1-8b-instant",
      } : null,
    },
    {
      name: "grok",
      check: () => process.env.GROK_API_KEY ? {
        provider: "grok",
        apiUrl: process.env.GROK_API_URL || "https://api.x.ai/v1",
        apiKey: process.env.GROK_API_KEY,
        model: process.env.GROK_MODEL || "grok-beta",
      } : null,
    },
    {
      name: "openai",
      check: () => process.env.OPENAI_API_KEY ? {
        provider: "openai",
        apiUrl: process.env.OPENAI_API_URL || "https://api.openai.com/v1",
        apiKey: process.env.OPENAI_API_KEY,
        model: process.env.OPENAI_MODEL || "gpt-4o",
      } : null,
    },
    {
      name: "eigenai",
      check: () => (process.env.EIGENAI_API_KEY || process.env.EIGENCOMPUTE_INSTANCE_ID) ? {
        provider: "eigenai",
        apiUrl: process.env.EIGENAI_API_URL || "https://api.eigenai.xyz/v1",
        apiKey: process.env.EIGENAI_API_KEY || process.env.EIGENCOMPUTE_INSTANCE_ID || "",
        model: process.env.EIGENAI_MODEL || "gpt-oss-120b-f16",
      } : null,
    },
  ];

  // Use LLM_PROVIDER env if set
  const preferred = process.env.LLM_PROVIDER?.toLowerCase();
  if (preferred) {
    const match = providers.find(p => p.name === preferred);
    if (match) {
      const config = match.check();
      if (config) return config;
    }
  }

  // Try all providers
  for (const p of providers) {
    const config = p.check();
    if (config) return config;
  }

  return null;
}

// ── Init ──────────────────────────────────────────────────────────────────────

const llmConfig = resolveLLMConfig();
if (!llmConfig) {
  console.error("[FATAL] No LLM provider configured. Set at least one API key.");
  process.exit(1);
}

initThinker(llmConfig);
initLLMClient(llmConfig);
initResearch();

// ── NFT / On-Chain ────────────────────────────────────────────────────────────
const nftState = initNFT();

// ── Organism ──────────────────────────────────────────────────────────────────

const organism = new DigitalOrganism();

// ── Main Loop ─────────────────────────────────────────────────────────────────

let tickTimer: ReturnType<typeof setInterval> | null = null;

function startLoop(): void {
  console.log(`[LOOP] Tick interval: ${TICK_INTERVAL}ms`);
  tickTimer = setInterval(async () => {
    try {
      await organism.tick();
    } catch (err) {
      console.error(`[LOOP] Tick error: ${err instanceof Error ? err.message : err}`);
    }
  }, TICK_INTERVAL);
}

// ── HTTP Server ───────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

// Serve frontend — React build first, fallback to simple dashboard
let dashboardDir = path.join(process.cwd(), "frontend", "dist");
if (!fs.existsSync(path.join(dashboardDir, "index.html"))) {
  dashboardDir = path.join(process.cwd(), "dashboard");
}
if (!fs.existsSync(path.join(dashboardDir, "index.html"))) {
  dashboardDir = path.join(__dirname, "..", "..", "dashboard");
}
app.use(express.static(dashboardDir));
app.use("/doodles", express.static(path.join(process.cwd(), "doodles")));
const dashboardIndex = path.join(dashboardDir, "index.html");
// SPA fallback for React Router
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/doodles") || req.path.startsWith("/health")) return next();
  res.sendFile(dashboardIndex);
});

// ── API Routes ────────────────────────────────────────────────────────────────

// Submit a task
app.post("/api/task", (req, res) => {
  const { type, input, reward } = req.body as { type?: string; input?: string; reward?: number };

  if (!type || !input || typeof input !== "string" || input.trim().length < 3) {
    return res.status(400).json({ error: "type and input (min 3 chars) required" });
  }

  const validTypes: TaskType[] = ["review", "research", "summarize", "analyze"];
  if (!validTypes.includes(type as TaskType)) {
    return res.status(400).json({ error: `type must be one of: ${validTypes.join(", ")}` });
  }

  if (organism.state.status === "dead") {
    return res.status(503).json({ error: "Organism is dead. No tasks accepted." });
  }

  const task = submitTask(type as TaskType, input.trim(), reward);
  res.json({ ok: true, task: { id: task.id, type: task.type, reward: task.reward, status: task.status } });
});

// Organism state
app.get("/api/organism", (_req, res) => {
  const snap = organism.metabolism.snapshot();
  res.json({
    ...organism.state,
    metabolism: snap,
    tee: {
      enabled: true,
      teeMode: !!process.env.EIGENCOMPUTE_INSTANCE_ID,
      instanceId: process.env.EIGENCOMPUTE_INSTANCE_ID || "local-dev",
    },
    research: { enabled: isSearchEnabled() },
    nft: { enabled: isNFTEnabled(), wallet: getWalletAddress(), chain: "Starknet Sepolia" },
    llm: { provider: getActiveLLMProvider(), model: getModelName() },
  });
});

// Heartbeat (lightweight — for fast polling)
app.get("/api/heartbeat", (_req, res) => {
  const snap = organism.metabolism.snapshot();
  res.json({
    alive: snap.alive,
    balance: snap.balance,
    burnRate: snap.burnRate,
    earnRate: snap.earnRate,
    netRate: snap.netRate,
    ttd: snap.ttd,
    uptime: snap.uptime,
    activity: organism.state.activity,
    currentTaskId: organism.state.currentTaskId,
    tasksCompleted: organism.state.tasksCompleted,
    tickCount: snap.tickCount,
  });
});

// Task list
app.get("/api/tasks", (_req, res) => {
  res.json(getAllTasks().slice(0, 50));
});

// Earnings log
app.get("/api/earnings", (_req, res) => {
  res.json(organism.metabolism.getLog().slice(-100));
});

// TEE Proof
app.get("/api/proof", (_req, res) => {
  const completed = getCompletedTasks();
  const teeMode = !!process.env.EIGENCOMPUTE_INSTANCE_ID;

  res.json({
    title: "Digital Organism — Proof of Autonomous Operation",
    version: "1.0",
    generatedAt: Date.now(),
    organism: {
      id: organism.state.id,
      publicKey: organism.state.identity.publicKey,
      fingerprint: organism.state.identity.fingerprint,
      bornAt: organism.state.bornAt,
      status: organism.state.status,
      tasksCompleted: organism.state.tasksCompleted,
      totalEarned: organism.state.totalEarned,
      totalSpent: organism.state.totalSpent,
    },
    tee: {
      mode: teeMode,
      instanceId: process.env.EIGENCOMPUTE_INSTANCE_ID || "local-dev",
      systemPromptHash: getSystemPromptHash(),
      modelProvider: getActiveLLMProvider(),
      modelName: getModelName(),
    },
    completedTasks: completed.slice(0, 20).map(t => ({
      id: t.id,
      type: t.type,
      reward: t.reward,
      cost: t.costIncurred,
      tokensUsed: t.tokensUsed,
      attestation: t.attestation,
      completedAt: t.completedAt,
      sources: t.sources,
    })),
    verificationSteps: [
      "1. Each completed task carries an Ed25519 signature from the organism's TEE-generated keypair.",
      "2. The signature binds the task ID, type, and result hash to the organism's identity.",
      "3. On EigenCompute: Intel TDX attestation proves the organism's code hasn't been modified.",
      "4. The operator cannot see task inputs/outputs — TEE memory encryption enforces this.",
      "5. The organism's balance and earnings are tracked inside the enclave — the operator cannot steal funds.",
    ],
  });
});

// Internal monologue (Sovra-style "The Brain")
app.get("/api/monologue", (_req, res) => {
  res.json(getRecentEntries(60));
});

// Doodle art log
app.get("/api/doodles", (_req, res) => {
  res.json(getDoodleLog());
});

// Self-improvement log
app.get("/api/improvements", (_req, res) => {
  res.json(getImprovementLog());
});

// ── NFT Marketplace ───────────────────────────────────────────────────────────

// All listings
app.get("/api/nft/listings", async (_req, res) => {
  const ethBal = await getWalletBalance();
  res.json({
    enabled: isNFTEnabled(),
    wallet: getWalletAddress(),
    walletBalance: ethBal,
    chain: "Base Sepolia",
    listings: getListings(),
    available: getAvailableListings(),
  });
});

// Buy a doodle
app.post("/api/nft/buy", async (req, res) => {
  const { tokenId, buyerAddress } = req.body as { tokenId?: number; buyerAddress?: string };
  if (!tokenId || !buyerAddress) return res.status(400).json({ error: "tokenId and buyerAddress required" });

  const listing = await buyDoodle(tokenId, buyerAddress);
  if (!listing) return res.status(404).json({ error: "Listing not found or already sold" });

  // Credit the organism for the sale
  const ethPrice = parseFloat(listing.price);
  const creditBonus = ethPrice * 10000; // Convert ETH price to credits (generous for demo)
  organism.metabolism.earn(creditBonus, `NFT sale: "${listing.title}" for ${listing.price} ETH`, `nft-${tokenId}`);

  res.json({ ok: true, listing, creditsEarned: creditBonus });
});

// Available task types + pricing
app.get("/api/pricing", (_req, res) => {
  res.json({
    taskTypes: Object.entries(TASK_REWARDS).map(([type, reward]) => ({
      type, reward, description: {
        review: "Code review — security, quality, and performance analysis",
        research: "Research question — web-backed answer with citations",
        summarize: "Text summarization — structured key points",
        analyze: "Claim analysis — balanced adversarial assessment",
      }[type],
    })),
    organismAlive: organism.state.status === "alive",
  });
});

// Health
app.get("/health", (_req, res) => {
  const snap = organism.metabolism.snapshot();
  res.json({
    ok: organism.state.status === "alive",
    status: organism.state.status,
    balance: snap.balance,
    uptime: snap.uptime,
    tasksCompleted: organism.state.tasksCompleted,
    llm: { provider: getActiveLLMProvider(), model: getModelName() },
    tee: !!process.env.EIGENCOMPUTE_INSTANCE_ID,
  });
});
app.get("/api/health", (_req, res) => res.redirect("/health"));

// ── Boot ──────────────────────────────────────────────────────────────────────

const server = app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║  DIGITAL ORGANISM — Autonomous AI Agent              ║
╠══════════════════════════════════════════════════════╣
║  Port:        ${String(PORT).padEnd(39)}║
║  LLM:         ${(getActiveLLMProvider() + " / " + getModelName()).padEnd(39)}║
║  TEE mode:    ${String(!!process.env.EIGENCOMPUTE_INSTANCE_ID).padEnd(39)}║
║  Research:    ${String(isSearchEnabled()).padEnd(39)}║
║  Balance:     ${(organism.state.balance.toFixed(1) + " credits").padEnd(39)}║
║  Tick:        ${(TICK_INTERVAL + "ms").padEnd(39)}║
╚══════════════════════════════════════════════════════╝

  Dashboard   → http://localhost:${PORT}
  Organism    → http://localhost:${PORT}/api/organism
  Submit task → POST http://localhost:${PORT}/api/task
  Heartbeat   → http://localhost:${PORT}/api/heartbeat
  Proof       → http://localhost:${PORT}/api/proof
`);

  startLoop();
});

// Graceful shutdown
process.on("SIGINT", () => { console.log("\n[SHUTDOWN] SIGINT"); tickTimer && clearInterval(tickTimer); server.close(); process.exit(0); });
process.on("SIGTERM", () => { console.log("\n[SHUTDOWN] SIGTERM"); tickTimer && clearInterval(tickTimer); server.close(); process.exit(0); });
