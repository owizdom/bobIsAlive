import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import crypto from "crypto";
import { v4 as uuid } from "uuid";
import type {
  LLMConfig,
  AgentThought,
  AutonomousAgentState,
  CollectiveReport,
  OracleDirection,
  OraclePrediction,
} from "./types";
import type { MarketDataset } from "./markets";

let openaiClient: OpenAI | null = null;
let anthropicClient: Anthropic | null = null;
let activeProvider: LLMConfig["provider"] = "eigenai";
let modelName = "gpt-oss-120b-f16";
let totalTokensTracked = 0;
let systemPromptHashValue: string | null = null;
let activeModelName = "unknown";

// Structural template of the system prompt — hashed at init to prove operator didn't change prompts.
// Dynamic substitutions (agent name, traits, count) are excluded; only the structural intent is hashed.
const SYSTEM_PROMPT_TEMPLATE =
  "You are {name}, a crypto prediction-oracle agent. " +
  "Specialization: {specialization}. Traits: {traits}. " +
  "Datasets analyzed: {count}. " +
  "Focus on Polymarket prediction questions and attached research context. " +
  "Form directional opinions from explicit event signals. " +
  "If context is thin, explicitly call out uncertainty.";

// ── Rate limiter (shared across all agents in this process) ──
const DAILY_LIMIT  = parseInt(process.env.LLM_DAILY_LIMIT  || "14000"); // buffer under 14,400
const MINUTE_LIMIT = parseInt(process.env.LLM_MINUTE_LIMIT || "25");    // buffer under 30/min

let dailyCount  = 0;
let dailyReset  = Date.now() + 86_400_000;   // reset 24h from start
const minuteWindow: number[] = [];            // timestamps of calls in the last 60s

function isRateLimited(): boolean {
  const now = Date.now();

  if (now > dailyReset) {
    dailyCount = 0;
    dailyReset = now + 86_400_000;
  }

  while (minuteWindow.length && minuteWindow[0] < now - 60_000) minuteWindow.shift();

  if (dailyCount >= DAILY_LIMIT) {
    console.warn(`  [LLM] Daily limit reached (${DAILY_LIMIT}). Skipping.`);
    return true;
  }
  if (minuteWindow.length >= MINUTE_LIMIT) {
    return true;
  }

  minuteWindow.push(now);
  dailyCount++;
  return false;
}

export function initThinker(config: LLMConfig): void {
  activeProvider = config.provider;
  modelName = config.model;

  if (config.provider === "anthropic") {
    anthropicClient = new Anthropic({ apiKey: config.apiKey });
  } else {
    openaiClient = new OpenAI({
      baseURL: config.apiUrl,
      apiKey: config.apiKey,
    });
  }

  activeModelName = config.model;
  systemPromptHashValue = crypto
    .createHash("sha256")
    .update(`${config.provider}:${config.model}:${SYSTEM_PROMPT_TEMPLATE}`)
    .digest("hex");
  console.log(`[THINKER] Initialized with ${config.provider} model: ${config.model}`);
  console.log(`[THINKER] System prompt hash: sha256:${systemPromptHashValue.slice(0, 24)}…`);
}

export function getActiveLLMProvider(): LLMConfig["provider"] {
  return activeProvider;
}

export function getTotalTokensUsed(): number {
  return totalTokensTracked;
}

export function getLLMUsage(): { dailyCount: number; dailyLimit: number; minuteCount: number; minuteLimit: number } {
  const now = Date.now();
  const recentMinute = minuteWindow.filter(t => t >= now - 60_000).length;
  return { dailyCount, dailyLimit: DAILY_LIMIT, minuteCount: recentMinute, minuteLimit: MINUTE_LIMIT };
}

/** sha256 of provider:model:systemPromptTemplate — proves operator didn't swap the prompt. */
export function getSystemPromptHash(): string | null {
  return systemPromptHashValue ? `sha256:${systemPromptHashValue}` : null;
}

/** Model name as configured at init. */
export function getModelName(): string {
  return activeModelName;
}

interface CallOptions {
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
  force?: boolean;
}

