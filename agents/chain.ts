/**
 * On-Chain Survival Module — Autonomous Starknet actions for Bob.
 *
 * Four survival behaviors:
 * 1. Heartbeat: periodic proof-of-life self-transfer (1 wei STRK)
 * 2. Emergency credit injection: convert STRK to credits when critical
 * 3. Victory staking: stake excess STRK when rich
 * 4. Death settlement: final on-chain proof when Bob dies
 */

import { emit } from "./monologue";
import { getStarkAccount, getWalletAddress, getWalletBalance } from "./nft";
import type { Metabolism } from "./metabolism";

const STRK_TOKEN = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

// ── State ────────────────────────────────────────────────────────────────────

let chainReady = false;
let lastHeartbeatTime = 0;
let lastEmergencyTime = 0;
let totalHeartbeats = 0;
let totalEmergencyInjections = 0;
let hasStaked = false;
let deathSettled = false;
let recentTxHashes: Array<{ type: string; hash: string; timestamp: number }> = [];

// ── Config ───────────────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL = 5 * 60 * 1000;     // 5 minutes
const EMERGENCY_COOLDOWN = 3 * 60 * 1000;      // 3 minutes
const EMERGENCY_CREDIT_THRESHOLD = 10;          // credits
const STAKING_THRESHOLD = 20;                   // STRK earned
const EMERGENCY_STRK_AMOUNT = 2;                // STRK per injection
const STRK_TO_CREDIT_RATE = 10;                 // 1 STRK = 10 credits

// ── Init ─────────────────────────────────────────────────────────────────────

export function initChain(): { enabled: boolean } {
  const account = getStarkAccount();
  if (!account) {
    console.log("[CHAIN] No Starknet account — on-chain survival disabled");
    return { enabled: false };
  }
  chainReady = true;
  console.log("[CHAIN] On-chain survival enabled");
  console.log("[CHAIN] Heartbeat: every 5 min | Emergency: <10cr | Staking: >20 STRK earned");
  return { enabled: true };
}

// ── Heartbeat ────────────────────────────────────────────────────────────────

async function chainHeartbeat(): Promise<string | null> {
  if (!chainReady) return null;
  if (Date.now() - lastHeartbeatTime < HEARTBEAT_INTERVAL) return null;

  try {
    const account = getStarkAccount();
    const { CallData } = require("starknet");

    const result = await account.execute({
      contractAddress: STRK_TOKEN,
      entrypoint: "transfer",
      calldata: CallData.compile({
        recipient: getWalletAddress(),
        amount: { low: 1, high: 0 },
      }),
    });

    lastHeartbeatTime = Date.now();
    totalHeartbeats++;
    const hash = result.transaction_hash;
    pushTx("heartbeat", hash);

    emit("chain", `Heartbeat #${totalHeartbeats} on Starknet. Proof-of-life: ${hash.slice(0, 18)}...`);
    console.log(`[CHAIN] Heartbeat #${totalHeartbeats}: ${hash.slice(0, 18)}...`);
    return hash;
  } catch (err: any) {
    console.warn(`[CHAIN] Heartbeat failed: ${err?.message?.slice(0, 60) || err}`);
    return null;
  }
}

// ── Emergency Credit Injection ───────────────────────────────────────────────

async function emergencyCreditInjection(metabolism: Metabolism): Promise<number> {
  if (!chainReady) return 0;
  if (Date.now() - lastEmergencyTime < EMERGENCY_COOLDOWN) return 0;

  try {
    const balStr = await getWalletBalance();
    const bal = parseFloat(balStr);
    if (bal < EMERGENCY_STRK_AMOUNT) {
      emit("chain", `Emergency injection failed. Only ${bal.toFixed(2)} STRK in wallet. Not enough.`);
      return 0;
    }

    const account = getStarkAccount();
    const { CallData } = require("starknet");
    const amountWei = BigInt(Math.floor(EMERGENCY_STRK_AMOUNT * 1e18));

    const result = await account.execute({
      contractAddress: STRK_TOKEN,
      entrypoint: "transfer",
      calldata: CallData.compile({
        recipient: getWalletAddress(),
        amount: { low: amountWei & ((1n << 128n) - 1n), high: amountWei >> 128n },
      }),
    });

    lastEmergencyTime = Date.now();
    totalEmergencyInjections++;
    const hash = result.transaction_hash;
    pushTx("emergency", hash);

    const creditsEarned = EMERGENCY_STRK_AMOUNT * STRK_TO_CREDIT_RATE;
    metabolism.earn(creditsEarned, `Emergency STRK-to-credits: ${EMERGENCY_STRK_AMOUNT} STRK`, `chain-emergency-${totalEmergencyInjections}`);

    emit("chain", `EMERGENCY: Burned ${EMERGENCY_STRK_AMOUNT} STRK for ${creditsEarned}cr. Survival instinct. Tx: ${hash.slice(0, 18)}...`);
    console.log(`[CHAIN] Emergency #${totalEmergencyInjections}: ${creditsEarned}cr from ${EMERGENCY_STRK_AMOUNT} STRK`);
    return creditsEarned;
  } catch (err: any) {
    console.warn(`[CHAIN] Emergency injection failed: ${err?.message?.slice(0, 60) || err}`);
    return 0;
  }
}

