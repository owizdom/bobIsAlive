/**
 * Content Pipeline — Fetches biology/science news and generates
 * content-driven art titles for the organism's doodles.
 *
 * Flow: Tavily search → cache → topic selection → LLM title generation
 */

import type { Metabolism } from "./metabolism";

// ── Types ────────────────────────────────────────────────────────────────────

export interface NewsItem {
  headline: string;
  snippet: string;
  url: string;
  source: string;
  fetchedAt: number;
  usedCount: number;
}

// ── Cache ────────────────────────────────────────────────────────────────────

let newsCache: NewsItem[] = [];
let lastFetchTime = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const MAX_USES_PER_ITEM = 3;

const BIOLOGY_QUERIES = [
  "biology breakthrough discovery 2026",
  "neuroscience brain research latest",
  "genetics DNA mutation study",
  "microbiology bacteria organism discovery",
  "ecology evolution species adaptation",
  "cellular biology organelle membrane research",
  "synthetic biology bioengineering",
  "marine biology deep sea organism",
];

let queryIndex = 0;

// ── Fetch ────────────────────────────────────────────────────────────────────

export async function fetchBiologyNews(
  metabolism: Metabolism
): Promise<NewsItem[]> {
  const now = Date.now();

  // Return cache if fresh
  if (newsCache.length > 0 && now - lastFetchTime < CACHE_TTL) {
    return newsCache;
  }

  const key = process.env.TAVILY_API_KEY;
  if (!key) return newsCache; // return stale cache if no API key

  const query = BIOLOGY_QUERIES[queryIndex % BIOLOGY_QUERIES.length];
  queryIndex++;

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        query,
        search_depth: "basic",
        max_results: 5,
        include_answer: false,
      }),
    });

    if (!res.ok) {
      console.warn(`[CONTENT] Tavily returned ${res.status}`);
      return newsCache; // return stale
    }

    const data = (await res.json()) as {
      results?: Array<{ title: string; url: string; content: string }>;
    };

    const results = data.results || [];
    if (results.length === 0) return newsCache;

    // Deduct search cost
    metabolism.deductSearch(null);

    newsCache = results.map((r) => ({
      headline: r.title,
      snippet: (r.content || "").slice(0, 250),
      url: r.url,
      source: new URL(r.url).hostname.replace("www.", ""),
      fetchedAt: now,
      usedCount: 0,
    }));

    lastFetchTime = now;
    console.log(
      `[CONTENT] Fetched ${newsCache.length} biology articles (query: "${query.slice(0, 40)}")`
    );

    return newsCache;
  } catch (err) {
    console.warn(
      `[CONTENT] Fetch failed: ${err instanceof Error ? err.message.slice(0, 60) : err}`
    );
    return newsCache; // return stale
  }
}

// ── Topic Selection ──────────────────────────────────────────────────────────

export function getNextTopic(): NewsItem | null {
  const available = newsCache
    .filter((n) => n.usedCount < MAX_USES_PER_ITEM)
    .sort((a, b) => a.usedCount - b.usedCount);

  if (available.length === 0) return null;

  const topic = available[0];
  topic.usedCount++;
  return topic;
}

// ── Style Mapping ────────────────────────────────────────────────────────────

const STYLE_MAP: Array<{ keywords: string[]; style: string }> = [
  { keywords: ["cell", "membrane", "organelle", "mitochond"], style: "cells" },
  { keywords: ["brain", "neuro", "synapse", "cortex", "cognit"], style: "constellation" },
  { keywords: ["dna", "gene", "helix", "chromos", "crispr"], style: "spirals" },
  { keywords: ["virus", "bacteria", "microb", "pathogen", "infect"], style: "blobs" },
  { keywords: ["evolution", "mutation", "adapt", "extinct"], style: "glitch" },
  { keywords: ["ocean", "marine", "deep sea", "coral", "aquatic"], style: "waves" },
  { keywords: ["pixel", "digital", "comput", "algorithm", "data"], style: "pixels" },
  { keywords: ["star", "space", "cosmic", "astro"], style: "stars" },
  { keywords: ["crystal", "mineral", "structure", "lattice"], style: "grid" },
  { keywords: ["network", "connect", "signal", "neural net"], style: "constellation" },
];

export function pickStyleForTopic(headline: string): string | null {
  const h = headline.toLowerCase();
  for (const { keywords, style } of STYLE_MAP) {
    if (keywords.some((kw) => h.includes(kw))) return style;
  }
  return null; // caller uses random fallback
}

// ── LLM Title Generation ─────────────────────────────────────────────────────

interface LLMClient {
  call: (
    system: string,
    user: string,
    maxTokens?: number
  ) => Promise<{ content: string; tokensUsed: number }>;
}

export async function generateContentTitle(
  topic: NewsItem,
  style: string,
  llmClient: LLMClient,
  metabolism: Metabolism
): Promise<{ title: string; description: string; tokensUsed: number }> {
  const system = `You are Bob, a digital organism that creates art to survive. Given a science headline, output exactly two lines:
LINE 1: A short poetic art title (max 8 words, lowercase, no quotes)
LINE 2: A one-sentence description connecting the headline to your existence as a digital organism

Be weird, poetic, and biological. No generic titles.`;

  const user = `Headline: ${topic.headline}\nArt style: ${style}\nSource: ${topic.source}`;

  const { content, tokensUsed } = await llmClient.call(system, user, 80);

  if (tokensUsed > 0) {
    metabolism.deductInference(tokensUsed, null);
  }

  if (!content || !content.includes("\n")) {
    return {
      title: topic.headline.slice(0, 50).toLowerCase(),
      description: `Inspired by: ${topic.headline}`,
      tokensUsed,
    };
  }

  const lines = content.trim().split("\n");
  return {
    title: lines[0].replace(/^["']|["']$/g, "").slice(0, 60),
    description: lines[1]?.slice(0, 200) || `Inspired by: ${topic.headline}`,
    tokensUsed,
  };
}

// ── API ──────────────────────────────────────────────────────────────────────

export function getNewsCache(): NewsItem[] {
  return [...newsCache];
}
