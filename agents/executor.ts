import type {
  AgentDecision,
  DecisionResult,
  Artifact,
  AutonomousAgentState,
  MarketDataset,
} from "./types";
import { fetchMarketData, normalizeMarketTicker, type MarketTicker } from "./markets";
import { formThought, analyzeMarket, synthesizeKnowledge } from "./thinker";

export async function executeDecision(
  agentState: AutonomousAgentState,
  decision: AgentDecision,
  discoveredMarkets: MarketDataset[]
): Promise<DecisionResult> {
  const action = decision.action;

  try {
    switch (action.type) {
      case "analyze_market":
        return await handleAnalyzeMarket(agentState, action.ticker, discoveredMarkets);
      case "share_prediction":
        return await handleSharePrediction(agentState, action.prediction, action.ticker);
      case "correlate_markets":
        return await handleCorrelateMarkets(agentState, action.tickers, discoveredMarkets);
      case "scan_sector":
        return await handleScanSector(agentState, action.ticker, discoveredMarkets);
      default:
        return { success: false, summary: "Unknown action type", artifacts: [], tokensUsed: 0 };
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      summary: `Execution error: ${message.slice(0, 200)}`,
      artifacts: [],
      tokensUsed: 0,
    };
  }
}

// ── Market Action Handlers ──

async function handleAnalyzeMarket(
  agentState: AutonomousAgentState,
  ticker: string,
  discoveredMarkets: MarketDataset[]
): Promise<DecisionResult> {
  agentState.currentAction = "fetching market data";

  const safeTicker = normalizeMarketTicker(ticker);
  if (!safeTicker) return { success: false, summary: "Invalid market target", artifacts: [], tokensUsed: 0 };

  let dataset: MarketDataset | null = discoveredMarkets.find((m) => m.ticker === safeTicker) ?? null;
  if (!dataset) {
    dataset = await fetchMarketData(safeTicker);
    if (!dataset) {
      return { success: false, summary: "Could not fetch market data", artifacts: [], tokensUsed: 0 };
    }
    discoveredMarkets.push(dataset);
  }
  agentState.currentAction = "analyzing market";
  const { thought, prediction, tokensUsed } = await analyzeMarket(agentState, dataset);

  agentState.thoughts.push(thought);
  agentState.tokensUsed += tokensUsed;
  agentState.currentPrediction = prediction;

  const datasetKey = `${dataset.ticker}:${dataset.questionExpiresAt}`;
  if (!agentState.reposStudied.includes(datasetKey)) {
    agentState.reposStudied.push(datasetKey);
  }

  const content = [
    `## Polymarket question`,
    `Question: ${dataset.predictionQuestion}`,
    `Prediction: ${prediction.direction.toUpperCase()} at ${Math.round(prediction.confidence * 100)}%`,
    `Polymarket signal: ${typeof dataset.polymarketSentiment === "number" ? dataset.polymarketSentiment.toFixed(2) : "N/A"} | ${dataset.polymarketContext || "no active market signal found"}`,
    `Signals: ${(dataset.polymarketEventInsights ?? []).slice(0, 3).join(" | ") || "no event signal"}`,
    `Research context: ${(dataset.polymarketResearch ?? []).slice(0, 2).join(" | ") || "no public research pulled yet"}`,
    "",
    `Conclusion: ${thought.conclusion}`,
    `Reasoning: ${thought.reasoning}`,
  ].join("\n");

  const artifact: Artifact = { type: "analysis", content };

  return {
    success: true,
    summary: `Market analysis captured: ${thought.conclusion.slice(0, 120)}`,
    artifacts: [artifact],
    tokensUsed,
  };
}

