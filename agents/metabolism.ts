/**
 * Metabolism Engine — Economic tracking for the Digital Organism.
 *
 * Tracks balance, costs, earnings, burn rate, and time-to-death.
 * Every economic event is logged with attestation.
 */

import { v4 as uuid } from "uuid";
import type { EarningsEntry, MetabolismSnapshot } from "./organism-types";
import { COSTS } from "./organism-types";
import { buildAttestation } from "./keystore";

export class Metabolism {
  private balance: number;
  private totalEarned = 0;
  private totalSpent = 0;
  private log: EarningsEntry[] = [];
  private bornAt: number;
  private tickCount = 0;
  private recentEarnings: number[] = []; // last 20 earning timestamps+amounts for rate calc
  private privateKey: string;
  private publicKey: string;
  private agentId: string;

  constructor(startingBalance: number, agentId: string, privateKey: string, publicKey: string) {
    this.balance = startingBalance;
    this.bornAt = Date.now();
    this.agentId = agentId;
    this.privateKey = privateKey;
    this.publicKey = publicKey;
  }

  isAlive(): boolean {
    return this.balance > 0;
  }

  getBalance(): number {
    return this.balance;
  }

  getTotalEarned(): number {
    return this.totalEarned;
  }

  getTotalSpent(): number {
    return this.totalSpent;
  }

  getLog(): EarningsEntry[] {
    return this.log;
  }

  getTickCount(): number {
    return this.tickCount;
  }

  /** Apply passive compute burn. Called every tick. */
  tick(): EarningsEntry | null {
    if (!this.isAlive()) return null;
    this.tickCount++;
    return this.deduct(COSTS.PASSIVE_BURN_PER_TICK, "burn", "Passive compute burn", null);
  }

  /** Deduct cost for an LLM inference call. */
  deductInference(tokensUsed: number, taskId: string | null): EarningsEntry {
    const cost = tokensUsed * COSTS.INFERENCE_PER_TOKEN;
    return this.deduct(cost, "inference", `LLM inference: ${tokensUsed} tokens`, taskId);
  }

  /** Deduct cost for a web search. */
  deductSearch(taskId: string | null): EarningsEntry {
    return this.deduct(COSTS.WEB_SEARCH, "search", "Tavily web search", taskId);
  }

  /** Add earnings from a completed task. */
  earn(amount: number, description: string, taskId: string): EarningsEntry {
    const ts = Date.now();
    this.balance += amount;
    this.totalEarned += amount;
    this.recentEarnings.push(amount);
    if (this.recentEarnings.length > 20) this.recentEarnings.shift();

    const entry: EarningsEntry = {
      id: uuid(),
      type: "earn",
      amount,
      balance: this.balance,
      description,
      taskId,
      attestation: buildAttestation(
        `earn:${amount}:${taskId}:${this.balance.toFixed(4)}`,
        this.agentId, ts, this.privateKey, this.publicKey
      ),
      timestamp: ts,
    };
    this.log.push(entry);
    if (this.log.length > 500) this.log.shift();
    return entry;
  }

  private deduct(amount: number, type: "burn" | "inference" | "search", description: string, taskId: string | null): EarningsEntry {
    const ts = Date.now();
    this.balance = Math.max(0, this.balance - amount);
    this.totalSpent += amount;

    const entry: EarningsEntry = {
      id: uuid(),
      type,
      amount: -amount,
      balance: this.balance,
      description,
      taskId,
      attestation: null, // costs don't need individual attestation (aggregated in proof)
      timestamp: ts,
    };
    this.log.push(entry);
    if (this.log.length > 500) this.log.shift();
    return entry;
  }

  /** Get a snapshot of the organism's metabolic state. */
  snapshot(): MetabolismSnapshot {
    const now = Date.now();
    const uptimeMs = now - this.bornAt;
    const uptimeSec = uptimeMs / 1000;

    // Burn rate: passive burn per second (tick interval is ~5s)
    const tickIntervalSec = 5;
    const burnRate = COSTS.PASSIVE_BURN_PER_TICK / tickIntervalSec;

    // Earn rate: average over recent history
    const recentSum = this.recentEarnings.reduce((s, e) => s + e, 0);
    const earnWindow = Math.max(60, uptimeSec); // at least 60s window
    const earnRate = this.totalEarned > 0 ? this.totalEarned / uptimeSec : 0;

    const netRate = earnRate - burnRate - (this.totalSpent > 0 ? (this.totalSpent - this.totalEarned) / uptimeSec : 0);

    // Time to death
    let ttd = -1;
    if (netRate < 0 && this.balance > 0) {
      ttd = this.balance / Math.abs(netRate);
    } else if (this.balance <= 0) {
      ttd = 0;
    }

    const efficiency = this.totalSpent > 0 ? this.totalEarned / this.totalSpent : 0;

    return {
      balance: this.balance,
      burnRate,
      earnRate: earnRate > 0 ? earnRate : 0,
      netRate,
      ttd,
      efficiency,
      alive: this.isAlive(),
      uptime: uptimeSec,
      tickCount: this.tickCount,
    };
  }
}
