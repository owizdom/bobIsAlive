/**
 * Task Engine — Manages task queue and LLM-powered execution.
 *
 * The organism picks up tasks, executes them using LLM + web search,
 * and delivers results. Every completed task is Ed25519-attested.
 */

import { v4 as uuid } from "uuid";
import type { Task, TaskType, TaskStatus } from "./organism-types";
import { TASK_REWARDS } from "./organism-types";
import { buildAttestation } from "./keystore";
import { researchClaim, formatResearchContext, isSearchEnabled } from "./research";
import { Metabolism } from "./metabolism";

// ── LLM Integration (reuse thinker core) ──────────────────────────────────

import { initThinker, getSystemPromptHash, getModelName, getActiveLLMProvider } from "./thinker";
export { initThinker, getSystemPromptHash, getModelName, getActiveLLMProvider };

// We import callLLM indirectly — thinker exports formThought but we need raw LLM
// Recreate a simple callLLM wrapper using the same client
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import type { LLMConfig } from "./organism-types";

let llmClient: { call: (system: string, user: string, maxTokens?: number) => Promise<{ content: string; tokensUsed: number }> } | null = null;

export function getLLMClient() { return llmClient; }

export function initLLMClient(config: LLMConfig): void {
  if (config.provider === "anthropic") {
    const client = new Anthropic({ apiKey: config.apiKey });
    llmClient = {
      async call(system: string, user: string, maxTokens = 800) {
        try {
          const res = await client.messages.create({
            model: config.model, max_tokens: maxTokens, temperature: 0.7,
            system, messages: [{ role: "user", content: user }],
          });
          let content = "";
          for (const b of res.content) { if (b.type === "text") content += b.text; }
          const tokens = (res.usage?.input_tokens || 0) + (res.usage?.output_tokens || 0);
          return { content: content.trim(), tokensUsed: tokens };
        } catch (e) {
          console.error(`[LLM] Error: ${e instanceof Error ? e.message.slice(0, 100) : e}`);
          return { content: "", tokensUsed: 0 };
        }
      }
    };
  } else {
    const client = new OpenAI({ baseURL: config.apiUrl, apiKey: config.apiKey });
    llmClient = {
      async call(system: string, user: string, maxTokens = 800) {
        try {
          const res = await client.chat.completions.create({
            model: config.model, max_tokens: maxTokens, temperature: 0.7, stream: false,
            messages: [{ role: "system", content: system }, { role: "user", content: user }],
          }) as OpenAI.ChatCompletion;
          const content = res.choices?.[0]?.message?.content || "";
          const tokens = (res.usage?.prompt_tokens || 0) + (res.usage?.completion_tokens || 0);
          return { content, tokensUsed: tokens };
        } catch (e) {
          console.error(`[LLM] Error: ${e instanceof Error ? e.message.slice(0, 100) : e}`);
          return { content: "", tokensUsed: 0 };
        }
      }
    };
  }
}

// ── Task Queue ────────────────────────────────────────────────────────────

const taskQueue: Task[] = [];

export function submitTask(type: TaskType, input: string, customReward?: number): Task {
  const task: Task = {
    id: uuid(),
    type,
    input,
    reward: customReward ?? TASK_REWARDS[type],
    status: "pending",
    result: null,
    attestation: null,
    submittedAt: Date.now(),
    claimedAt: null,
    completedAt: null,
    tokensUsed: 0,
    costIncurred: 0,
    sources: [],
  };
  taskQueue.push(task);
  console.log(`[TASK] Submitted: ${type} — "${input.slice(0, 60)}..." (+${task.reward} cr)`);
  return task;
}

export function getNextPendingTask(): Task | null {
  return taskQueue.find(t => t.status === "pending") || null;
}

export function getAllTasks(): Task[] {
  return [...taskQueue].sort((a, b) => b.submittedAt - a.submittedAt);
}

