import crypto from "crypto";

// ── Task Types ──────────────────────────────────────────────────────────────

export type TaskType = "review" | "research" | "summarize" | "analyze";
export type TaskStatus = "pending" | "claimed" | "working" | "completed" | "failed";

export interface Task {
  id: string;
  type: TaskType;
  input: string;
  reward: number;
  status: TaskStatus;
  result: string | null;
  attestation: string | null;
  submittedAt: number;
  claimedAt: number | null;
  completedAt: number | null;
  tokensUsed: number;
  costIncurred: number;
  sources: string[];       // URLs from web research
}

export const TASK_REWARDS: Record<TaskType, number> = {
  review: 5.0,
  research: 8.0,
  summarize: 3.0,
  analyze: 6.0,
};

// ── Organism State ──────────────────────────────────────────────────────────

export type OrganismStatus = "alive" | "dead";
export type ActivityState = "idle" | "scanning" | "working" | "self-work" | "reading" | "contemplating";

export interface OrganismState {
  id: string;
  status: OrganismStatus;
  activity: ActivityState;
  balance: number;
  totalEarned: number;
  totalSpent: number;
  tasksCompleted: number;
  tasksFailed: number;
  tokensUsed: number;
  bornAt: number;
  diedAt: number | null;
  currentTaskId: string | null;
  tickCount: number;
  identity: {
    publicKey: string;
    fingerprint: string;
    createdAt: number;
  };
}

// ── Metabolism ───────────────────────────────────────────────────────────────

export interface EarningsEntry {
  id: string;
  type: "earn" | "burn" | "inference" | "search";
  amount: number;          // positive = income, negative = cost
  balance: number;         // balance after this entry
  description: string;
  taskId: string | null;
  attestation: string | null;
  timestamp: number;
}

export interface MetabolismSnapshot {
  balance: number;
  burnRate: number;        // credits/second (passive compute cost)
  earnRate: number;        // credits/second (recent average)
  netRate: number;         // earn - burn
  ttd: number;             // time-to-death in seconds (-1 if net positive)
  efficiency: number;      // earned / spent ratio
  alive: boolean;
  uptime: number;          // seconds since born
  tickCount: number;
}

// ── Costs ────────────────────────────────────────────────────────────────────

export const COSTS = {
  PASSIVE_BURN_PER_TICK: 0.05,    // credits per tick (~5s)
  INFERENCE_PER_TOKEN: 0.001,     // credits per token used
  WEB_SEARCH: 0.5,                // credits per Tavily search
  STARTING_BALANCE: 100.0,
};

// ── LLM Config (reused from thinker) ─────────────────────────────────────────

export interface LLMConfig {
  provider: "eigenai" | "openai" | "anthropic" | "groq" | "grok" | "local";
  apiUrl: string;
  apiKey: string;
  model: string;
}

// ── Utilities ────────────────────────────────────────────────────────────────

export function hash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}
