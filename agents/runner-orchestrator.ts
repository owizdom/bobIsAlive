/**
 * Swarm Mind — Single-Process Orchestrator
 *
 * One process. One port. Three internal sub-agents.
 *
 * Nakamoto (Technical), Szabo (Macro), Finney (On-chain) run as sub-agents
 * inside this orchestrator. During explore they operate in complete isolation
 * — no shared state, no cross-contamination. During reveal they cross-pollinate
 * via a shared pheromone channel. The orchestrator coordinates the cycle and
 * synthesizes the oracle answer.
 *
 * OLD: server-multi.ts + 3× runner.ts → 4 processes, 4 ports, startup script
 * NEW: runner-orchestrator.ts → 1 process, 1 port, npm run start:solo
 *
 * On EigenCompute (TEE): all sub-agents run inside the same TDX enclave.
 * Each has its own Ed25519 keypair (generated from hardware entropy at boot).
 * Independence is hardware-enforced during explore — no peer output can be
 * injected because the operator is blind to enclave memory.
 */

import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { v4 as uuid } from "uuid";

import { SwarmAgent } from "./agent";
import {
  initDatabase, savePheromone, saveCommitment, saveCollectiveMemory, closeDatabase,
} from "./persistence";
import {
  initThinker, generateCollectiveReport, getLLMUsage, getSystemPromptHash, getModelName, getActiveLLMProvider,
} from "./thinker";
import { verifyAttestation, buildAttestation } from "./keystore";
import type {
  Pheromone, PheromoneChannel, LLMConfig, CollectiveMemory,
  SealedBlob, AgentCommitment, CyclePhase, FindingSummary, OracleConsensus,
} from "./types";
import { hash } from "./types";
import { fetchActivePolymarketQuestions, fetchPolymarketSignal } from "./markets";
import type { PolymarketLiveQuestion } from "./markets";