async function handleSharePrediction(
  agentState: AutonomousAgentState,
  prediction: string,
  ticker?: string
): Promise<DecisionResult> {
  agentState.currentAction = "sharing market prediction";

  const recentThoughts = agentState.thoughts.slice(-5);
  const context = recentThoughts.map((t) => `${t.trigger}: ${t.conclusion}`).join("\n");
  const focus = ticker ? "active market" : "active market";

  const { thought, tokensUsed } = await formThought(
    agentState,
    "share_prediction",
    `Sharing prediction: ${prediction}`,
    `Recent signals:\n${context}\nFocus: ${focus}`
  );

  agentState.thoughts.push(thought);
  agentState.tokensUsed += tokensUsed;

  const artifact: Artifact = {
    type: "finding",
    content: `## Market Prediction Shared\n\n${thought.reasoning}\n\n**Conclusion:** ${thought.conclusion}`,
  };

  return {
    success: true,
    summary: `Prediction shared: ${thought.conclusion.slice(0, 100)}`,
    artifacts: [artifact],
    tokensUsed,
  };
}

async function handleCorrelateMarkets(
  agentState: AutonomousAgentState,
  tickers: string[],
  discoveredMarkets: MarketDataset[]
): Promise<DecisionResult> {
  agentState.currentAction = "correlating market signals";

  const markets: MarketDataset[] = [];

  const normalizeCandidates = (raw: string): MarketTicker[] => {
    const parts = raw
      .split(/,|\+|&| and /i)
      .map((part) => part.trim())
      .filter(Boolean);
    const mapped = parts.flatMap((part) => {
      const safe = normalizeMarketTicker(part);
      return safe ? [safe] : [];
    });
    return Array.from(new Set(mapped));
  };

  for (const ticker of tickers) {
    const safeTickers = normalizeCandidates(ticker);
    if (safeTickers.length === 0) continue;

    for (const safeTicker of safeTickers) {
      if (markets.length >= 2) break;

      let ds = discoveredMarkets.find((m) => m.ticker === safeTicker) ?? null;
      if (!ds) {
        ds = await fetchMarketData(safeTicker);
        if (ds) discoveredMarkets.push(ds);
      }
      if (ds?.polymarketQuestionFound) markets.push(ds);
    }

    if (markets.length >= 2) break;
  }

  if (markets.length < 2) {
    if (markets.length === 1) return handleAnalyzeMarket(agentState, markets[0].ticker, discoveredMarkets);
    return { success: false, summary: "Could not fetch markets for correlation", artifacts: [], tokensUsed: 0 };
  }

  const [m1, m2] = markets;
  const combinedObs = [
    `Market A: PM=${typeof m1.polymarketSentiment === "number" ? m1.polymarketSentiment.toFixed(2) : "N/A"} | ${m1.polymarketContext || "no PM context"}`,
    `Market B: PM=${typeof m2.polymarketSentiment === "number" ? m2.polymarketSentiment.toFixed(2) : "N/A"} | ${m2.polymarketContext || "no PM context"}`,
  ].join("\n");

  const { thought, tokensUsed } = await formThought(
    agentState,
    "market_correlation",
    combinedObs,
    `Cross-market correlation between ${m1.name} and ${m2.name}. Look for divergence/convergence in momentum and structure.`
  );

  agentState.thoughts.push(thought);
  agentState.tokensUsed += tokensUsed;

  const artifact: Artifact = {
    type: "correlation",
    content: [
      `## Market Correlation`,
      "",
      `**Market A:** PM=${typeof m1.polymarketSentiment === "number" ? m1.polymarketSentiment.toFixed(2) : "N/A"} | ${m1.polymarketContext || "none"}`,
      `**Market B:** PM=${typeof m2.polymarketSentiment === "number" ? m2.polymarketSentiment.toFixed(2) : "N/A"} | ${m2.polymarketContext || "none"}`,
      `**Signals:**`,
      ...(m1.polymarketEventInsights || []).slice(0, 2).map((insight) => `- ${insight}`),
      ...(m2.polymarketEventInsights || []).slice(0, 2).map((insight) => `- ${insight}`),
      "",
      `**Analysis:** ${thought.reasoning}`,
      `**Cross-Market Signal:** ${thought.conclusion}`,
    ].join("\n"),
  };

  return {
    success: true,
    summary: `Correlation: ${thought.conclusion.slice(0, 100)}`,
    artifacts: [artifact],
    tokensUsed,
  };
}

async function handleScanSector(
  agentState: AutonomousAgentState,
  ticker: string,
  discoveredMarkets: MarketDataset[]
): Promise<DecisionResult> {
  return handleAnalyzeMarket(agentState, ticker, discoveredMarkets);
}
