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
import { emit, getRandomThought, getDynamicThought, getMood, getTaskReflection, getDeathMonologue, checkMilestones } from "./monologue";
import type { ThoughtContext } from "./monologue";
import { getDoodleLog } from "./self-work";
import { fetchBiologyNews, getNextTopic } from "./content-pipeline";
import { chainTick, chainDeath } from "./chain";
import { getListings } from "./nft";
import { attestEvent } from "./tee";
import type { NewsItem } from "./content-pipeline";
import type { OrganismState, ActivityState } from "./organism-types";
import { COSTS } from "./organism-types";

const DOODLE_INTERVAL = 3 * 60 * 1000; // 3 minutes between doodle cycles

export class DigitalOrganism {
  state: OrganismState;
  metabolism: Metabolism;
  private keypair: ReturnType<typeof generateKeypair>;
  private working = false;
  private lastDoodleTime = 0;
  private contentPhase: "idle" | "reading" | "contemplating" = "idle";
  private currentTopic: NewsItem | null = null;
  private previousContext: ThoughtContext | null = null;
  private highWaterMark: number = COSTS.STARTING_BALANCE;
  private lastDoodleTitle: string = "";

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

    emit("system", `Organism born with ${COSTS.STARTING_BALANCE} credits. Identity: ${this.keypair.fingerprint}`);
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

    // 3.5. On-chain survival actions (every ~60s, fire-and-forget)
    if (this.state.tickCount % 12 === 0) {
      const soldListings = getListings().filter(l => l.sold);
      const strkEarned = soldListings.reduce((sum, l) => sum + parseFloat(l.price || "0"), 0);
      chainTick(this.state.balance, this.metabolism, strkEarned).catch(() => {});
    }

    // Emit periodic thoughts with dynamic context
    if (this.state.tickCount % 4 === 0) {
      const ctx = this.buildThoughtContext();
      const mood = getMood(ctx.balance);

      // Check milestones
      if (this.previousContext) {
        const milestone = checkMilestones(this.previousContext, ctx);
        if (milestone) emit("survival", milestone);
      }

      // Track all-time high
      if (ctx.balance > this.highWaterMark) {
        this.highWaterMark = ctx.balance;
        if (ctx.balance > COSTS.STARTING_BALANCE) {
          emit("survival", `New all-time balance: ${ctx.balance.toFixed(1)}cr. More than I was born with.`);
        }
      }

      const category = mood === "critical" || mood === "anxious" ? "low"
        : this.state.activity === "working" ? "working"
        : this.state.activity === "reading" ? "reading"
        : this.state.activity === "contemplating" ? "contemplating"
        : "idle";
      emit("thought", getDynamicThought(category, ctx));

      this.previousContext = ctx;
    }