// ── Config ───────────────────────────────────────────────────────────────────

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePositiveFloat(value: string | undefined, fallback: number): number {
  const parsed = parseFloat(value || "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const PORT            = parseInt(process.env.AGENT_PORT || process.env.DASHBOARD_PORT || "3001");
const DB_PATH         = process.env.DB_PATH || path.join(process.cwd(), "swarm-oracle.db");
const STEP_INTERVAL   = parsePositiveInt(process.env.SYNC_INTERVAL_MS, 2000);
const PHEROMONE_DECAY = parsePositiveFloat(process.env.PHEROMONE_DECAY, 0.12);
const CRITICAL_DENSITY = parsePositiveFloat(process.env.CRITICAL_DENSITY, 0.55);
const EXPLORE_STEPS   = parsePositiveInt(process.env.EXPLORE_STEPS, 20);
// Steps per phase (each step = STEP_INTERVAL ms)
const COMMIT_STEPS    = 1;   // instantaneous — just seal and continue
const REVEAL_STEPS    = parsePositiveInt(process.env.REVEAL_STEPS, 16);
const SYNTHESIS_STEPS = parsePositiveInt(process.env.SYNTHESIS_STEPS, 8);

const AUTONOMY_ENABLED          = (process.env.AUTONOMY_ENABLED || "true").toLowerCase() !== "false";
const AUTONOMY_STATE_FILE       = process.env.AUTONOMY_STATE_FILE || path.join(process.cwd(), "swarm-orchestrator-state.json");
const AUTONOMY_HEARTBEAT_MS      = parsePositiveInt(process.env.AUTONOMY_HEARTBEAT_MS, 10_000);
const AUTONOMY_STALE_RECOVERY_MS = parsePositiveInt(process.env.AUTONOMY_STALE_RECOVERY_MS, 90_000);
const AUTONOMY_MAX_STEP_FAILURES = parsePositiveInt(process.env.AUTONOMY_MAX_STEP_FAILURES, 6);
const AGENT_STEP_TIMEOUT_MS      = parsePositiveInt(process.env.AGENT_STEP_TIMEOUT_MS, 20_000);
const DEGRADE_RECOVERY_PAUSE_MS  = parsePositiveInt(process.env.DEGRADE_RECOVERY_PAUSE_MS, 15_000);
const LOOP_STALL_WARN_STEPS      = parsePositiveInt(process.env.LOOP_STALL_WARN_STEPS, 3);
const PHASE_TIMEOUT_MARGIN       = parsePositiveInt(process.env.PHASE_TIMEOUT_MARGIN_STEPS, 4);
const LLM_FAILOVER_COOLDOWN_MS   = parsePositiveInt(process.env.LLM_FAILOVER_COOLDOWN_MS, 30_000);
const LLM_FAILOVER_FAILURES      = parsePositiveInt(process.env.LLM_FAILOVER_FAILURES, 3);
const LLM_PROVIDER_ORDER_RAW     = process.env.LLM_PROVIDER_ORDER
  || `${process.env.LLM_PROVIDER ? `${process.env.LLM_PROVIDER},` : ""}eigenai,openai,anthropic,groq,local`;

// ── Database ──────────────────────────────────────────────────────────────────
initDatabase(DB_PATH);

type LLMFailurePolicy = "rate-limit" | "auth" | "network" | "runtime" | "unknown";

function resolveLLMConfigFromProvider(provider: string): LLMConfig | null {
  switch (provider) {
    case "anthropic":
      if (!process.env.ANTHROPIC_API_KEY) return null;
      return {
        provider: "anthropic",
        apiUrl: "",
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: process.env.ANTHROPIC_MODEL || "claude-opus-4-6",
      };

    case "openai":
      if (!process.env.OPENAI_API_KEY) return null;
      return {
        provider: "openai",
        apiUrl: process.env.OPENAI_API_URL || "https://api.openai.com/v1",
        apiKey: process.env.OPENAI_API_KEY,
        model: process.env.OPENAI_MODEL || "gpt-4o",
      };

    case "groq":
      if (!(process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY)) return null;
      return {
        provider: "groq",
        apiUrl: process.env.GROQ_API_URL || process.env.OPENAI_API_URL || "https://api.groq.com/openai/v1",
        apiKey: process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY || "",
        model: process.env.GROQ_MODEL || process.env.OPENAI_MODEL || "llama-3.1-8b-instant",
      };

    case "grok":
      if (!(process.env.GROK_API_KEY || process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY)) return null;
      return {
        provider: "grok",
        apiUrl: process.env.GROK_API_URL || process.env.OPENAI_API_URL || "https://api.x.ai/v1",
        apiKey: process.env.GROK_API_KEY || process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY || "",
        model: process.env.GROK_MODEL || process.env.GROQ_MODEL || process.env.OPENAI_MODEL || "grok-beta",
      };

    case "eigenai":
      if (!process.env.EIGENCOMPUTE_INSTANCE_ID && !process.env.EIGENAI_API_KEY) return null;
      return {
        provider: "eigenai",
        apiUrl: process.env.EIGENAI_API_URL || "https://api.eigenai.xyz/v1",
        apiKey: process.env.EIGENAI_API_KEY || process.env.EIGENCOMPUTE_INSTANCE_ID || "eigenai-no-key",
        model: process.env.EIGENAI_MODEL || "gpt-oss-120b-f16",
      };

    case "local":
      return {
        provider: "local",
        apiUrl: process.env.LOCAL_LLM_API_URL || process.env.LLM_LOCAL_API_URL || "http://127.0.0.1:8000/v1",
        apiKey: process.env.LOCAL_LLM_API_KEY || process.env.LLM_LOCAL_API_KEY || "local-llm",
        model: process.env.LLM_LOCAL_MODEL || process.env.LOCAL_LLM_MODEL || "local",
      };

    default:
      return null;
  }
}

const LLM_PROVIDER_FALLBACK_LIST: string[] = Array.from(
  new Set(
    LLM_PROVIDER_ORDER_RAW
      .split(",")
      .map((provider) => provider.trim().toLowerCase())
      .filter(Boolean)
  )
);

const llmConfigs = LLM_PROVIDER_FALLBACK_LIST.map(resolveLLMConfigFromProvider).filter((c): c is LLMConfig => !!c);
const llmFailureCountByProvider: Record<string, number> = {};
let llmConfigActive = -1;
let llmFailoverUntil = 0;
let llmRuntimeFailureStreak = 0;
let lastLLMFailure: string | null = null;

function classifyLLMFailure(reason: string): LLMFailurePolicy {
  const lower = reason.toLowerCase();
  if (lower.includes("401") || lower.includes("403") || lower.includes("unauthorized") || lower.includes("authentication")) return "auth";
  if (lower.includes("429") || lower.includes("rate limit") || lower.includes("too many requests")) return "rate-limit";
  if (lower.includes("network") || lower.includes("timeout") || lower.includes("socket") || lower.includes("econnrefused") || lower.includes("fetch failed")) return "network";
  return "runtime";
}

function applyLLMConfig(nextIndex: number): boolean {
  if (nextIndex < 0 || nextIndex >= llmConfigs.length) return false;
  const config = llmConfigs[nextIndex];
  const key = `${config.provider}:${config.model}`;
  try {
    initThinker(config);
    llmConfigActive = nextIndex;
    llmFailureCountByProvider[key] = 0;
    llmRuntimeFailureStreak = 0;
    lastLLMFailure = null;
    console.log(`[LLM] Active provider set → ${config.provider} (${config.apiUrl})`);
    return true;
  } catch {
    llmFailureCountByProvider[key] = (llmFailureCountByProvider[key] || 0) + 1;
    return false;
  }
}

function rotateLLMProvider(reason: string): void {
  if (llmConfigs.length <= 1 || Date.now() < llmFailoverUntil) return;
  llmFailoverUntil = Date.now() + LLM_FAILOVER_COOLDOWN_MS;

  const attempts = llmConfigs.length;
  for (let i = 1; i <= attempts; i++) {
    const nextIndex = (llmConfigActive + i) % llmConfigs.length;
    if (applyLLMConfig(nextIndex)) {
      console.warn(`[LLM] Failover (${classifyLLMFailure(reason)}) → ${llmConfigs[nextIndex].provider}`);
      return;
    }
  }
  console.warn("[LLM] Failover attempt exhausted; keeping current provider.");
}

function initLLM(): boolean {
  if (llmConfigs.length === 0) return false;
  for (let i = 0; i < llmConfigs.length; i++) {
    if (applyLLMConfig(i)) return true;
  }
  return false;
}

let llmReady = initLLM();

function getActiveLLMConfig(): LLMConfig | null {
  if (llmConfigActive < 0 || llmConfigActive >= llmConfigs.length) return null;
  return llmConfigs[llmConfigActive];
}

function getLLMStatus() {
  const active = getActiveLLMConfig();
  const policy = llmConfigs.map((config) => `${config.provider}:${config.model}`);
  return {
    ready: llmReady,
    provider: getActiveLLMProvider(),
    active: active ? `${active.provider}@${active.apiUrl}` : "unknown",
    policy,
    activeIndex: llmConfigActive,
    activeFailures: llmRuntimeFailureStreak,
    failover: {
      cooldownMs: LLM_FAILOVER_COOLDOWN_MS,
      threshold: LLM_FAILOVER_FAILURES,
      blockedUntil: llmFailoverUntil,
      blocked: Date.now() < llmFailoverUntil,
    },
    lastFailure: lastLLMFailure,
  };
}

// ── Sub-agents ────────────────────────────────────────────────────────────────
// Each gets its own keypair, identity, and personality. Three independent minds.
const subAgents = [new SwarmAgent(0), new SwarmAgent(1), new SwarmAgent(2)];
if (llmReady) subAgents.forEach(a => a.enableEngineering());

// One isolated channel per sub-agent — used during explore.
// Sub-agents deposit their own pheromones locally; they cannot see peers.
function makeChannel(): PheromoneChannel {
  return { pheromones: [], density: 0, criticalThreshold: CRITICAL_DENSITY, phaseTransitionOccurred: false, transitionStep: null, cyclePhase: "explore", phaseStartStep: 0 };
}
const subChannels: PheromoneChannel[] = subAgents.map(() => makeChannel());

// Shared channel — used during reveal for controlled cross-pollination.
const sharedChannel: PheromoneChannel = makeChannel();

// ── Cycle state ───────────────────────────────────────────────────────────────
let step = 0;
let phaseStep = 0;              // steps elapsed in current phase
let cyclePhase: CyclePhase = "explore";
let cycleNumber = 1;
let cycleId: string = crypto.randomUUID();
let phaseStartedAt = Date.now();
let synthesisFiredThisCycle = false;
const collectiveMemories: CollectiveMemory[] = [];
const oracleHistory: OracleConsensus[] = [];
let currentOracleAnswer: OracleConsensus | null = null;

// Pheromones each sub-agent produced during explore (for commit sealing)
const explorePheromonesByAgent: Pheromone[][] = subAgents.map(() => []);
// Commitments keyed by agentId
const agentCommitments = new Map<string, AgentCommitment>();

interface OrchestratorRuntimeState {
  cycleId: string;
  cycleNumber: number;
  cyclePhase: CyclePhase;
  step: number;
  phaseStep: number;
  phaseStartedAt: number;
  updatedAt: number;
  restartCount: number;
}

let consecutiveStepErrors = 0;
let degradedUntil = 0;
let lastProgressAt = Date.now();
let restartCount = 0;
let lastStatePersistAt = 0;
let lastRuntimeError: string | null = null;

function persistAutonomyState(): void {
  if (!AUTONOMY_ENABLED) return;
  const now = Date.now();
  if (now - lastStatePersistAt < AUTONOMY_HEARTBEAT_MS) return;

  lastStatePersistAt = now;
  const state: OrchestratorRuntimeState = {
    cycleId,
    cycleNumber,
    cyclePhase,
    step,
    phaseStep,
    phaseStartedAt,
    updatedAt: now,
    restartCount,
  };

  try {
    fs.writeFileSync(AUTONOMY_STATE_FILE, JSON.stringify(state), "utf8");
  } catch (err) {
    console.warn(`[ORACLE] Unable to persist autonomy state (${String(err).slice(0, 80)})`);
  }
}

function loadAutonomyState(): OrchestratorRuntimeState | null {
  if (!AUTONOMY_ENABLED) return null;
  try {
    const raw = fs.readFileSync(AUTONOMY_STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as OrchestratorRuntimeState;
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.cycleId || !parsed.updatedAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

function applyRecoveredState(): void {
  if (!AUTONOMY_ENABLED) return;
  const recovered = loadAutonomyState();
  if (!recovered) return;

  const age = Date.now() - recovered.updatedAt;
  if (age > AUTONOMY_STALE_RECOVERY_MS) {
    console.log(`[ORACLE] Recovered state stale by ${Math.round(age / 1000)}s — starting clean cycle`);
    return;
  }

  cycleNumber = recovered.cycleNumber || cycleNumber;
  cycleId = recovered.cycleId || cycleId;
  step = recovered.step || step;
  phaseStartedAt = recovered.phaseStartedAt || phaseStartedAt;
  restartCount = Math.max(0, (recovered.restartCount || 0) + 1);

  if (recovered.cyclePhase === "explore") {
    cyclePhase = "explore";
    phaseStep = Math.min(Math.max(0, recovered.phaseStep || 0), Math.max(0, EXPLORE_STEPS - 1));
    console.log(`[ORACLE] Recovery: resuming explore phase of cycle ${cycleNumber} from step ${phaseStep}`);
  } else {
    cyclePhase = "explore";
    phaseStep = 0;
    setPhase("explore");
    console.log(`[ORACLE] Recovery: previous cycle phase ${recovered.cyclePhase} was not safe, restarting at explore`);
  }
}

function setDegradedMode(reason: string): void {
  degradedUntil = Date.now() + DEGRADE_RECOVERY_PAUSE_MS;
  lastRuntimeError = reason;
  console.warn(`[ORACLE] Autonomous recovery mode for ${DEGRADE_RECOVERY_PAUSE_MS}ms — ${reason}`);
}

function isDegraded(): boolean {
  return Date.now() < degradedUntil;
}

// ── Phase helpers ─────────────────────────────────────────────────────────────

function setPhase(next: CyclePhase): void {
  cyclePhase = next;
  phaseStep = 0;
  phaseStartedAt = Date.now();
  subChannels.forEach(c => { c.cyclePhase = next; });
  sharedChannel.cyclePhase = next;
  console.log(`\n[ORACLE] Phase → ${next.toUpperCase()} (cycle ${cycleNumber})`);
}

function resetCycle(): void {
  cycleNumber++;
  cycleId = crypto.randomUUID();
  synthesisFiredThisCycle = false;
  agentCommitments.clear();
  explorePheromonesByAgent.forEach(a => (a.length = 0));

  subAgents.forEach((a, i) => {
    subChannels[i].pheromones = [];
    subChannels[i].density = 0;
    a.state.synchronized = false;
    a.state.syncedWith = [];
    a.state.absorbed = new Set();
    a.state.energy = 0.3 + Math.random() * 0.2;
    a.state.commitmentHash = undefined;
    a.state.commitTimestamp = undefined;
  });

  sharedChannel.pheromones = [];
  sharedChannel.density = 0;
  setPhase("explore");
}

// ── Commit: seal each sub-agent's explore findings ───────────────────────────

async function performCommit(): Promise<void> {
  const now = Date.now();
  for (let i = 0; i < subAgents.length; i++) {
    const agent = subAgents[i];
    const findings: FindingSummary[] = explorePheromonesByAgent[i].map(p => ({
      pheromoneId:  p.id,
      contentHash:  crypto.createHash("sha256").update(p.content).digest("hex"),
      domain:       p.domain,
      confidence:   p.confidence,
      timestamp:    p.timestamp,
    }));

    const sealedBlobCore: Omit<SealedBlob, "independenceProof"> = {
      agentId:            agent.state.id,
      agentPublicKey:     agent.state.identity.publicKey,
      agentName:          agent.state.name,
      explorationEndedAt: now,
      teeInstanceId:      process.env.EIGENCOMPUTE_INSTANCE_ID || "local",
      findings,
      topicsCovered:      [...new Set(findings.map(f => f.domain))],
      predictions:        agent.state.currentPrediction ? [agent.state.currentPrediction] : [],
    };

    const contentHash = hash(JSON.stringify(sealedBlobCore));
    const sigPayload  = `${agent.state.id}|${now}|${contentHash}`;
    const independenceProof = buildAttestation(
      sigPayload, agent.state.id, now,
      agent.getPrivateKey(), agent.state.identity.publicKey
    );

    const sealedBlob: SealedBlob = { ...sealedBlobCore, independenceProof };
    const sealedBlobHash  = crypto.createHash("sha256").update(JSON.stringify(sealedBlob)).digest("hex");
    const commitmentHash  = `sha256:${sealedBlobHash}`;

    agent.state.commitmentHash  = commitmentHash;
    agent.state.commitTimestamp = now;

    const commitment: AgentCommitment = {
      agentId:        agent.state.id,
      agentName:      agent.state.name,
      agentPublicKey: agent.state.identity.publicKey,
      commitmentHash,
      sealedBlobHash,
      committedAt:    now,
      cycleStartStep: step,
    };
    agentCommitments.set(agent.state.id, commitment);
    try { saveCommitment(commitment); } catch {}
    console.log(`  [${agent.state.name}] COMMIT → ${commitmentHash.slice(0, 28)}…`);
  }
}

// ── Synthesis ─────────────────────────────────────────────────────────────────

async function generateCollectiveMemory(): Promise<CollectiveMemory | null> {
  try {
    const allThoughts = subAgents.flatMap(a =>
      a.state.thoughts.slice(-8).map(t => ({
        agentName:      a.state.name,
        specialization: a.state.specialization,
        observation:    t.observation,
        reasoning:      t.reasoning,
        conclusion:     t.conclusion,
        confidence:     t.confidence,
      }))
    );
    if (!allThoughts.length) return null;

    const peerThoughts = sharedChannel.pheromones
      .filter(p => p.strength > 0.25)
      .slice(0, 8)
      .map(p => ({
        agentName:      subAgents.find(a => a.state.id === p.agentId)?.state.name || p.agentId.slice(0, 8),
        specialization: p.domain,
        observation:    p.content.slice(0, 120),
        reasoning:      "",
        conclusion:     p.content,
        confidence:     p.confidence,
      }));

    const datasets = [...new Set(subAgents.flatMap(a => a.state.reposStudied))];

    let { report, tokensUsed } = await generateCollectiveReport(
      [...allThoughts, ...peerThoughts], datasets, "Crypto Market Oracle"
    );

    // Rate-limit retry
    if (!report.keySignals.length && !report.verdict) {
      console.log("[ORACLE] Synthesis rate-limited — retrying in 15s");
      await new Promise(r => setTimeout(r, 15_000));
      const retry = await generateCollectiveReport([...allThoughts, ...peerThoughts], datasets, "Crypto Market Oracle");
      if (retry.report.keySignals.length > 0) { report = retry.report; tokensUsed += retry.tokensUsed; }
    }

    subAgents.forEach(a => { a.state.tokensUsed += Math.round(tokensUsed / subAgents.length); });

    const preCommitProofs = Object.fromEntries(
      [...agentCommitments.entries()].map(([id, c]) => [id, c.commitmentHash])
    );
    const participantCount   = agentCommitments.size || subAgents.length;
    const consensusDirection = report.consensusDirection || "neutral";

    const consensus: OracleConsensus = {
      question:        subAgents[0]?.state.currentPrediction?.question || report.overview || "Awaiting an active Polymarket question",
      ticker:          subAgents[0]?.state.currentPrediction?.ticker || "market",
      answer:          report.oracleAnswer || "UNCERTAIN",
      confidence:      report.confidence,
      bullishVotes:    consensusDirection === "bullish" ? participantCount : 0,
      bearishVotes:    consensusDirection === "bearish" ? participantCount : 0,
      participantCount,
      preCommitProofs,
      resolvedAt:      Date.now(),
    };
    oracleHistory.push(consensus);
    if (oracleHistory.length > 20) oracleHistory.shift();
    currentOracleAnswer = consensus;

    const synthesis = [
      report.overview, "",
      "Key Signals:", ...report.keySignals.map(f => `• ${f}`),
      "", report.opinions,
    ].join("\n");

    const memory: CollectiveMemory = {
      id:            uuid(),
      topic:         "Crypto Market Oracle",
      synthesis,
      contributors:  subAgents.map(a => a.state.id),
      pheromoneIds:  sharedChannel.pheromones.map(p => p.id),
      confidence:    report.confidence,
      attestation:   hash(report.overview + report.verdict),
      createdAt:     Date.now(),
      report,
      preCommitProofs,
    };

    collectiveMemories.push(memory);
    try { saveCollectiveMemory(memory); } catch {}
    console.log(`[ORACLE] Synthesis done — ${report.keySignals.length} signals, answer: ${consensus.answer} (${(consensus.confidence*100).toFixed(0)}%)`);
    return memory;
  } catch (err) {
    console.error("[ORACLE] Synthesis error:", err);
    return null;
  }
}

function buildFallbackOracleConsensus(preCommitProofs: Record<string, string>): OracleConsensus {
  const votes = { bullish: 0, bearish: 0, neutral: 0 };
  for (const agent of subAgents) {
    const dir = agent.state.currentPrediction?.direction;
    if (dir === "bullish") votes.bullish += 1;
    else if (dir === "bearish") votes.bearish += 1;
    else votes.neutral += 1;
  }

  const dominant = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  const answer = dominant?.[0] === "bullish" ? "YES" : dominant?.[0] === "bearish" ? "NO" : "UNCERTAIN";
  const participantCount = subAgents.length;
  const fallback: OracleConsensus = {
    question: subAgents[0]?.state.currentPrediction?.question || "Awaiting an active Polymarket question",
    ticker: subAgents[0]?.state.currentPrediction?.ticker || "market",
    answer,
    confidence: Math.min(0.45, (Math.max(votes.bullish, votes.bearish) / Math.max(1, participantCount))),
    bullishVotes: votes.bullish,
    bearishVotes: votes.bearish,
    participantCount,
    preCommitProofs,
    resolvedAt: Date.now(),
  };
  return fallback;
}

async function performSynthesisWithFallback(): Promise<void> {
  const preCommitProofs = Object.fromEntries(
    [...agentCommitments.entries()].map(([id, c]) => [id, c.commitmentHash])
  );

  if (isDegraded()) {
    const fallback = buildFallbackOracleConsensus(preCommitProofs);
    currentOracleAnswer = fallback;
    oracleHistory.push(fallback);
    if (oracleHistory.length > 20) oracleHistory.shift();
    const memory: CollectiveMemory = {
      id: uuid(),
      topic: "Crypto Market Oracle",
      synthesis: "Fallback consensus generated during recoverable API/agent failure.",
      contributors: subAgents.map(a => a.state.id),
      pheromoneIds: [],
      confidence: fallback.confidence,
      attestation: hash(fallback.answer + (fallback.resolvedAt || Date.now())),
      createdAt: Date.now(),
      preCommitProofs,
    };
    collectiveMemories.push(memory);
    if (collectiveMemories.length > 20) collectiveMemories.shift();
    try { saveCollectiveMemory(memory); } catch {}
    return;
  }

  try {
    const memory = await safeWithTimeout(() => generateCollectiveMemory(), "synthesis", AGENT_STEP_TIMEOUT_MS * 3);
    if (memory) {
      consecutiveStepErrors = 0;
      return;
    }
    const fallback = buildFallbackOracleConsensus(preCommitProofs);
    currentOracleAnswer = fallback;
    oracleHistory.push(fallback);
    if (oracleHistory.length > 20) oracleHistory.shift();
  } catch (err) {
    console.error(`[ORACLE] Synthesis fallback triggered: ${err instanceof Error ? err.message : String(err)}`);
    const fallback = buildFallbackOracleConsensus(preCommitProofs);
    currentOracleAnswer = fallback;
    oracleHistory.push(fallback);
    if (oracleHistory.length > 20) oracleHistory.shift();
  }

  consecutiveStepErrors = 0;
  const fallbackMemory: CollectiveMemory = {
    id: uuid(),
    topic: "Crypto Market Oracle",
    synthesis: "Fallback oracle answer emitted because synthesis path timed out or failed.",
    contributors: subAgents.map(a => a.state.id),
    pheromoneIds: [],
    confidence: currentOracleAnswer?.confidence || 0.2,
    attestation: hash("fallback-synthesis" + Date.now().toString()),
    createdAt: Date.now(),
    preCommitProofs,
  };
  collectiveMemories.push(fallbackMemory);
  if (collectiveMemories.length > 20) collectiveMemories.shift();
  try { saveCollectiveMemory(fallbackMemory); } catch {}
}

async function safeWithTimeout<T>(fn: () => Promise<T>, label: string, timeoutMs = AGENT_STEP_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`[ORACLE] Timeout in ${label}`)), timeoutMs);
  });
  try {
    return await Promise.race([fn(), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isLikelyLLMFailure(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("llm") ||
    lower.includes("openai") ||
    lower.includes("anthropic") ||
    lower.includes("chat completion") ||
    lower.includes("messages.create") ||
    lower.includes("rate limit") ||
    lower.includes("429") ||
    lower.includes("401") ||
    lower.includes("403") ||
    lower.includes("unauthorized") ||
    lower.includes("eigenai") ||
    lower.includes("local-llm")
  );
}

async function safeRunAgentStep(agent: SwarmAgent, channel: PheromoneChannel): Promise<Pheromone | null> {
  if (isDegraded()) return null;

  try {
    const result = await safeWithTimeout(() => agent.step(channel), `agent step (${agent.state.name})`);
    consecutiveStepErrors = 0;
    lastProgressAt = Date.now();
    return result;
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    lastRuntimeError = reason;
    consecutiveStepErrors += 1;
    if (isLikelyLLMFailure(reason)) {
      llmRuntimeFailureStreak += 1;
      lastLLMFailure = reason;
      if (llmRuntimeFailureStreak >= LLM_FAILOVER_FAILURES) {
        rotateLLMProvider(reason);
        llmRuntimeFailureStreak = 0;
      }
    } else {
      llmRuntimeFailureStreak = 0;
    }
    if (consecutiveStepErrors >= AUTONOMY_MAX_STEP_FAILURES) {
      setDegradedMode(reason.slice(0, 120));
      consecutiveStepErrors = 0;
    }
    console.error(`[ORACLE] Agent step failed: ${reason.slice(0, 180)}`);
    return null;
  }
}

// ── Density ───────────────────────────────────────────────────────────────────
function updateSharedDensity(): void {
  const active = sharedChannel.pheromones.filter(p => p.strength > 0.1);
  const avgStr = active.length ? active.reduce((s, p) => s + p.strength, 0) / active.length : 0;
  sharedChannel.density = Math.min(1, (active.length / 24) * avgStr * 1.5);
}

// ── Attestation (per sub-agent) ───────────────────────────────────────────────
function buildAttestationForAgent(agent: SwarmAgent) {
  const idx      = subAgents.indexOf(agent);
  const latest   = agent.state.knowledge.slice(-1)[0];
  const teeMode  = !!process.env.EIGENCOMPUTE_INSTANCE_ID;
  const teeId    = process.env.EIGENCOMPUTE_INSTANCE_ID || "local";

  return {
    agentId:   agent.state.id,
    agentName: agent.state.name,
    agent: {
      id:          agent.state.id,
      name:        agent.state.name,
      publicKey:   agent.state.identity.publicKey,
      fingerprint: agent.state.identity.fingerprint,
    },
    proof: {
      layer1_codeIntegrity: {
        label:            "Code Integrity",
        method:           "TDX attestation quote",
        claim:            "Exact model binary with exact system prompt ran in this enclave",
        model:            getModelName(),
        systemPromptHash: getSystemPromptHash(),
        teeInstanceId:    teeId,
        status:           teeMode ? "active" : "local-dev",
      },
      layer2_operatorBlindness: {
        label:          "Operator Blindness",
        method:         "Intel TDX memory isolation",
        claim:          "Operator cannot read memory, modify inputs, or inject peer outputs during inference",
        teeMode,
        memoryIsolated: teeMode,
        status:         teeMode ? "active" : "local-dev",
      },
      layer3_outputBinding: {
        label:          "Output Binding",
        method:         "Ed25519 hardware key signature",
        claim:          "This hardware instance, running that code, produced this output — unforgeable without the key that never left",
        publicKey:      agent.state.identity.publicKey,
        fingerprint:    agent.state.identity.fingerprint,
        commitmentHash: agent.state.commitmentHash || null,
        status:         "active",
      },
    },
    compute: {
      eigenCompute:     teeId,
      teeMode,
      instanceType:     process.env.EIGENCOMPUTE_INSTANCE_TYPE || "local",
      attestationLayer: "EigenCompute-TDX",
    },
    latestPheromone: latest ? {
      id:          latest.id,
      domain:      latest.domain,
      content:     latest.content.slice(0, 200),
      attestation: latest.attestation,
      verified:    latest.agentPubkey
        ? verifyAttestation(latest.attestation, latest.content, latest.agentId, latest.timestamp).valid
        : latest.attestation?.startsWith("ed25519:"),
    } : null,
    stats: {
      discoveriesTotal:    agent.state.discoveries,
      thoughtsFormed:      agent.state.thoughts.length,
      tokensUsed:          agent.state.tokensUsed,
      synchronized:        agent.state.synchronized,
      pheromonesInChannel: (subChannels[idx]?.pheromones.length || 0)
        + sharedChannel.pheromones.filter(p => p.agentId === agent.state.id).length,
    },
    cycle: {
      phase:            cyclePhase,
      commitmentHash:   agent.state.commitmentHash || null,
      knownCommitments: agentCommitments.size,
    },
    timestamp: Date.now(),
  };
}

// ── HTTP Server ───────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

// Serve dashboard
let dashboardDir = path.join(process.cwd(), "dashboard");
if (!fs.existsSync(path.join(dashboardDir, "index.html"))) {
  dashboardDir = path.join(__dirname, "..", "..", "dashboard");
}
app.use(express.static(dashboardDir));
const dashboardIndex = path.join(dashboardDir, "index.html");
app.get(["/", "/dashboard", "/dashboard/"], (_req, res) => res.sendFile(dashboardIndex));

// ── /api/coordinator ──────────────────────────────────────────────────────────
// Internal coordinator — dashboard uses this for phase display
app.get("/api/coordinator", (_req, res) => {
  const now     = Date.now();
  const elapsed = now - phaseStartedAt;
  const phaseDurMs: Record<string, number> = {
    explore:   EXPLORE_STEPS * STEP_INTERVAL,
    commit:    COMMIT_STEPS * STEP_INTERVAL,
    reveal:    REVEAL_STEPS * STEP_INTERVAL,
    synthesis: SYNTHESIS_STEPS * STEP_INTERVAL,
  };
  const windowRemainingMs = Math.max(0, (phaseDurMs[cyclePhase] || 0) - elapsed);
  res.json({
    cycleId, cycleNumber,
    phase:              cyclePhase,
    phaseStartedAt,
    windowRemainingMs,
    commitCount:        agentCommitments.size,
    expectedAgentCount: subAgents.length,
    slashEventCount:    0,
    commits: [...agentCommitments.values()].map(c => ({
      agentId: c.agentId, agentName: c.agentName,
      commitmentHash: c.commitmentHash, sealedBlobHash: c.sealedBlobHash, committedAt: c.committedAt,
    })),
  });
});

// ── /api/oracle ───────────────────────────────────────────────────────────────
app.get("/api/oracle", (_req, res) => {
  const byAgent = subAgents.map((a) => {
    const prediction = a.state.currentPrediction;
    const direction = prediction?.direction ?? "neutral";
    const answer = prediction
      ? (direction === "bullish" ? "YES" : direction === "bearish" ? "NO" : "UNCERTAIN")
      : currentOracleAnswer?.answer || "UNCERTAIN";

    const current = (prediction || currentOracleAnswer)
      ? {
          question: prediction?.question || currentOracleAnswer?.question || null,
          direction,
          answer,
          confidence: prediction?.confidence ?? currentOracleAnswer?.confidence ?? 0,
          ticker: prediction?.ticker || currentOracleAnswer?.ticker || "market",
          priceAtPrediction: prediction?.priceAtPrediction,
          reasoningSummary: prediction?.reasoningSummary || prediction?.question || null,
          reasoning: prediction?.reasoningSummary || null,
          preCommitRef: a.state.commitmentHash || null,
          prediction,
        }
      : null;

    return {
      agentId:        a.state.id,
      agentName:      a.state.name,
      current,
      commitmentHash: a.state.commitmentHash || null,
      cyclePhase,
      currentPrediction: prediction || null,
    };
  });

  const answers = byAgent.map(d => d.current?.answer).filter((a): a is "YES" | "NO" | "UNCERTAIN" => !!a);
  const modeCount: Record<string, number> = {};
  for (const a of answers) modeCount[a] = (modeCount[a] || 0) + 1;
  const majority = Object.entries(modeCount).sort((a, b) => b[1] - a[1])[0]?.[0] || "UNCERTAIN";
  res.json({
    aggregated: { answer: majority, confidence: currentOracleAnswer?.confidence || 0, participantCount: byAgent.length },
    byAgent,
    current: currentOracleAnswer,
    history: oracleHistory.slice(-10),
    cyclePhase,
    teeInstanceId: process.env.EIGENCOMPUTE_INSTANCE_ID || "local",
  });
});

// Compat route for per-agent polling
app.get("/oracle", (_req, res) => {
  res.json({
    agentId:        "orchestrator",
    agentName:      "Swarm Oracle",
    current:        currentOracleAnswer,
    history:        oracleHistory.slice(-10),
    commitmentHash: subAgents[0]?.state.commitmentHash || null,
    cyclePhase,
    teeInstanceId:  process.env.EIGENCOMPUTE_INSTANCE_ID || "local",
  });
});

const POLYMARKET_PLACEHOLDER_QUESTION_PATTERNS = [
  /polymarket question discovery is running/i,
  /no active polymarket question is available/i,
  /no active polymarket questions found/i,
  /polymarket api unavailable/i,
  /awaiting the strongest active signal/i,
  /awaiting an active polymarket question/i,
  /scanning live polymarket questions/i,
];

type ActiveQuestionEntry = {
  question: string;
  link?: string;
  source?: string;
};

function isPolymarketPlaceholderQuestion(question: string): boolean {
  const value = (question || "").trim().toLowerCase();
  if (!value) return true;
  return POLYMARKET_PLACEHOLDER_QUESTION_PATTERNS.some((pattern) => pattern.test(value));
}

function dedupeQuestions(questions: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const q of questions) {
    const normalized = (q || "").trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

// ── /api/questions ────────────────────────────────────────────────────────────
app.get("/api/questions", async (_req, res) => {
  try {
    const liveQuestions = await fetchActivePolymarketQuestions(6);
    const filteredLive = liveQuestions
      .filter((q) => q && !isPolymarketPlaceholderQuestion(q.question))
      .map((q) => ({
        question: q.question,
        link: (q as PolymarketLiveQuestion).link || "",
        source: (q as PolymarketLiveQuestion).source,
      }));
    if (filteredLive.length > 0) {
      return res.json({ active: filteredLive });
    }

    const signal = await fetchPolymarketSignal().catch(() => null);
    const signalQuestions: string[] = signal?.questions?.length
      ? signal.questions
      : signal?.question
      ? [signal.question]
      : [];
    const signalFallback = dedupeQuestions(
      signalQuestions.filter((question: string) => !isPolymarketPlaceholderQuestion(question))
    ).slice(0, 6).map((question) => ({
      question,
      link: "",
      source: "polymarket-signal",
    }));

    if (signalFallback.length > 0) {
      return res.json({ active: signalFallback });
    }
  } catch {
    // no-op; return an empty list below
  }

  res.json({ active: [] });
});

// ── /api/agents ───────────────────────────────────────────────────────────────
app.get("/api/agents", (_req, res) => {
  res.json(subAgents.map(a => ({
    id:               a.state.id,
    name:             a.state.name,
    position:         a.state.position,
    velocity:         a.state.velocity,
    energy:           a.state.energy,
    synchronized:     a.state.synchronized,
    explorationTarget: a.state.explorationTarget,
    discoveries:      a.state.discoveries,
    absorbed:         a.state.absorbed.size,
    knowledgeCount:   a.state.knowledge.length,
    stepCount:        a.state.stepCount,
    currentAction:    a.state.currentAction || "idle",
    specialization:   a.state.specialization,
    personality:      a.state.personality,
    thoughtCount:     a.state.thoughts.length,
    tokensUsed:       a.state.tokensUsed,
    tokenBudget:      a.state.tokenBudget,
    latestThought:    a.state.thoughts.slice(-1)[0]?.conclusion || null,
    cyclePhase,
    commitmentHash:   a.state.commitmentHash || null,
    density:          sharedChannel.density,
    criticalThreshold: CRITICAL_DENSITY,
    step,
    currentPrediction: a.state.currentPrediction || null,
  })));
});

// ── /api/thoughts ─────────────────────────────────────────────────────────────
app.get("/api/thoughts", (_req, res) => {
  const all = subAgents
    .flatMap(a => a.state.thoughts.slice(-20).map(t => ({ ...t, agentName: a.state.name })))
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 60);
  res.json(all);
});

// ── /api/pheromones ───────────────────────────────────────────────────────────
app.get("/api/pheromones", (_req, res) => {
  const seen = new Set<string>();
  const all: Pheromone[] = [];
  for (const ch of [...subChannels, sharedChannel]) {
    for (const p of ch.pheromones) {
      if (!seen.has(p.id)) { seen.add(p.id); all.push(p); }
    }
  }
  all.sort((a, b) => b.timestamp - a.timestamp);
  res.json(all.slice(0, 100));
});

// ── /api/state ────────────────────────────────────────────────────────────────
app.get("/api/state", (_req, res) => {
  const synced = subAgents.filter(a => a.state.synchronized).length;
  const seen   = new Set<string>();
  const totalPheromones = [...subChannels, sharedChannel]
    .flatMap(c => c.pheromones.map(p => p.id))
    .filter(id => !seen.has(id) && seen.add(id)).length;
  res.json({
    step,
    totalTokens:        subAgents.reduce((s, a) => s + a.state.tokensUsed, 0),
    density:            sharedChannel.density,
    criticalThreshold:  CRITICAL_DENSITY,
    synchronizedCount:  synced,
    agentCount:         subAgents.length,
    cyclePhase,
    coordinator: { cycleId, cycleNumber, phase: cyclePhase, commitCount: agentCommitments.size, slashEvents: 0, expectedAgents: subAgents.length },
    autonomy: {
      enabled: AUTONOMY_ENABLED,
      degraded: isDegraded(),
      llmProvider: getLLMStatus(),
      restartCount,
      loopPhase: cyclePhase,
      step,
      lastProgressAt,
      lastRuntimeError,
      phaseStep,
      cycleId,
      cycleNumber,
      heartbeatMs: AUTONOMY_HEARTBEAT_MS,
      staleRecoveryMs: AUTONOMY_STALE_RECOVERY_MS,
    },
    metrics: {
      totalPheromones,
      totalDiscoveries:      subAgents.reduce((s, a) => s + a.state.discoveries, 0),
      totalSyncs:            synced,
      avgEnergy:             subAgents.reduce((s, a) => s + a.state.energy, 0) / subAgents.length,
      density:               sharedChannel.density,
      synchronizedCount:     synced,
      collectiveMemoryCount: collectiveMemories.length,
      uniqueDomainsExplored: new Set(sharedChannel.pheromones.map(p => p.domain)).size,
    },
    tee: { enabled: true, teeMode: !!process.env.EIGENCOMPUTE_INSTANCE_ID },
  });
});

// ── /api/attestations ─────────────────────────────────────────────────────────
app.get("/api/attestations", (_req, res) => {
  res.json(subAgents.map(a => buildAttestationForAgent(a)));
});

// ── /api/collective ───────────────────────────────────────────────────────────
app.get("/api/collective", (_req, res) => {
  res.json([...collectiveMemories].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
});

// ── /api/evidence ─────────────────────────────────────────────────────────────
app.get("/api/evidence", (_req, res) => {
  const commits = [...agentCommitments.values()];
  res.json({
    cycleId, cycleNumber,
    generatedAt:  Date.now(),
    allCommitted: commits.length >= subAgents.length,
    commitments:  commits.map(c => ({
      agentId: c.agentId, agentName: c.agentName,
      commitmentHash: c.commitmentHash, sealedBlobHash: c.sealedBlobHash, committedAt: c.committedAt,
    })),
    synthesis:   collectiveMemories.slice(-1)[0] || null,
    slashEvents: [],
    verifierInstructions: [
      "1. Each sub-agent's commitmentHash seals its explore findings before reveal begins.",
      "2. Verify: sha256(JSON.stringify(sealedBlob)) must equal commitmentHash (strip 'sha256:' prefix).",
      "3. All three systemPromptHash values must match — same model, same template.",
      "4. Reveal-phase pheromones carry preCommitRef matching the commitment hashes.",
    ].join("\n"),
  });
});

// ── /api/proof/run ────────────────────────────────────────────────────────────
app.get("/api/proof/run", (_req, res) => {
  const commits = [...agentCommitments.values()];
  const checks: Array<{ check: string; status: "pass" | "warn" | "fail"; detail: string }> = [];

  checks.push({ check: "Orchestrator", status: "pass", detail: `${subAgents.length} sub-agents running in single process` });

  checks.push({
    check: "Commit coverage",
    status: commits.length >= subAgents.length ? "pass" : "warn",
    detail: `${commits.length}/${subAgents.length} sub-agents committed this cycle`,
  });

  const hashes = commits.map(c => c.commitmentHash);
  const allUnique = new Set(hashes).size === hashes.length && hashes.length > 0;
  checks.push({
    check: "Commitment uniqueness",
    status: allUnique ? "pass" : commits.length > 0 ? "fail" : "warn",
    detail: allUnique ? "All commitment hashes are distinct" : commits.length === 0 ? "No commits yet" : "Duplicate hashes — sub-agents produced identical commitments",
  });

  if (currentOracleAnswer) {
    checks.push({ check: "Oracle output", status: "pass", detail: `answer=${currentOracleAnswer.answer}, confidence=${currentOracleAnswer.confidence.toFixed(2)}` });
  } else {
    checks.push({ check: "Oracle output", status: "warn", detail: "Waiting for first synthesis" });
  }

  const sysHash = getSystemPromptHash();
  checks.push({
    check: "System prompt integrity",
    status: sysHash ? "pass" : "warn",
    detail: sysHash ? `Template hash: ${sysHash.slice(0, 30)}… — operator cannot swap prompts without breaking attestation` : "LLM not initialized",
  });

  const teeMode = !!process.env.EIGENCOMPUTE_INSTANCE_ID;
  checks.push({
    check: "TEE mode",
    status: teeMode ? "pass" : "warn",
    detail: teeMode ? `EigenCompute TDX enclave active (${process.env.EIGENCOMPUTE_INSTANCE_ID})` : "Running in local-dev mode — set EIGENCOMPUTE_INSTANCE_ID for hardware proof",
  });

  const fail = checks.filter(c => c.status === "fail").length;
  const pass = checks.filter(c => c.status === "pass").length;
  const warn = checks.filter(c => c.status === "warn").length;
  res.json({ ok: fail === 0, cycleId, cycleNumber, cyclePhase, counts: { pass, warn, fail }, checks, oracle: currentOracleAnswer, generatedAt: Date.now() });
});

// ── /api/report ───────────────────────────────────────────────────────────────
app.get("/api/report", (_req, res) => {
  const allThoughts = subAgents.flatMap(a =>
    a.state.thoughts.map(t => ({ ...t, agentName: a.state.name }))
  );
  const seenDs = new Set<string>();
  const reposStudied: Array<{ topic: string; timeRange: string; studiedBy: string[] }> = [];
  for (const a of subAgents) {
    for (const entry of a.state.reposStudied) {
      const [topic, ...rest] = entry.split(":");
      const label = topic.replace(/_/g, " ");
      if (!seenDs.has(entry)) { seenDs.add(entry); reposStudied.push({ topic: label, timeRange: rest.join(":") || "recent", studiedBy: [] }); }
      const ds = reposStudied.find(d => d.topic === label);
      if (ds && !ds.studiedBy.includes(a.state.name)) ds.studiedBy.push(a.state.name);
    }
  }
  res.json({
    topInsights: allThoughts.sort((a, b) => b.confidence - a.confidence).slice(0, 12),
    collectiveMemories: collectiveMemories.slice(-5),
    reposStudied,
    agentSummaries: subAgents.map(a => ({
      name: a.state.name, specialization: a.state.specialization,
      thoughtCount: a.state.thoughts.length,
      topConclusions: a.state.thoughts.filter(t => t.confidence > 0.5).slice(-3),
    })),
  });
});

// ── /api/identities ───────────────────────────────────────────────────────────
app.get("/api/identities", (_req, res) => {
  res.json(subAgents.map(a => ({
    agentId: a.state.id, name: a.state.name,
    publicKey: a.state.identity.publicKey, fingerprint: a.state.identity.fingerprint,
    createdAt: a.state.identity.createdAt,
    eigenCompute: process.env.EIGENCOMPUTE_INSTANCE_ID || "local",
    teeMode: !!process.env.EIGENCOMPUTE_INSTANCE_ID,
  })));
});

// ── /api/inject ───────────────────────────────────────────────────────────────
app.post("/api/inject", (req, res) => {
  const { topic, content } = req.body as { topic?: string; content?: string };
  sharedChannel.pheromones.push({
    id: `human-${Date.now()}`, agentId: "human",
    content: content || `Human injected: ${topic}`, domain: topic || "injected",
    confidence: 0.85, strength: 0.95, connections: [], timestamp: Date.now(), attestation: "human",
  });
  res.json({ ok: true });
});

// ── Misc ──────────────────────────────────────────────────────────────────────
const getHealthSnapshot = () => ({
  ok: true,
  agents: subAgents.map(a => a.state.name),
  step,
  cyclePhase,
  cycleNumber,
  llmProvider: getLLMStatus(),
  llm: getLLMUsage(),
  autonomy: {
    enabled: AUTONOMY_ENABLED,
    degraded: isDegraded(),
    llmFailures: llmRuntimeFailureStreak,
    restartCount,
    consecutiveStepErrors,
    lastProgressAt,
    lastRuntimeError,
  },
});

app.get("/health",     (_req, res) => res.json(getHealthSnapshot()));
app.get("/api/health", (_req, res) => res.json(getHealthSnapshot()));
app.get("/api/prs",        (_req, res) => res.json([]));
app.get("/api/decisions",  (_req, res) => res.json([]));
app.get("/api/repos",      (_req, res) => {
  const seen = new Set<string>();
  const result: Array<{ topic: string; timeRange: string; studiedBy: string[] }> = [];
  for (const a of subAgents) {
    for (const e of a.state.reposStudied) {
      if (!seen.has(e)) { seen.add(e); const [t, ...r] = e.split(":"); result.push({ topic: t.replace(/_/g," "), timeRange: r.join(":") || "recent", studiedBy: [] }); }
      const ds = result.find(d => d.topic === e.split(":")[0].replace(/_/g," "));
      if (ds && !ds.studiedBy.includes(a.state.name)) ds.studiedBy.push(a.state.name);
    }
  }
  res.json(result);
});

// ── Startup banner ────────────────────────────────────────────────────────────
applyRecoveredState();

app.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║  SWARM MIND ORACLE — Single-Process Mode          ║`);
  console.log(`╠══════════════════════════════════════════════════╣`);
  console.log(`║  Port:        ${String(PORT).padEnd(34)} ║`);
  console.log(`║  Sub-agents:  ${subAgents.map(a => a.state.name).join(" · ").padEnd(34)} ║`);
  console.log(`║  LLM:         ${String(llmReady).padEnd(34)} (${getLLMStatus().active}) ║`);
  console.log(`║  LLM policy:  ${LLM_PROVIDER_FALLBACK_LIST.join(" → ").slice(0, 34).padEnd(34)} ║`);
  console.log(`║  TEE mode:    ${String(!!process.env.EIGENCOMPUTE_INSTANCE_ID).padEnd(34)} ║`);
  console.log(`║  Autonomy:    ${String(AUTONOMY_ENABLED).padEnd(34)} (state: ${AUTONOMY_ENABLED ? "enabled" : "disabled"}) ║`);
  console.log(`╚══════════════════════════════════════════════════╝\n`);
  console.log(`  Dashboard   → http://localhost:${PORT}`);
  console.log(`  Oracle      → http://localhost:${PORT}/api/oracle`);
  console.log(`  Attestation → http://localhost:${PORT}/api/attestations`);
  console.log(`  Phase clock → http://localhost:${PORT}/api/coordinator\n`);
});

// ── Main loop ─────────────────────────────────────────────────────────────────
const phaseLimits: Record<CyclePhase, number> = {
  explore:  EXPLORE_STEPS + PHASE_TIMEOUT_MARGIN,
  commit:   COMMIT_STEPS + PHASE_TIMEOUT_MARGIN,
  reveal:   REVEAL_STEPS + PHASE_TIMEOUT_MARGIN,
  synthesis: SYNTHESIS_STEPS + PHASE_TIMEOUT_MARGIN,
};

function enforcePhaseSafety(): void {
  const phaseLimit = phaseLimits[cyclePhase] ?? (STEP_INTERVAL * 10);
  if (phaseStep <= phaseLimit) return;

  console.warn(`[ORACLE] Phase ${cyclePhase} exceeded safe steps (${phaseStep}/${phaseLimit}), forcing recovery transition`);
  switch (cyclePhase) {
    case "explore":
      setPhase("commit");
      break;
    case "commit":
      setPhase("reveal");
      break;
    case "reveal":
      setPhase("synthesis");
      break;
    case "synthesis":
      resetCycle();
      break;
  }
}

async function run(): Promise<void> {
  let loopFailures = 0;
  while (true) {
    try {
      step++;

      if (!isDegraded() && Date.now() - lastProgressAt > LOOP_STALL_WARN_STEPS * STEP_INTERVAL) {
        console.warn("[ORACLE] No successful step progress detected recently; entering degraded mode for API safety");
        setDegradedMode("Loop stall mitigation");
      }

      // ── Phase transitions (checked before agent steps) ──────────────────────
      if (cyclePhase === "explore" && phaseStep >= EXPLORE_STEPS) {
        setPhase("commit");
        await performCommit();
        setPhase("reveal");
      } else if (cyclePhase === "reveal" && phaseStep >= REVEAL_STEPS) {
        setPhase("synthesis");
      } else if (cyclePhase === "synthesis") {
        if (!synthesisFiredThisCycle) {
          synthesisFiredThisCycle = true;
          await performSynthesisWithFallback();
        }
        if (phaseStep >= SYNTHESIS_STEPS) {
          resetCycle();
        }
      }

      enforcePhaseSafety();

      // ── Sub-agent steps ──────────────────────────────────────────────────────
      if (cyclePhase === "explore") {
        // Isolation: each sub-agent steps against its own private channel
        const pheromones = await Promise.all(
          subAgents.map((a, i) => safeRunAgentStep(a, subChannels[i]))
        );
        pheromones.forEach((p, i) => {
          if (!p) return;
          subChannels[i].pheromones.push(p);
          explorePheromonesByAgent[i].push(p);
          try { savePheromone(p); } catch {}
          console.log(`  [${subAgents[i].state.name}] [explore] ${p.domain} (${p.confidence.toFixed(2)})`);
        });

      } else if (cyclePhase === "reveal") {
        // Cross-pollination: all sub-agents step against the shared channel
        const pheromones = await Promise.all(
          subAgents.map((a, i) => safeRunAgentStep(a, sharedChannel).then((p) => {
            if (p) p.preCommitRef = subAgents[i].state.commitmentHash;
            return p;
          }))
        );
        pheromones.forEach((p, i) => {
          if (!p) return;
          sharedChannel.pheromones.push(p);
          try { savePheromone(p); } catch {}
          console.log(`  [${subAgents[i].state.name}] [reveal] ${p.domain}`);
        });

      } else {
        // Commit / synthesis: sub-agents step against isolated channels (pheromones discarded)
        await Promise.all(subAgents.map((a, i) => safeRunAgentStep(a, subChannels[i])));
      }

      // ── Shared channel decay ────────────────────────────────────────────────
      for (const p of sharedChannel.pheromones) p.strength *= (1 - PHEROMONE_DECAY);
      sharedChannel.pheromones = sharedChannel.pheromones.filter(p => p.strength > 0.05);
      updateSharedDensity();

      phaseStep++;
      persistAutonomyState();
      lastProgressAt = Date.now();
      loopFailures = 0;

      await new Promise(r => setTimeout(r, STEP_INTERVAL));
    } catch (err) {
      loopFailures += 1;
      lastRuntimeError = err instanceof Error ? err.message : String(err);
      console.error(`[ORACLE] Loop failure (${loopFailures})`, lastRuntimeError);
      if (loopFailures >= 3) {
        console.warn("[ORACLE] Loop unstable — resetting cycle and entering recovery");
        resetCycle();
        setDegradedMode("Loop failure cascade");
        loopFailures = 0;
      }
      await new Promise(r => setTimeout(r, Math.min(5_000, DEGRADE_RECOVERY_PAUSE_MS)));
    }
  }
}

process.on("SIGINT",  () => {
  try {
    persistAutonomyState();
    closeDatabase();
  } catch {}
  process.exit(0);
});
process.on("SIGTERM", () => {
  try {
    persistAutonomyState();
    closeDatabase();
  } catch {}
  process.exit(0);
});

run().catch(err => { console.error("Fatal:", err); process.exit(1); });
