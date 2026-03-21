/**
 * Research Module — Web search for evidence gathering.
 * Uses Tavily API for real-time web search.
 */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface ResearchOutput {
  query: string;
  answer: string;
  sources: SearchResult[];
  provider: "tavily" | "none";
}

let searchEnabled = false;

export function initResearch(): void {
  if (process.env.TAVILY_API_KEY) {
    searchEnabled = true;
    console.log("[RESEARCH] Web search enabled via Tavily");
  } else {
    console.log("[RESEARCH] No TAVILY_API_KEY — organism will use LLM knowledge only");
  }
}

export function isSearchEnabled(): boolean {
  return searchEnabled;
}

export async function researchClaim(
  claim: string,
  role: "challenger" | "advocate" | "arbiter"
): Promise<ResearchOutput | null> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return null;

  const queryMap = {
    challenger: `evidence against OR problems with: ${claim}`,
    advocate: `evidence supporting OR arguments for: ${claim}`,
    arbiter: `balanced analysis: ${claim}`,
  };

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        query: queryMap[role],
        search_depth: "basic",
        max_results: 5,
        include_answer: true,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json() as {
      answer?: string;
      results?: Array<{ title: string; url: string; content: string }>;
    };
    return {
      query: queryMap[role],
      answer: data.answer || "",
      sources: (data.results || []).slice(0, 5).map(r => ({
        title: r.title, url: r.url, snippet: (r.content || "").slice(0, 200),
      })),
      provider: "tavily",
    };
  } catch { return null; }
}

export function formatResearchContext(research: ResearchOutput): string {
  let ctx = "";
  if (research.answer) ctx += `Web Research: ${research.answer}\n\n`;
  if (research.sources.length > 0) {
    ctx += "Sources:\n";
    research.sources.forEach((s, i) => {
      ctx += `[${i + 1}] ${s.title} — ${s.snippet}\n    ${s.url}\n`;
    });
  }
  return ctx;
}