export function getCompletedTasks(): Task[] {
  return taskQueue.filter(t => t.status === "completed").sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
}

// ── Task Execution ────────────────────────────────────────────────────────

const SYSTEM_PROMPTS: Record<TaskType, string> = {
  review: `You are an expert code reviewer inside a Trusted Execution Environment. Analyze the provided code for:
- Security vulnerabilities (injection, XSS, auth issues)
- Bug risks and edge cases
- Performance concerns
- Code quality and best practices
Be specific. Cite line numbers or code snippets. Provide actionable recommendations.`,

  research: `You are a research analyst inside a Trusted Execution Environment. Answer the question with:
- Specific facts, data, and evidence
- Citations from web sources when available
- Multiple perspectives on the topic
- A clear, well-reasoned conclusion
Be thorough but concise. Cite your sources.`,

  summarize: `You are a summarization specialist inside a Trusted Execution Environment. Produce:
- A concise executive summary (2-3 sentences)
- Key points as bullet points
- Important details, numbers, or quotes
- Any caveats or missing context
Be accurate. Don't add information not in the source.`,

  analyze: `You are a strategic analyst inside a Trusted Execution Environment. Analyze the claim/thesis:
- Arguments FOR the position
- Arguments AGAINST the position
- Evidence and data supporting each side
- Your assessment of the strongest position
- Confidence level and key uncertainties
Be balanced but decisive. Take a position.`,
};

export async function executeTask(
  task: Task,
  metabolism: Metabolism,
  agentId: string,
  privateKey: string,
  publicKey: string
): Promise<Task> {
  if (!llmClient) {
    task.status = "failed";
    task.result = "LLM not initialized";
    return task;
  }

  task.status = "working";
  task.claimedAt = Date.now();
  console.log(`[ORGANISM] Working on: ${task.type} #${task.id.slice(0, 8)}`);

  // Step 1: Web research (if enabled and task benefits from it)
  let researchContext = "";
  if (isSearchEnabled() && (task.type === "research" || task.type === "analyze")) {
    try {
      const research = await researchClaim(task.input, "arbiter");
      if (research) {
        researchContext = "\n\n[WEB EVIDENCE]:\n" + formatResearchContext(research);
        task.sources = research.sources.map(s => s.url);
        metabolism.deductSearch(task.id);
        task.costIncurred += 0.5;
        console.log(`  [RESEARCH] Found ${research.sources.length} sources`);
      }
    } catch { /* search failed, continue with LLM knowledge */ }
  }

  // Step 2: LLM execution
  const systemPrompt = SYSTEM_PROMPTS[task.type];
  const userPrompt = `${task.input}${researchContext}`;

  const { content, tokensUsed } = await llmClient.call(systemPrompt, userPrompt, 1200);

  if (!content) {
    task.status = "failed";
    task.result = "LLM returned empty response";
    task.tokensUsed = tokensUsed;
    return task;
  }

  // Step 3: Track costs
  task.tokensUsed = tokensUsed;
  const inferenceCost = tokensUsed * 0.001;
  task.costIncurred += inferenceCost;
  metabolism.deductInference(tokensUsed, task.id);

  // Step 4: Deliver result
  task.status = "completed";
  task.result = content;
  task.completedAt = Date.now();

  // Step 5: Attestation — prove this result was produced inside the TEE
  const ts = Date.now();
  task.attestation = buildAttestation(
    `task:${task.id}:${task.type}:${content.slice(0, 100)}`,
    agentId, ts, privateKey, publicKey
  );

  // Step 6: Collect payment
  metabolism.earn(task.reward, `Task completed: ${task.type} #${task.id.slice(0, 8)}`, task.id);

  const profit = task.reward - task.costIncurred;
  console.log(`  [COMPLETED] ${task.type} — earned ${task.reward} cr, cost ${task.costIncurred.toFixed(3)} cr, profit ${profit.toFixed(3)} cr`);

  return task;
}