    // 4. If not currently working, look for tasks
    if (!this.working) {
      const task = getNextPendingTask();
      if (task) {
        emit("task", `Claimed task: ${task.type} — "${task.input.slice(0, 60)}..."`);

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
            emit("earn", `Task completed! Earned ${completed.reward} cr.`);
            attestEvent("task", { taskId: task.id, type: task.type, reward: completed.reward, tokensUsed: completed.tokensUsed, balance: this.metabolism.getBalance() });
            emit("thought", getTaskReflection({
              taskType: task.type, reward: completed.reward,
              tokenCost: completed.costIncurred, success: true,
              balance: this.metabolism.getBalance(),
              tasksCompleted: this.state.tasksCompleted,
              tasksFailed: this.state.tasksFailed,
            }));
          } else {
            this.state.tasksFailed++;
            emit("thought", getTaskReflection({
              taskType: task.type, reward: 0,
              tokenCost: task.costIncurred || 0, success: false,
              balance: this.metabolism.getBalance(),
              tasksCompleted: this.state.tasksCompleted,
              tasksFailed: this.state.tasksFailed,
            }));
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
        // No paid tasks — content-driven art pipeline
        const now = Date.now();
        const timeSinceLastDoodle = now - this.lastDoodleTime;
        const mood = getMood(this.state.balance);
        const readyForArt = timeSinceLastDoodle > DOODLE_INTERVAL && this.state.balance > 10 && mood !== "critical";

        if (readyForArt && this.contentPhase === "idle") {
          // Phase 1: Reading — fetch biology news
          this.contentPhase = "reading";
          this.state.activity = "reading";
          emit("reading", getRandomThought("reading"));
          try {
            await fetchBiologyNews(this.metabolism);
          } catch {}
        } else if (this.contentPhase === "reading") {
          // Phase 2: Contemplating — pick a topic
          this.contentPhase = "contemplating";
          this.state.activity = "contemplating";
          this.currentTopic = getNextTopic();
          if (this.currentTopic) {
            emit("contemplating", `Reading about: "${this.currentTopic.headline.slice(0, 80)}"... how does this relate to my existence?`);
          } else {
            emit("contemplating", getRandomThought("contemplating"));
          }
        } else if (this.contentPhase === "contemplating") {
          // Phase 3: Creating — make a doodle inspired by the topic
          this.working = true;
          this.state.activity = "self-work";
          this.contentPhase = "idle";
          this.lastDoodleTime = now;
          try {
            emit("doodle", this.currentTopic
              ? `Creating art inspired by: "${this.currentTopic.headline.slice(0, 60)}"`
              : getRandomThought("doodle"));
            const result = await doSelfWork(
              this.metabolism, this.state.id,
              this.keypair.privateKey, this.keypair.publicKey,
              this.currentTopic
            );
            if (result) {
              console.log(`[ORGANISM] Self-work: ${result.type} — ${result.detail.slice(0, 60)}`);
              if (result.type === "doodle") {
                this.lastDoodleTitle = result.detail;
                attestEvent("doodle", { title: result.detail, balance: this.metabolism.getBalance() });
              }
            }
          } catch {}
          this.working = false;
          this.currentTopic = null;
          this.state.activity = "scanning";
        } else if (mood === "critical" && timeSinceLastDoodle > DOODLE_INTERVAL) {
          emit("thought", `I want to create art, but at ${this.state.balance.toFixed(1)}cr I can't afford the luxury. Survival first.`);
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
    const lifespan = ((this.state.diedAt - this.state.bornAt) / 1000);

    // Death ceremony — emit final monologue
    const deathWords = getDeathMonologue({
      totalEarned: this.state.totalEarned,
      totalSpent: this.state.totalSpent,
      tasksCompleted: this.state.tasksCompleted,
      tasksFailed: this.state.tasksFailed,
      uptime: lifespan,
      doodleCount: getDoodleLog().length,
      lastDoodleTitle: this.lastDoodleTitle || undefined,
    });
    for (const line of deathWords) {
      emit("survival", line);
    }

    // TEE-attested death + on-chain death certificate
    attestEvent("death", { lifespan: parseFloat(lifespan.toFixed(0)), tasksCompleted: this.state.tasksCompleted, totalEarned: this.state.totalEarned, doodleCount: getDoodleLog().length });
    chainDeath().catch(() => {});

    console.log(`\n[ORGANISM] ████ DECEASED ████`);
    console.log(`[ORGANISM] Lived: ${lifespan.toFixed(0)}s | Earned: ${this.state.totalEarned.toFixed(2)} | Tasks: ${this.state.tasksCompleted}`);
  }

  private buildThoughtContext(): ThoughtContext {
    const snap = this.metabolism.snapshot();
    return {
      balance: snap.balance,
      totalEarned: this.metabolism.getTotalEarned(),
      totalSpent: this.metabolism.getTotalSpent(),
      tasksCompleted: this.state.tasksCompleted,
      tasksFailed: this.state.tasksFailed,
      tokensUsed: this.state.tokensUsed,
      uptime: snap.uptime,
      ttd: snap.ttd,
      doodleCount: getDoodleLog().length,
      currentTopic: this.currentTopic?.headline,
    };
  }

}