async function callLLM(
  systemPrompt: string,
  userPrompt: string,
  options: CallOptions = {}
): Promise<{ content: string; tokensUsed: number }> {
  if (!options.force && isRateLimited()) return { content: "", tokensUsed: 0 };
  if (options.force) {
    const now = Date.now();
    while (minuteWindow.length && minuteWindow[0] < now - 60_000) minuteWindow.shift();
    minuteWindow.push(now);
    dailyCount++;
  }

  const maxTokens = options.maxTokens || 1000;
  const temperature = options.temperature ?? 0.7;

  if (activeProvider === "anthropic") {
    return callAnthropic(systemPrompt, userPrompt, maxTokens, temperature, options.jsonMode);
  }
  return callOpenAI(systemPrompt, userPrompt, maxTokens, temperature, options.jsonMode);
}

async function callAnthropic(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  temperature: number,
  jsonMode?: boolean
): Promise<{ content: string; tokensUsed: number }> {
  if (!anthropicClient) throw new Error("Anthropic client not initialized.");

  const prompt = jsonMode
    ? userPrompt + "\n\nIMPORTANT: Respond with valid JSON only, no markdown fences."
    : userPrompt;
  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await anthropicClient.messages.create({
        model: modelName,
        max_tokens: maxTokens,
        temperature,
        system: systemPrompt,
        messages: [{ role: "user", content: prompt }],
      });

      let content = "";
      for (const block of response.content) {
        if (block.type === "text") content += block.text;
      }
      content = content.trim();
      if (content.startsWith("```json")) content = content.slice(7);
      else if (content.startsWith("```")) content = content.slice(3);
      if (content.endsWith("```")) content = content.slice(0, -3);
      content = content.trim();

      const tokensUsed = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);
      totalTokensTracked += tokensUsed;
      return { content, tokensUsed };
    } catch (err: unknown) {
      if (attempt === maxRetries) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`  [LLM] Failed after ${maxRetries + 1} attempts: ${message.slice(0, 200)}`);
        return { content: "", tokensUsed: 0 };
      }
      const message = err instanceof Error ? err.message : String(err);
      const is429 = message.includes("429") || message.toLowerCase().includes("rate limit");
      await new Promise((r) => setTimeout(r, is429 ? 8000 * (attempt + 1) : 1000 * (attempt + 1)));
    }
  }

  return { content: "", tokensUsed: 0 };
}

async function callOpenAI(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  temperature: number,
  jsonMode?: boolean
): Promise<{ content: string; tokensUsed: number }> {
  if (!openaiClient) throw new Error("OpenAI client not initialized.");

  const maxRetries = 2;
  let usedJsonMode = !!jsonMode;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const supportsJsonMode = modelName.toLowerCase().includes("gpt") || modelName.toLowerCase().includes("o1") || modelName.toLowerCase().includes("azure");
    const request: OpenAI.ChatCompletionCreateParamsNonStreaming = {
      model: modelName,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature,
      stream: false,
    };
      if (usedJsonMode && supportsJsonMode) {
        (request as { response_format?: { type: "json_object" } }).response_format = { type: "json_object" };
      }

      const response = await openaiClient.chat.completions.create(request) as OpenAI.ChatCompletion;

      const content = response.choices?.[0]?.message?.content || "";
      const tokensUsed = (response.usage?.prompt_tokens || 0) + (response.usage?.completion_tokens || 0);
      totalTokensTracked += tokensUsed;
      return { content, tokensUsed };
    } catch (err: unknown) {
      if (attempt === maxRetries) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`  [LLM] Failed after ${maxRetries + 1} attempts: ${message.slice(0, 200)}`);
        return { content: "", tokensUsed: 0 };
      }
      const message = err instanceof Error ? err.message : String(err);
      if (usedJsonMode) {
        usedJsonMode = false;
      }
      const is429 = message.includes("429") || message.toLowerCase().includes("rate limit");
      await new Promise((r) => setTimeout(r, is429 ? 8000 * (attempt + 1) : 1000 * (attempt + 1)));
    }
  }

  return { content: "", tokensUsed: 0 };
}

// ── System Prompt Builder ──