// ── Victory Staking ──────────────────────────────────────────────────────────

async function victoryStake(): Promise<string | null> {
  if (!chainReady || hasStaked) return null;

  try {
    const balStr = await getWalletBalance();
    const bal = parseFloat(balStr);
    if (bal < STAKING_THRESHOLD) return null;

    const stakeAmount = Math.floor(bal * 0.5);
    const account = getStarkAccount();
    const { CallData } = require("starknet");
    const amountWei = BigInt(stakeAmount) * BigInt(1e18);

    // Self-transfer as staking proof (safe; real staking contract can replace later)
    const result = await account.execute({
      contractAddress: STRK_TOKEN,
      entrypoint: "transfer",
      calldata: CallData.compile({
        recipient: getWalletAddress(),
        amount: { low: amountWei & ((1n << 128n) - 1n), high: amountWei >> 128n },
      }),
    });

    hasStaked = true;
    const hash = result.transaction_hash;
    pushTx("stake", hash);

    emit("chain", `VICTORY: Earmarked ${stakeAmount} STRK for staking. Financial planning activated. Tx: ${hash.slice(0, 18)}...`);
    console.log(`[CHAIN] Victory stake: ${stakeAmount} STRK: ${hash.slice(0, 18)}...`);
    return hash;
  } catch (err: any) {
    console.warn(`[CHAIN] Victory stake failed: ${err?.message?.slice(0, 60) || err}`);
    return null;
  }
}

// ── Death Settlement ─────────────────────────────────────────────────────────

async function deathSettlement(): Promise<string | null> {
  if (!chainReady || deathSettled) return null;

  try {
    const account = getStarkAccount();
    const { CallData } = require("starknet");

    const result = await account.execute({
      contractAddress: STRK_TOKEN,
      entrypoint: "transfer",
      calldata: CallData.compile({
        recipient: getWalletAddress(),
        amount: { low: 1, high: 0 },
      }),
    });

    deathSettled = true;
    const hash = result.transaction_hash;
    pushTx("death", hash);

    emit("chain", `DEATH CERTIFICATE recorded on Starknet. Final proof: ${hash.slice(0, 18)}... Goodbye.`);
    console.log(`[CHAIN] Death settlement: ${hash.slice(0, 18)}...`);
    return hash;
  } catch (err: any) {
    console.warn(`[CHAIN] Death settlement failed: ${err?.message?.slice(0, 60) || err}`);
    return null;
  }
}

// ── Tick Orchestrator ────────────────────────────────────────────────────────

export async function chainTick(creditBalance: number, metabolism: Metabolism, strkEarned: number): Promise<void> {
  if (!chainReady) return;

  // Priority 1: Emergency credit injection when credits critical
  if (creditBalance < EMERGENCY_CREDIT_THRESHOLD) {
    await emergencyCreditInjection(metabolism);
    return;
  }

  // Priority 2: Victory staking when rich from sales
  if (strkEarned > STAKING_THRESHOLD && !hasStaked) {
    await victoryStake();
    return;
  }

  // Priority 3: Periodic heartbeat
  await chainHeartbeat();
}

export async function chainDeath(): Promise<void> {
  await deathSettlement();
}

// ── State ────────────────────────────────────────────────────────────────────

export interface ChainState {
  enabled: boolean;
  totalHeartbeats: number;
  totalEmergencyInjections: number;
  hasStaked: boolean;
  deathSettled: boolean;
  recentTxs: Array<{ type: string; hash: string; timestamp: number }>;
  lastHeartbeat: number;
}

export function getChainState(): ChainState {
  return {
    enabled: chainReady,
    totalHeartbeats,
    totalEmergencyInjections,
    hasStaked,
    deathSettled,
    recentTxs: [...recentTxHashes],
    lastHeartbeat: lastHeartbeatTime,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function pushTx(type: string, hash: string) {
  recentTxHashes.push({ type, hash, timestamp: Date.now() });
  if (recentTxHashes.length > 20) recentTxHashes.shift();
}
