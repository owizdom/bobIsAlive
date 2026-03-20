import { v4 as uuid } from "uuid";
import type {
  AgentDecision,
  AgentAction,
  AgentThought,
  DecisionCost,
  AutonomousAgentState,
  PheromoneChannel,
  MarketDataset,
  CollaborativeProject,
  Pheromone,
} from "./types";
import { MarketTicker, normalizeMarketTicker } from "./markets";

const ACTION_PRIORITIES: Record<AgentAction["type"], number> = {
  analyze_market:    0.95,
  share_prediction:  0.85,
  correlate_markets: 0.75,
  scan_sector:       0.60,
};

const TOKEN_ESTIMATES: Record<AgentAction["type"], number> = {
  analyze_market:    900,   // analyzeMarket(): 550 max output + ~350 prompt
  share_prediction:  450,   // formThought(): 380 max output + ~70 prompt
  correlate_markets: 650,   // formThought(): 380 max output + ~270 two-market prompt
  scan_sector:       900,   // same path as analyze_market
};

const TIME_ESTIMATES: Record<AgentAction["type"], number> = {
  analyze_market:    12000,
  share_prediction:  6000,
  correlate_markets: 18000,
  scan_sector:       10000,
};

export function estimateCost(action: AgentAction): DecisionCost {
  return {
    estimatedTokens: TOKEN_ESTIMATES[action.type] || 2000,
    estimatedTimeMs: TIME_ESTIMATES[action.type] || 10000,
    riskLevel: "low",
  };
}

export function generateCandidateDecisions(
  state: AutonomousAgentState,
  channel: PheromoneChannel,
  datasets: MarketDataset[],
  thoughts: AgentThought[]
): AgentDecision[] {
  const candidates: AgentDecision[] = [];
  const budgetRemaining = state.tokenBudget - state.tokensUsed;
  const activeDatasets = datasets.filter((dataset) => dataset.polymarketQuestionFound);

  // From thoughts — parse suggested actions
  for (const thought of thoughts.slice(-5)) {
    for (const suggestion of thought.suggestedActions) {
      const action = parseSuggestedAction(suggestion, state);
      if (!action) continue;
      const cost = estimateCost(action);
      if (cost.estimatedTokens > budgetRemaining) continue;
      candidates.push(makeDecision(state.id, action, cost));
    }
  }

  const analyzedTickers = new Set(state.reposStudied.map((d) => d.split(":")[0]));
  for (const market of activeDatasets) {
    const ticker = market.ticker;
    if (analyzedTickers.has(ticker)) continue;
    const action: AgentAction = { type: "analyze_market", ticker };
    const cost = estimateCost(action);
    if (cost.estimatedTokens > budgetRemaining) continue;
    candidates.push(makeDecision(state.id, action, cost));
  }

  if (activeDatasets.length > 0 && Math.random() < 0.3) {
    const pick = activeDatasets[Math.floor(Math.random() * activeDatasets.length)];
    if (!pick) {
      // No live Polymarket-backed market ready yet.
    } else {
      const action: AgentAction = { type: "analyze_market", ticker: pick.ticker };
      const cost = estimateCost(action);
      if (cost.estimatedTokens <= budgetRemaining) candidates.push(makeDecision(state.id, action, cost));
    }
  }

  if (state.thoughts.length > 0 && state.personality.sociability > 0.4 && channel.pheromones.length > 2) {
    const bestThought = [...state.thoughts].sort((a, b) => b.confidence - a.confidence)[0];
    const action: AgentAction = {
      type: "share_prediction",
      prediction: bestThought.conclusion.slice(0, 80),
      ticker: bestThought.trigger.split(":")[1] ?? state.explorationTarget,
    };
    const cost = estimateCost(action);
    if (cost.estimatedTokens <= budgetRemaining) {
      candidates.push(makeDecision(state.id, action, cost));
    }
  }

  if (activeDatasets.length >= 2 && state.personality.curiosity > 0.5) {
    const shuffled = [...activeDatasets].sort(() => Math.random() - 0.5);
    const action: AgentAction = {
      type: "correlate_markets",
      tickers: [shuffled[0].ticker, shuffled[1].ticker],
    };
    const cost = estimateCost(action);
    if (cost.estimatedTokens <= budgetRemaining) {
      candidates.push(makeDecision(state.id, action, cost));
    }
  }

  for (const c of candidates) {
    c.priority = scoreDecision(c, state, channel);
  }

  return candidates.sort((a, b) => b.priority - a.priority);
}

function makeDecision(agentId: string, action: AgentAction, cost: DecisionCost): AgentDecision {
  return {
    id: uuid(),
    agentId,
    action,
    priority: 0,
    cost,
    status: "pending",
    result: null,
    createdAt: Date.now(),
    completedAt: null,
  };
}

