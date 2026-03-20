import { v4 as uuid } from "uuid";
import {
  Pheromone,
  PheromoneChannel,
  AutonomousAgentState,
  AgentPersonality,
  AgentThought,
  AgentDecision,
  MarketDataset,
  hash,
} from "./types";
import { generateKeypair, buildAttestation } from "./keystore";
import { fetchMarketData, getRandomMarket, MARKET_TICKERS, type MarketTicker, normalizeMarketTicker } from "./markets";
import { formThought, synthesizeKnowledge } from "./thinker";
import { generateCandidateDecisions, selectDecision, shouldSwitch } from "./decider";
import { executeDecision } from "./executor";
import { saveThought, saveDecision, updateDecisionStatus } from "./persistence";

/**
 * Swarm Oracle Agent
 *
 * Each agent autonomously fetches real crypto market data, forms market
 * predictions, shares signals via pheromones, and contributes to consensus
 * oracle answers.
 */

const NAMES = ["Nakamoto", "Szabo", "Finney"];

const PERSONALITY_PRESETS: Array<{ name: string; personality: AgentPersonality }> = [
  {
    name: "Technician",
    personality: { curiosity: 0.9, diligence: 0.7, boldness: 0.3, sociability: 0.5 },
  },
  {
    name: "Macro Analyst",
    personality: { curiosity: 0.6, diligence: 0.5, boldness: 0.4, sociability: 0.95 },
  },
  {
    name: "On-chain Analyst",
    personality: { curiosity: 0.5, diligence: 0.9, boldness: 0.7, sociability: 0.4 },
  },
];

function generatePersonality(index: number): { specialization: string; personality: AgentPersonality } {
  const preset = PERSONALITY_PRESETS[index % PERSONALITY_PRESETS.length];
  const perturb = () => (Math.random() - 0.5) * 0.08;
  return {
    specialization: preset.name,
    personality: {
      curiosity: Math.max(0, Math.min(1, preset.personality.curiosity + perturb())),
      diligence: Math.max(0, Math.min(1, preset.personality.diligence + perturb())),
      boldness: Math.max(0, Math.min(1, preset.personality.boldness + perturb())),
      sociability: Math.max(0, Math.min(1, preset.personality.sociability + perturb())),
    },
  };
}

export class SwarmAgent {
  state: AutonomousAgentState;
  private discoveredMarkets: MarketDataset[] = [];
  private engineeringEnabled: boolean = false;
  private keypair = generateKeypair();

  constructor(index: number) {
    const angle = (index / 8) * Math.PI * 2;
    const radius = 300 + Math.random() * 200;
    const { specialization, personality } = generatePersonality(index);
    const tokenBudget = parseInt(process.env.TOKEN_BUDGET_PER_AGENT || "50000");

    this.state = {
      id: uuid(),
      name: NAMES[index] || `Agent-${index}`,
      position: {
        x: 500 + Math.cos(angle) * radius,
        y: 400 + Math.sin(angle) * radius,
      },
      velocity: {
        dx: (Math.random() - 0.5) * 8,
        dy: (Math.random() - 0.5) * 8,
      },
      knowledge: [],
      absorbed: new Set(),
      explorationTarget: MARKET_TICKERS[index % MARKET_TICKERS.length],
      energy: 0.3 + Math.random() * 0.3,
      synchronized: false,
      syncedWith: [],
      stepCount: 0,
      discoveries: 0,
      contributionsToCollective: 0,

      thoughts: [],
      decisions: [],
      currentDecision: null,
      reposStudied: [],
      prsCreated: [],
      tokensUsed: 0,
      tokenBudget,
      specialization: specialization,
      personality,
      currentAction: "initializing",
      identity: {
        publicKey:   this.keypair.publicKey,
        fingerprint: this.keypair.fingerprint,
        createdAt:   Date.now(),
      },
    };
  }

  enableEngineering(): void {
    this.engineeringEnabled = true;
  }

  getPrivateKey(): string {
    return this.keypair.privateKey;
  }

  private shouldDoEngineering(): boolean {
    if (!this.engineeringEnabled) return false;
    if (this.state.tokensUsed >= this.state.tokenBudget) return false;
    const step = this.state.stepCount;
    const probability = Math.min(0.85, step / 40);
    return Math.random() < probability;
  }

  private trackTokens(tokensUsed: number): void {
    this.state.tokensUsed += tokensUsed;
  }

  private pickTicker(raw: string): MarketTicker | null {
    const direct = normalizeMarketTicker(raw);
    if (direct) return direct;

    const parts = raw
      .split(/,|\+|&| and /i)
      .map((part) => part.trim())
      .filter(Boolean);
    const mapped = parts.flatMap((part) => {
      const normalized = normalizeMarketTicker(part);
      return normalized ? [normalized] : [];
    });

    return mapped.length > 0 ? mapped[0] : null;
  }