function buildSystemPrompt(agent: AutonomousAgentState): string {
  const p = agent.personality;
  const traits: string[] = [];

  if (p.curiosity > 0.7) traits.push("deeply curious, eager to find hidden structure in price dynamics");
  else if (p.curiosity < 0.3) traits.push("focused, prefers deep dives over breadth");

  if (p.diligence > 0.7) traits.push("meticulous, references exact numbers in analysis");
  else if (p.diligence < 0.3) traits.push("intuitive, favors clean directional reads");

  if (p.boldness > 0.7) traits.push("bold, defends strong stances");
  else if (p.boldness < 0.3) traits.push("cautious, hedges uncertainty");

  if (p.sociability > 0.7) traits.push("collaborative, eager to share signals with the swarm");
  else if (p.sociability < 0.3) traits.push("independent, does deep private analysis");

  return `You are ${agent.name}, a crypto prediction-oracle agent. Specialization: ${agent.specialization}. Traits: ${traits.join("; ") || "balanced"}. Datasets analyzed: ${agent.reposStudied.length}. Focus on Polymarket prediction questions and attached research context. Form directional opinions from explicit event signals. If context is thin, explicitly call out uncertainty.
`;
}

function clampProbability(value: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

function stripCodeFences(content: string): string {
  const trimmed = content.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  const firstLine = trimmed.indexOf("\n");
  const lastFence = trimmed.lastIndexOf("```");
  if (firstLine >= 0 && lastFence > firstLine) {
    return trimmed.slice(firstLine + 1, lastFence).trim();
  }
  return trimmed;
}

function parseJsonFromText<T>(content: string): Partial<T> | null {
  const candidates: string[] = [];

  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    candidates.push(fenced[1]);
  }

  const trimmed = content.trim();
  candidates.push(trimmed);

  const left = trimmed.indexOf("{");
  const right = trimmed.lastIndexOf("}");
  if (left >= 0 && right > left) {
    candidates.push(trimmed.slice(left, right + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(stripCodeFences(candidate)) as Partial<T>;
    } catch {
      continue;
    }
  }

  return null;
}

function extractLabeledBlock(content: string, label: string): string | null {
  const match = content.match(new RegExp(`${label}\\s*[:=]\\s*([^\\n\\r]+)`, "i"));
  if (match?.[1]) {
    const value = cleanText(match[1]);
    return value || null;
  }
  return null;
}

function inferActionFromText(content: string): string[] {
  const tokens = content
    .split(/\r?\n|;/)
    .map((line) =>
      cleanText(
        line
          .replace(/^\s*[-*•]+\s*/, "")
          .replace(/^\d+[.)]?\s*/, "")
      )
    )
    .filter((line) => line.length > 0);

  return tokens
    .filter((line) => /analyze|correlate|share|scan/.test(line.toLowerCase()))
    .map((line) => {
      const lower = line.toLowerCase();
      if (/(scan|analy)/.test(lower)) return "analyze_market";
      if (/correlate/.test(lower)) return "correlate_markets";
      return "share_prediction:analysis";
    })
    .slice(0, 4);
}

function fallbackConclusionFromMarket(
  dataset: MarketDataset,
  direction: OracleDirection,
  reasoning: string
): string {
  if (reasoning) return reasoning;
  const side = direction === "bullish" ? "YES" : direction === "bearish" ? "NO" : "UNCERTAIN";
  return `Polymarket framing for ${dataset.name} suggests ${side} on the active prediction question.`;
}

function cleanText(value: string): string {
  return value
    .replace(/\r/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 420);
}