export function scoreDecision(
  decision: AgentDecision,
  state: AutonomousAgentState,
  channel: PheromoneChannel
): number {
  const action = decision.action;
  const p = state.personality;

  const base = (ACTION_PRIORITIES[action.type] || 0.5) * 0.25;

  const budgetRemaining = state.tokenBudget - state.tokensUsed;
  const costRatio = decision.cost.estimatedTokens / Math.max(1, budgetRemaining);
  const efficiency = Math.max(0, 1 - costRatio) * 0.25;

  const recentTypes = new Set(state.decisions.slice(-8).map((d) => d.action.type));
  const novelty = recentTypes.has(action.type) ? 0 : 0.15;

  let personalFit = 0;
  if (action.type === "analyze_market" || action.type === "scan_sector") personalFit = p.curiosity * 0.15;
  if (action.type === "share_prediction") personalFit = p.sociability * 0.15;
  if (action.type === "correlate_markets") personalFit = ((p.curiosity + p.diligence) / 2) * 0.15;

  const swarmBonus = channel.phaseTransitionOccurred && action.type === "correlate_markets" ? 0.10 : 0;
  return base + efficiency + novelty + personalFit + swarmBonus;
}

export function selectDecision(candidates: AgentDecision[], temperature = 0.3): AgentDecision | null {
  if (candidates.length === 0) return null;
  if (temperature === 0) return candidates[0];

  const maxP = Math.max(...candidates.map((c) => c.priority));
  const weights = candidates.map((c) => Math.exp((c.priority - maxP) / temperature));
  const total = weights.reduce((s, w) => s + w, 0);

  let roll = Math.random() * total;
  for (let i = 0; i < candidates.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return candidates[i];
  }
  return candidates[0];
}

export function shouldSwitch(state: AutonomousAgentState, lastResult: { success: boolean } | null): boolean {
  if (lastResult?.success) return Math.random() < 0.25;
  if (lastResult && !lastResult.success) return Math.random() < 0.7;
  if (!state.currentDecision) return true;
  if (state.tokensUsed >= state.tokenBudget) return true;
  return false;
}

export function detectCollaborativeOpportunity(
  agents: AutonomousAgentState[],
  channel: PheromoneChannel,
  _pheromones: Pheromone[]
): CollaborativeProject | null {
  const syncedAgents = agents.filter((a) => a.synchronized);
  if (syncedAgents.length < 2) return null;

  const marketAgents = new Map<string, string[]>();
  for (const agent of agents) {
    if (!agent.currentDecision) continue;
    const action = agent.currentDecision.action;
    if ("ticker" in action && typeof action.ticker === "string") {
      const existing = marketAgents.get(action.ticker) || [];
      existing.push(agent.id);
      marketAgents.set(action.ticker, existing);
    }
  }

  for (const [ticker, agentIds] of marketAgents) {
    if (agentIds.length >= 2) {
      return {
        id: uuid(),
        title: `Joint analysis: ${ticker}`,
        description: `${agentIds.length} agents are independently analyzing ${ticker} — cross-comparison could improve forecast quality.`,
        participants: agentIds,
        repos: [ticker],
        status: "proposed",
        createdAt: Date.now(),
      };
    }
  }

  const specializations = new Set(syncedAgents.map((a) => a.specialization));
  if (specializations.size >= 2) {
    return {
      id: uuid(),
      title: `Cross-market correlation: ${[...specializations].slice(0, 2).join(" × ")}`,
      description: `${syncedAgents.length} synced agents with complementary market lenses should compare signals.`,
      participants: syncedAgents.map((a) => a.id),
      repos: [],
      status: "proposed",
      createdAt: Date.now(),
    };
  }

  return null;
}

function parseSuggestedAction(suggestion: unknown, state: AutonomousAgentState): AgentAction | null {
  if (typeof suggestion !== "string") return null;
  const suggestion_str = suggestion.trim();
  const lower = suggestion_str.toLowerCase();

  const parseTickerList = (raw: string, maxCount = 2): MarketTicker[] => {
    if (!raw) return [];
    const tokens = raw
      .split(/,|\+|&| and /i)
      .map((token) => token.trim())
      .map((token) => normalizeMarketTicker(token))
      .filter((t): t is MarketTicker => !!t);
    if (tokens.length > 0) return tokens.slice(0, maxCount);
    return [];
  };

  if (lower.startsWith("analyze_market") || lower.includes("analyze")) {
    const colonIdx = suggestion_str.indexOf(":");
    const rawTicker = colonIdx >= 0
      ? suggestion_str.slice(colonIdx + 1)
      : state.explorationTarget;
    const parsed = parseTickerList(rawTicker, 1)[0];
    if (!parsed) return null;
    return { type: "analyze_market", ticker: parsed };
  }

  if (lower.startsWith("share_prediction") || lower.includes("share")) {
    const colonIdx = suggestion_str.indexOf(":");
    const prediction = colonIdx >= 0 ? suggestion_str.slice(colonIdx + 1).trim() : state.currentPrediction?.question || state.explorationTarget;
    return { type: "share_prediction", prediction };
  }

  if (lower.startsWith("correlate") || lower.includes("correlate")) {
    const colonIdx = suggestion_str.indexOf(":");
    if (colonIdx >= 0) {
      const tickers = parseTickerList(suggestion_str.slice(colonIdx + 1), 2);
      if (tickers.length >= 2) return { type: "correlate_markets", tickers };
      return null;
    }
    return null;
  }

  if (lower.startsWith("scan_sector") || lower.includes("scan") || lower.includes("explore")) {
    const colonIdx = suggestion_str.indexOf(":");
    const rawTicker = colonIdx >= 0
      ? suggestion_str.slice(colonIdx + 1)
      : state.explorationTarget;
    const parsed = parseTickerList(rawTicker, 1)[0];
    if (!parsed) return null;
    return { type: "scan_sector", ticker: parsed };
  }

  return null;
}