  private formatSignalLine(market: MarketDataset): string {
    const pmSentiment = typeof market.polymarketSentiment === "number" ? market.polymarketSentiment : 0;
    const pmSignal = pmSentiment >= 0 ? "risk-on" : "risk-off";
    const polymarket = market.polymarketContext
      ? `Polymarket context: ${market.polymarketContext.slice(0, 70)}`
      : "No Polymarket signal";
    const pmSignals = market.polymarketEventInsights?.length
      ? ` | PM events: ${market.polymarketEventInsights.slice(0, 2).join(" || ")}`
      : "";

    return `PM ${pmSignal} (${pmSentiment.toFixed(2)}) | ${polymarket}${pmSignals}`;
  }

  async step(channel: PheromoneChannel): Promise<Pheromone | null> {
    this.state.stepCount++;
    this.move(channel);
    const absorbed = this.absorbPheromones(channel);

    let discovery: Pheromone | null = null;

    if (this.shouldDoEngineering()) {
      if (this.state.currentDecision?.status === "executing") {
        discovery = await this.continueExecution(absorbed);
      } else {
        discovery = await this.marketStep(channel, absorbed);
      }
    } else {
      discovery = await this.exploreMarket(absorbed);
    }

    this.checkSync(channel);
    return discovery;
  }

  /** Market step: think → decide → execute → emit pheromone */
  private async marketStep(
    channel: PheromoneChannel,
    absorbed: Pheromone[]
  ): Promise<Pheromone | null> {
    this.state.currentAction = "thinking";

    try {
      let thought: AgentThought | null = null;

      if (absorbed.length > 0 && this.state.personality.sociability > 0.4) {
        const { thought: synthThought, tokensUsed } = await synthesizeKnowledge(this.state, absorbed);
        thought = synthThought;
        this.trackTokens(tokensUsed);
      } else {
        const marketsAnalyzed = this.state.reposStudied.length;
        const { thought: ft, tokensUsed } = await formThought(
          this.state,
          marketsAnalyzed > 0 ? "market_review" : "exploration",
          `I have analyzed ${marketsAnalyzed} market signals. Currently focused on ${this.state.explorationTarget}.`,
          `Specialization: ${this.state.specialization}, energy: ${this.state.energy.toFixed(2)}`
        );
        thought = ft;
        this.trackTokens(tokensUsed);
      }

      if (thought) {
        this.state.thoughts.push(thought);
        try { saveThought(thought); } catch { /* DB not ready */ }
      }

      if (Math.random() < 0.3) {
        this.state.explorationTarget = getRandomMarket();
      }

      this.state.currentAction = "deciding";
      const candidates = generateCandidateDecisions(
        this.state,
        channel,
        this.discoveredMarkets,
        this.state.thoughts.slice(-10)
      );

      const decision = selectDecision(candidates, 0.3);
      if (!decision) {
        this.state.currentAction = "idle";
        return null;
      }

      this.state.currentDecision = decision;
      decision.status = "executing";
      try { saveDecision(decision); } catch { /* DB not ready */ }

      const result = await executeDecision(this.state, decision, this.discoveredMarkets);
      if (result.tokensUsed > 0) this.trackTokens(result.tokensUsed);

      decision.status = result.success ? "completed" : "failed";
      decision.result = result;
      decision.completedAt = Date.now();
      this.state.decisions.push(decision);
      this.state.currentDecision = null;

      try { updateDecisionStatus(decision.id, decision.status, result); } catch { /* DB not ready */ }

      if (result.summary) {
        console.log(`  [${this.state.name}] ${decision.action.type}: ${result.summary.slice(0, 90)}`);
      }

      if (result.success && result.artifacts.length > 0) {
        return this.createMarketPheromone(decision, result);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  [${this.state.name}] Market step error: ${message.slice(0, 100)}`);
      this.state.currentAction = "recovering";
    }

    return null;
  }

  private async continueExecution(absorbed: Pheromone[]): Promise<Pheromone | null> {
    const decision = this.state.currentDecision;
    if (!decision) return null;

    if (shouldSwitch(this.state, decision.result)) {
      decision.status = "completed";
      decision.completedAt = Date.now();
      this.state.decisions.push(decision);
      this.state.currentDecision = null;
      return null;
    }

    const result = await executeDecision(this.state, decision, this.discoveredMarkets);
    if (result.tokensUsed > 0) this.trackTokens(result.tokensUsed);
    decision.result = result;

    if (result.success || decision.status !== "executing") {
      decision.status = result.success ? "completed" : "failed";
      decision.completedAt = Date.now();
      this.state.decisions.push(decision);
      this.state.currentDecision = null;

      if (result.success && result.artifacts.length > 0) {
        return this.createMarketPheromone(decision, result);
      }
    }
    return null;
  }

  private createMarketPheromone(
    decision: AgentDecision,
    result: { summary: string; artifacts: Array<{ type: string; content: string }> }
  ): Pheromone {
    const rawTicker = "ticker" in decision.action
      ? (decision.action as { ticker?: string }).ticker
      : undefined;
    const rawTickers = "tickers" in decision.action
      ? (decision.action as { tickers?: string[] }).tickers?.join(" + ")
      : undefined;
    const tickers = rawTicker || rawTickers || this.state.explorationTarget;

    const ts = Date.now();
    const pheromone: Pheromone = {
      id: uuid(),
      agentId: this.state.id,
      content: result.summary,
      domain: tickers.replace(/_/g, " "),
      confidence: decision.priority,
      strength: 0.65 + decision.priority * 0.3,
      connections: [],
      timestamp: ts,
      attestation: buildAttestation(result.summary, this.state.id, ts, this.keypair.privateKey, this.keypair.publicKey),
      agentPubkey: this.keypair.publicKey,
    };

    this.state.knowledge.push(pheromone);
    this.state.discoveries++;
    return pheromone;
  }

  /** Light exploration: fetch a market snapshot and emit a pheromone summary */
  private async exploreMarket(absorbed: Pheromone[]): Promise<Pheromone | null> {
    this.state.currentAction = "scanning polymarket signal candidate";

    const discoveryChance = this.state.synchronized ? 0.75 : 0.45;
    if (Math.random() > discoveryChance) return null;

    let ticker = this.state.explorationTarget;
    let connections: string[] = [];
    let confidence = 0.45 + Math.random() * 0.3;

    if (absorbed.length > 0 && Math.random() < 0.55) {
      const source = absorbed[Math.floor(Math.random() * absorbed.length)];
      connections = [source.id];
      confidence = Math.min(1.0, source.confidence + 0.1);
      const candidate = source.domain.replace(/\s+/g, "_");
      const normalizedCandidate = this.pickTicker(candidate);
      if (source.strength > 0.6 && normalizedCandidate) this.state.explorationTarget = normalizedCandidate;
      if (source.strength > 0.6 && normalizedCandidate) {
        ticker = normalizedCandidate;
      } else {
        ticker = this.pickTicker(this.state.explorationTarget) || this.state.explorationTarget;
      }
    }

    try {
      const market = await fetchMarketData(ticker);
      if (!market) return null;
      if (!market.polymarketQuestionFound) return null;

      if (!this.discoveredMarkets.some((m) => m.ticker === market.ticker)) {
        this.discoveredMarkets.push(market);
      }

      const content = `Market signal: ${market.predictionQuestion}. ${this.formatSignalLine(market)}`;

      console.log(`    ${this.state.name} scanned a market: ${content.slice(0, 70)}`);

      const ts = Date.now();
      const pheromone: Pheromone = {
        id: uuid(),
        agentId: this.state.id,
        content,
        domain: market.ticker,
        confidence,
        strength: 0.5 + confidence * 0.3,
        connections,
        timestamp: ts,
        attestation: buildAttestation(content, this.state.id, ts, this.keypair.privateKey, this.keypair.publicKey),
        agentPubkey: this.keypair.publicKey,
      };

      this.state.knowledge.push(pheromone);
      this.state.discoveries++;
      return pheromone;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [${this.state.name}] Explore error: ${msg.slice(0, 80)}`);
      return null;
    }
  }

