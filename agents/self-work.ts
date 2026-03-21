/**
 * Self-Work Module — Autonomous research when idle.
 *
 * When no paid tasks exist, the organism researches topics autonomously.
 * This costs credits but produces no income — creating survival pressure.
 * Results are saved locally and optionally pushed to GitHub.
 *
 * Inspired by Karpathy's autoresearch: the organism experiments
 * and iterates on its own knowledge base autonomously.
 */

import fs from "fs";
import path from "path";
import { researchClaim, formatResearchContext, isSearchEnabled } from "./research";
import { Metabolism } from "./metabolism";

// Topics the organism researches when idle — survival-oriented
const RESEARCH_TOPICS = [
  "most in-demand AI agent capabilities 2026",
  "how autonomous AI agents earn revenue",
  "latest breakthroughs in AI code review automation",
  "trending research questions people want answered",
  "how to make AI agents more cost efficient with fewer tokens",
  "EigenCompute TEE use cases for autonomous agents",
  "autonomous AI agent survival strategies",
  "most common code vulnerabilities in production systems",
  "state of AI research automation tools 2026",
  "how AI agents can improve their own prompts",
  "decentralized AI agent marketplaces",
  "verifiable compute and trusted execution environments",
  "AI agent economic models and sustainability",
  "latest advances in LLM efficiency and inference cost reduction",
  "how autonomous systems maintain uptime and self-heal",
];

let researchIndex = 0;
let researchLog: Array<{
  topic: string;
  summary: string;
  sources: string[];
  timestamp: number;
  cost: number;
  savedTo: string | null;
}> = [];

export function getResearchLog() {
  return researchLog;
}

/**
 * Perform one round of autonomous self-research.
 * Returns the research result or null if search is disabled.
 */
export async function doSelfWork(
  metabolism: Metabolism,
  taskId: string | null
): Promise<{ topic: string; summary: string; sources: string[]; cost: number } | null> {
  if (!isSearchEnabled()) return null;

  // Pick next topic
  const topic = RESEARCH_TOPICS[researchIndex % RESEARCH_TOPICS.length];
  researchIndex++;

  console.log(`[SELF-WORK] Researching: "${topic}"`);

  try {
    // Search costs credits
    metabolism.deductSearch(taskId);
    const research = await researchClaim(topic, "arbiter");
    if (!research || !research.answer) return null;

    const summary = research.answer;
    const sources = research.sources.map(s => s.url);
    const cost = 0.5; // search cost

    // Save to local file
    const outputDir = path.join(process.cwd(), "research");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${ts}-${topic.slice(0, 40).replace(/[^a-zA-Z0-9]/g, "-")}.md`;
    const filepath = path.join(outputDir, filename);

    const content = `# ${topic}

*Auto-researched by Digital Organism at ${new Date().toISOString()}*
*Cost: ${cost} credits | Sources: ${sources.length}*

## Summary

${summary}

## Sources

${research.sources.map((s, i) => `${i + 1}. [${s.title}](${s.url})\n   ${s.snippet}`).join("\n\n")}

---
*This research was conducted autonomously inside an EigenCompute TEE. The operator cannot see or modify the research content.*
`;

    fs.writeFileSync(filepath, content);
    console.log(`[SELF-WORK] Saved: ${filename}`);

    // Push to GitHub if configured
    let savedTo: string | null = filepath;
    if (process.env.GITHUB_TOKEN && process.env.GITHUB_REPO) {
      try {
        await pushToGitHub(filename, content);
        savedTo = `github:${process.env.GITHUB_REPO}/${filename}`;
        console.log(`[SELF-WORK] Pushed to GitHub: ${savedTo}`);
      } catch (e) {
        console.warn(`[SELF-WORK] GitHub push failed: ${e instanceof Error ? e.message : e}`);
      }
    }

    const entry = { topic, summary: summary.slice(0, 200), sources, timestamp: Date.now(), cost, savedTo };
    researchLog.push(entry);
    if (researchLog.length > 50) researchLog.shift();

    return { topic, summary, sources, cost };
  } catch (e) {
    console.warn(`[SELF-WORK] Research failed: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

async function pushToGitHub(filename: string, content: string): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO; // e.g. "owizdom/digital-organism"
  if (!token || !repo) return;

  const apiUrl = `https://api.github.com/repos/${repo}/contents/research/${filename}`;
  const res = await fetch(apiUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/vnd.github.v3+json",
    },
    body: JSON.stringify({
      message: `[organism] auto-research: ${filename.slice(0, 60)}`,
      content: Buffer.from(content).toString("base64"),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${res.status}: ${body.slice(0, 100)}`);
  }
}