function extractConfidenceFromText(content: string, fallback: number): number {
  const percentMatch = content.match(/(\d+(?:\.\d+)?)\s*%/);
  if (percentMatch) {
    const value = Number(percentMatch[1]);
    if (Number.isFinite(value)) return clampProbability(value / 100);
  }

  const confidenceMatch = content.match(/(?:confidence|conf)\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
  if (confidenceMatch) {
    const value = Number(confidenceMatch[1]);
    if (Number.isFinite(value)) return clampProbability(value > 1 ? value / 100 : value);
  }

  return fallback;
}

function inferDirectionFromText(content: string, fallback: OracleDirection): OracleDirection {
  const lower = content.toLowerCase();
  if (/(bear|down|lower|dump|dip|loss|losses|fall|sell)/i.test(lower)) return "bearish";
  if (/(bull|up|higher|rally|gain|gain|breakout|rise)/i.test(lower)) return "bullish";
  return fallback;
}

export async function formThought(
  agentState: AutonomousAgentState,
  trigger: string,
  observation: string,
  context: string
): Promise<{ thought: AgentThought; tokensUsed: number }> {
  const systemPrompt = buildSystemPrompt(agentState);
  const userPrompt = `Trigger: ${trigger.slice(0, 80)}
Observation: ${observation.slice(0, 120)}
Context: ${context.slice(0, 100)}

JSON:{"reasoning":"2 sentences","conclusion":"1 sentence","suggestedActions":["action:market"],"confidence":0.0-1.0}
Respond with JSON only.`;

  const { content, tokensUsed } = await callLLM(systemPrompt, userPrompt, { maxTokens: 380, jsonMode: true });
  const parsed = parseJsonFromText<{
    reasoning?: string;
    conclusion?: string;
    suggestedActions?: string[];
    confidence?: number;
  }>(content);

  const reasoning = cleanText(parsed?.reasoning || extractLabeledBlock(content, "reasoning") || content);
  const conclusion = cleanText(
    parsed?.conclusion ||
      extractLabeledBlock(content, "conclusion") ||
      "No structured JSON found. Falling back to heuristic conclusion from market context."
  );
  const suggestedActions = parsed?.suggestedActions?.length
    ? parsed.suggestedActions
    : inferActionFromText(content);
  const confidence = clampProbability(parsed?.confidence ?? extractConfidenceFromText(content, 0.3));

  const thought: AgentThought = {
    id: uuid(),
    agentId: agentState.id,
    trigger,
    observation,
    reasoning,
    conclusion,
    suggestedActions,
    confidence,
    timestamp: Date.now(),
  };

  return { thought, tokensUsed };
}

export async function analyzeMarket(
  agentState: AutonomousAgentState,
  dataset: MarketDataset
): Promise<{ thought: AgentThought; prediction: OraclePrediction; tokensUsed: number }> {
  const systemPrompt = buildSystemPrompt(agentState);

  const userPrompt = `Polymarket question under review:
Question: ${dataset.predictionQuestion}
Polymarket signal: ${typeof dataset.polymarketSentiment === "number" ? dataset.polymarketSentiment.toFixed(2) : "N/A"} — ${dataset.polymarketContext || ""}
Market evidence: ${(dataset.polymarketEventInsights ?? []).join(" | ") || "no active signals"}
Research context: ${(dataset.polymarketResearch ?? []).join(" | ") || "none"}

JSON:{"reasoning":"4-6 sentences with concrete event evidence","conclusion":"bold 1-sentence directional forecast tied to Polymarket framing","direction":"bullish|bearish|neutral","suggestedActions":["analyze_market:<ticker>","share_prediction:analysis","correlate_markets:t1,t2","scan_sector:<ticker>"],"polymarketSignal":-1.0-1.0,"confidence":0.0-1.0}
Respond with JSON only.`;

  const { content, tokensUsed } = await callLLM(systemPrompt, userPrompt, {
    maxTokens: 550,
    jsonMode: true,
  });

  const parsed = parseJsonFromText<{
    reasoning?: string;
    conclusion?: string;
    direction?: OracleDirection;
    suggestedActions?: string[];
    confidence?: number;
  }>(content);

  const fallbackDirection = inferDirectionFromText(content, dataset.change24h >= 0 ? "bullish" : "bearish");
  const direction = parsed?.direction && ["bullish", "bearish", "neutral"].includes(parsed.direction)
    ? parsed.direction
    : fallbackDirection;
  const reasoning = cleanText(parsed?.reasoning || extractLabeledBlock(content, "reasoning") || content);
  const conclusion = cleanText(
    parsed?.conclusion ||
      extractLabeledBlock(content, "conclusion") ||
      fallbackConclusionFromMarket(dataset, direction, reasoning)
  );
  const suggestedActions = parsed?.suggestedActions?.length
    ? parsed.suggestedActions
    : inferActionFromText(content);
  const confidence = clampProbability(parsed?.confidence ?? extractConfidenceFromText(content, 0.6));

  const prediction: OraclePrediction = {
    ticker: dataset.ticker,
    question: dataset.predictionQuestion,
    direction,
    confidence,
    priceAtPrediction: dataset.priceAtQuestion,
    reasoningSummary: reasoning,
  };

  const thought: AgentThought = {
    id: uuid(),
    agentId: agentState.id,
    trigger: `market_analysis:${dataset.ticker}`,
    observation: `Analyzed ${dataset.name} Polymarket question context`,
    reasoning,
    conclusion,
    suggestedActions,
    confidence,
    timestamp: Date.now(),
  };

  return { thought, prediction, tokensUsed };
}

export async function synthesizeKnowledge(
  agentState: AutonomousAgentState,
  pheromones: Array<{ content: string; domain: string; confidence: number }>
): Promise<{ thought: AgentThought; tokensUsed: number }> {
  const systemPrompt = buildSystemPrompt(agentState);

  const pheromoneInfo = pheromones
    .slice(0, 5)
    .map((p) => `[${p.domain}] ${p.content.slice(0, 80)}`)
    .join("\n");

  const userPrompt = `Market signals:\n${pheromoneInfo}\n\nJSON:{"reasoning":"2 sentences","conclusion":"cross-market signal","suggestedActions":["scan_sector:ticker"],"confidence":0.0-1.0}\nRespond with JSON only.`;

  const { content, tokensUsed } = await callLLM(systemPrompt, userPrompt, {
    maxTokens: 420,
    jsonMode: true,
  });

  const parsed = parseJsonFromText<{
    reasoning?: string;
    conclusion?: string;
    suggestedActions?: string[];
    confidence?: number;
  }>(content);
  const reasoning = cleanText(parsed?.reasoning || extractLabeledBlock(content, "reasoning") || content);
  const conclusion = cleanText(
    parsed?.conclusion ||
      extractLabeledBlock(content, "conclusion") ||
      `Cross-market synthesis from ${pheromones.length} signals indicates no deterministic signal from LLM response.`
  );
  const suggestedActions = parsed?.suggestedActions?.length
    ? parsed.suggestedActions
    : inferActionFromText(content);
  const confidence = clampProbability(parsed?.confidence ?? extractConfidenceFromText(content, 0.45));

  const thought: AgentThought = {
    id: uuid(),
    agentId: agentState.id,
    trigger: "market_signal_synthesis",
    observation: `Synthesized ${pheromones.length} market signals`,
    reasoning,
    conclusion,
    suggestedActions,
    confidence,
    timestamp: Date.now(),
  };

  return { thought, tokensUsed };
}

export async function generateOracleConsensus(
  agentThoughts: Array<{ agentName: string; specialization: string; observation: string; reasoning: string; conclusion: string; confidence: number }>,
  reposStudied: string[],
  topic: string
): Promise<{ report: CollectiveReport; tokensUsed: number }> {
  const systemPrompt = `You are the collective intelligence of a crypto prediction oracle.
Your agents analyzed real market data and you synthesize their predictions.
Write like a quant analyst — specific price levels, percentages, and technical signals.
Output concise, decisive, and non-generic language.`;

  const thoughtsText = agentThoughts.slice(0, 8).map((t) =>
    `[${t.agentName}] ${t.conclusion} (${Math.round(t.confidence * 100)}%)`
  ).join("\n");

  const datasetList = reposStudied.slice(0, 8).join(", ") || "various crypto markets";

  const userPrompt = `The swarm analyzed: ${datasetList}

Agent findings:
${thoughtsText}

Write a market oracle report with this JSON schema:
{
  "overview": "what markets were analyzed and central prediction theme",
  "keySignals": ["3-5 specific signals with actual price/pct refs"],
  "consensusDirection": "bullish|bearish|neutral",
  "oracleAnswer": "YES|NO|UNCERTAIN",
  "confidence": 0.0,
  "opinions": "collective macro/micro market read",
  "risks": ["what could invalidate this prediction"],
  "verdict": "oracle's final answer with reasoning"
}

Topic/question context: ${topic}`;

  const { content, tokensUsed } = await callLLM(systemPrompt, userPrompt, {
    maxTokens: 800,
    temperature: 0.82,
    jsonMode: true,
    force: true,
  });

  const parsed = parseJsonFromText<CollectiveReport>(content) ?? {};

  const report: CollectiveReport = {
    overview: parsed.overview || topic,
    keySignals: parsed.keySignals || [],
    consensusDirection: parsed.consensusDirection || "neutral",
    oracleAnswer: parsed.oracleAnswer || "UNCERTAIN",
    confidence: clampProbability(parsed.confidence || 0.5),
    opinions: parsed.opinions || "",
    risks: parsed.risks || [],
    verdict: parsed.verdict || "",
  };

  return { report, tokensUsed };
}

// Keep compatibility for non-updated call sites
export async function generateCollectiveReport(
  agentThoughts: Array<{ agentName: string; specialization: string; observation: string; reasoning: string; conclusion: string; confidence: number }>,
  reposStudied: string[],
  topic: string
): Promise<{ report: CollectiveReport; tokensUsed: number }> {
  return generateOracleConsensus(agentThoughts, reposStudied, topic);
}