  private move(channel: PheromoneChannel): void {
    if (this.state.synchronized) {
      const cx = 500, cy = 400;
      this.state.velocity.dx += (cx - this.state.position.x) * 0.05;
      this.state.velocity.dy += (cy - this.state.position.y) * 0.05;
      this.state.velocity.dx += (this.state.position.y - cy) * 0.01;
      this.state.velocity.dy += -(this.state.position.x - cx) * 0.01;
    } else {
      this.state.velocity.dx += (Math.random() - 0.5) * 4;
      this.state.velocity.dy += (Math.random() - 0.5) * 4;
      for (const p of channel.pheromones) {
        if (p.agentId === this.state.id || this.state.absorbed.has(p.id)) continue;
        if (p.strength > 0.5) {
          this.state.velocity.dx += (Math.random() - 0.5) * p.strength * 3;
          this.state.velocity.dy += (Math.random() - 0.5) * p.strength * 3;
        }
      }
    }

    this.state.velocity.dx *= 0.85;
    this.state.velocity.dy *= 0.85;
    this.state.position.x = Math.max(50, Math.min(950, this.state.position.x + this.state.velocity.dx));
    this.state.position.y = Math.max(50, Math.min(750, this.state.position.y + this.state.velocity.dy));
  }

  private absorbPheromones(channel: PheromoneChannel): Pheromone[] {
    const absorbed: Pheromone[] = [];
    for (const p of channel.pheromones) {
      if (p.agentId === this.state.id || this.state.absorbed.has(p.id)) continue;
      if (p.strength > 0.2 && Math.random() < p.strength * 0.6) {
        this.state.absorbed.add(p.id);
        absorbed.push(p);
        this.state.energy = Math.min(1.0, this.state.energy + 0.05);
        p.strength = Math.min(1.0, p.strength + 0.1);
      }
    }
    return absorbed;
  }

  private checkSync(channel: PheromoneChannel): void {
    if (this.state.synchronized) return;
    if (
      channel.density >= channel.criticalThreshold &&
      this.state.absorbed.size >= 3 &&
      this.state.energy > 0.5
    ) {
      this.state.synchronized = true;
      this.state.energy = 1.0;
      console.log(`  [${this.state.name}] SYNCHRONIZED (absorbed ${this.state.absorbed.size} signals)`);
    }
  }
}
