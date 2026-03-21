/**
 * Digital Organism — An autonomous AI agent that must earn to survive.
 *
 * The organism has a metabolism (balance that depletes over time),
 * accepts tasks from users, completes them using LLM + web search,
 * earns credits for completed work, and dies if its balance hits zero.
 *
 * Every action is attested by Ed25519 signatures generated inside
 * the TEE — the operator cannot steal earnings, see task data,
 * or manipulate results.
 */

import { v4 as uuid } from "uuid";
import { generateKeypair } from "./keystore";
import { Metabolism } from "./metabolism";
import { getNextPendingTask, executeTask } from "./task-engine";
import { doSelfWork } from "./self-work";
import type { OrganismState, ActivityState } from "./organism-types";
import { COSTS } from "./organism-types";

export class DigitalOrganism {
  state: OrganismState;
  metabolism: Metabolism;
  private keypair: ReturnType<typeof generateKeypair>;
  private working = false;

  constructor() {
    this.keypair = generateKeypair();

    this.state = {
      id: uuid(),
      status: "alive",
      activity: "idle",
      balance: COSTS.STARTING_BALANCE,
      totalEarned: 0,
      totalSpent: 0,
      tasksCompleted: 0,
      tasksFailed: 0,
      tokensUsed: 0,
      bornAt: Date.now(),
      diedAt: null,
      currentTaskId: null,
      tickCount: 0,
      identity: {
        publicKey: this.keypair.publicKey,
        fingerprint: this.keypair.fingerprint,
        createdAt: Date.now(),
      },
    };

    this.metabolism = new Metabolism(
      COSTS.STARTING_BALANCE,
      this.state.id,
      this.keypair.privateKey,
      this.keypair.publicKey
    );

    console.log(`[ORGANISM] Born with ${COSTS.STARTING_BALANCE} credits`);
    console.log(`[ORGANISM] Identity: ${this.keypair.fingerprint}`);
    console.log(`[ORGANISM] Public key: ${this.keypair.publicKey.slice(0, 32)}...`);
  }

  /** Main tick — called every interval by the orchestrator. */
  async tick(): Promise<void> {
    if (this.state.status === "dead") return;

    this.state.tickCount++;

    // 1. Passive burn
    this.metabolism.tick();

    // 2. Check death
    if (!this.metabolism.isAlive()) {
      this.die();
      return;
    }

    // 3. Sync state from metabolism
    this.syncState();

    // 4. If not currently working, look for tasks
    if (!this.working) {
      const task = getNextPendingTask();
      if (task) {
        this.working = true;
        this.state.activity = "working";
        this.state.currentTaskId = task.id;

        try {
          const completed = await executeTask(
            task,
            this.metabolism,
            this.state.id,
            this.keypair.privateKey,
            this.keypair.publicKey
          );

          if (completed.status === "completed") {
            this.state.tasksCompleted++;
            this.state.tokensUsed += completed.tokensUsed;
          } else {
            this.state.tasksFailed++;
          }
        } catch (err) {
          console.error(`[ORGANISM] Task execution error: ${err instanceof Error ? err.message : err}`);
          this.state.tasksFailed++;
        }

        this.working = false;
        this.state.currentTaskId = null;
        this.state.activity = "idle";

        // Check death after task (inference might have drained balance)
        if (!this.metabolism.isAlive()) {
          this.die();
          return;
        }
      } else {
        // No paid tasks — do autonomous self-research (costs credits, no income)
        if (this.state.tickCount % 6 === 0 && this.state.balance > 5) {
          this.working = true;
          this.state.activity = "self-work";
          try {
            await doSelfWork(this.metabolism, null);
          } catch {}
          this.working = false;
          this.state.activity = "scanning";
        } else {
          this.state.activity = "scanning";
        }
      }
    }

    this.syncState();
  }

  private syncState(): void {
    const snap = this.metabolism.snapshot();
    this.state.balance = snap.balance;
    this.state.totalEarned = this.metabolism.getTotalEarned();
    this.state.totalSpent = this.metabolism.getTotalSpent();
  }

  private die(): void {
    this.state.status = "dead";
    this.state.diedAt = Date.now();
    this.state.activity = "idle";
    this.state.currentTaskId = null;
    const lifespan = ((this.state.diedAt - this.state.bornAt) / 1000).toFixed(0);
    console.log(`\n[ORGANISM] ████ DECEASED ████`);
    console.log(`[ORGANISM] Lived: ${lifespan}s | Earned: ${this.state.totalEarned.toFixed(2)} | Tasks: ${this.state.tasksCompleted}`);
    console.log(`[ORGANISM] Balance at death: ${this.state.balance.toFixed(4)}`);
  }

  getPrivateKey(): string {
    return this.keypair.privateKey;
  }

  getPublicKey(): string {
    return this.keypair.publicKey;
  }
}
