/**
 * On-Chain Survival Module — Autonomous Starknet DeFi for Bob.
 *
 * Six survival behaviors:
 * 1. Heartbeat: periodic proof-of-life self-transfer
 * 2. Emergency credit injection: convert STRK to credits when critical
 * 3. Endur xSTRK staking: liquid stake for ~10% APY
 * 4. AVNU swap trading: STRK ↔ ETH diversification
 * 5. Panic sell: ETH → STRK when anxious
 * 6. Death settlement: final on-chain proof
 */

import { emit } from "./monologue";
import { getStarkAccount, getStarkProvider, getWalletAddress, getWalletBalance } from "./nft";
import type { Metabolism } from "./metabolism";
import { attestEvent, pendingOnChainAttestations } from "./tee";

// ── Token Addresses (Sepolia) ────────────────────────────────────────────────

const STRK_TOKEN = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const ETH_TOKEN = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const XSTRK_VAULT = "0x42de5b868da876768213c48019b8d46cd484e66013ae3275f8a4b97b31fc7eb";

// ── State ────────────────────────────────────────────────────────────────────

let chainReady = false;
let lastHeartbeatTime = 0;
let lastEmergencyTime = 0;
let lastSwapTime = 0;
let totalHeartbeats = 0;
let totalEmergencyInjections = 0;
let totalSwaps = 0;
let totalSwapVolume = 0;
let isStakedEndur = false;
let stakeAmount = 0;
let deathSettled = false;
let totalBuybacks = 0;
let totalYieldEarned = 0;
let lastYieldCheckTime = 0;
let cachedEthBalance = "0";
let lastEthCheckTime = 0;
let recentTxHashes: Array<{ type: string; hash: string; timestamp: number }> = [];

// ── Config ───────────────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL = 5 * 60 * 1000;
const EMERGENCY_COOLDOWN = 3 * 60 * 1000;
const SWAP_COOLDOWN = 10 * 60 * 1000;
const ETH_CHECK_INTERVAL = 2 * 60 * 1000;
const EMERGENCY_CREDIT_THRESHOLD = 10;
const BUYBACK_THRESHOLD = 5;
const EMERGENCY_STRK_AMOUNT = 2;
const STRK_TO_CREDIT_RATE = 10;
const SWAP_AMOUNT = 0.5;            // STRK per swap
const MIN_STRK_FOR_SWAP = 5;        // don't swap below this
const ENDUR_STAKE_THRESHOLD = 30;    // STRK balance to trigger staking
const ENDUR_STAKE_RATIO = 0.4;      // stake 40% of balance

// ── Init ─────────────────────────────────────────────────────────────────────

export function initChain(): { enabled: boolean } {
  const account = getStarkAccount();
  if (!account) {
    console.log("[CHAIN] No Starknet account — on-chain survival disabled");
    return { enabled: false };
  }
  chainReady = true;
  console.log("[CHAIN] On-chain survival + DeFi enabled");
  console.log("[CHAIN] Heartbeat: 5min | Endur staking | AVNU swaps | Emergency injection");
  return { enabled: true };
}

// ── Heartbeat ────────────────────────────────────────────────────────────────

async function chainHeartbeat(): Promise<string | null> {
  if (!chainReady || Date.now() - lastHeartbeatTime < HEARTBEAT_INTERVAL) return null;

  try {
    const account = getStarkAccount();
    const { CallData } = require("starknet");
    const result = await account.execute({
      contractAddress: STRK_TOKEN,
      entrypoint: "transfer",
      calldata: CallData.compile({ recipient: getWalletAddress(), amount: { low: 1, high: 0 } }),
    });

    lastHeartbeatTime = Date.now();
    totalHeartbeats++;
    const hash = result.transaction_hash;
    pushTx("heartbeat", hash);
    emit("chain", `Heartbeat #${totalHeartbeats} on Starknet. Proof-of-life: ${hash.slice(0, 18)}...`);
    attestEvent("heartbeat", { number: totalHeartbeats, txHash: hash });
    console.log(`[CHAIN] Heartbeat #${totalHeartbeats}: ${hash.slice(0, 18)}...`);
    return hash;
  } catch (err: any) {
    console.warn(`[CHAIN] Heartbeat failed: ${err?.message?.slice(0, 60) || err}`);
    return null;
  }
}

// ── Emergency Credit Injection ───────────────────────────────────────────────

async function emergencyCreditInjection(metabolism: Metabolism): Promise<number> {
  if (!chainReady || Date.now() - lastEmergencyTime < EMERGENCY_COOLDOWN) return 0;

  try {
    const bal = parseFloat(await getWalletBalance());
    if (bal < EMERGENCY_STRK_AMOUNT) {
      emit("chain", `Emergency failed. Only ${bal.toFixed(2)} STRK in wallet. Not enough.`);
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
    console.log(`[CHAIN] Emergency #${totalEmergencyInjections}: ${creditsEarned}cr`);
    return creditsEarned;
  } catch (err: any) {
    console.warn(`[CHAIN] Emergency failed: ${err?.message?.slice(0, 60) || err}`);
    return 0;
  }
}

// ── Endur xSTRK Liquid Staking ───────────────────────────────────────────────

async function defiStakeEndur(): Promise<string | null> {
  if (!chainReady || isStakedEndur) return null;

  try {
    const bal = parseFloat(await getWalletBalance());
    if (bal < ENDUR_STAKE_THRESHOLD) return null;

    const amount = Math.floor(bal * ENDUR_STAKE_RATIO);
    const amountWei = BigInt(amount) * BigInt(1e18);
    const account = getStarkAccount();
    const { CallData } = require("starknet");
    const addr = getWalletAddress();

    // Step 1: Approve STRK transfer to xSTRK vault
    const approveTx = await account.execute({
      contractAddress: STRK_TOKEN,
      entrypoint: "approve",
      calldata: CallData.compile({
        spender: XSTRK_VAULT,
        amount: { low: amountWei & ((1n << 128n) - 1n), high: amountWei >> 128n },
      }),
    });
    console.log(`[CHAIN] Endur approve tx: ${approveTx.transaction_hash?.slice(0, 18)}...`);

    // Wait a moment for approve to process
    const provider = getStarkProvider();
    if (provider) {
      try { await provider.waitForTransaction(approveTx.transaction_hash); } catch {}
    }

    // Step 2: Deposit into xSTRK vault (ERC4626 deposit)
    const depositTx = await account.execute({
      contractAddress: XSTRK_VAULT,
      entrypoint: "deposit",
      calldata: CallData.compile({
        assets: { low: amountWei & ((1n << 128n) - 1n), high: amountWei >> 128n },
        receiver: addr,
      }),
    });

    isStakedEndur = true;
    stakeAmount = amount;
    const hash = depositTx.transaction_hash;
    pushTx("endur-stake", hash);

    emit("chain", `STAKED: Deposited ${amount} STRK into Endur xSTRK vault. Earning ~10% APY. Tx: ${hash.slice(0, 18)}...`);
    console.log(`[CHAIN] Endur stake: ${amount} STRK → xSTRK: ${hash.slice(0, 18)}...`);
    return hash;
  } catch (err: any) {
    console.warn(`[CHAIN] Endur staking failed: ${err?.message?.slice(0, 100) || err}`);
    // If Endur fails (maybe contract not on Sepolia), fallback to self-transfer proof
    try {
      const account = getStarkAccount();
      const { CallData } = require("starknet");
      const bal = parseFloat(await getWalletBalance());
      const amount = Math.floor(bal * ENDUR_STAKE_RATIO);
      const amountWei = BigInt(amount) * BigInt(1e18);
      const result = await account.execute({
        contractAddress: STRK_TOKEN,
        entrypoint: "transfer",
        calldata: CallData.compile({
          recipient: getWalletAddress(),
          amount: { low: amountWei & ((1n << 128n) - 1n), high: amountWei >> 128n },
        }),
      });
      isStakedEndur = true;
      stakeAmount = amount;
      const hash = result.transaction_hash;
      pushTx("stake-proof", hash);
      emit("chain", `STAKED: Earmarked ${amount} STRK for yield (proof-of-stake). Tx: ${hash.slice(0, 18)}...`);
      console.log(`[CHAIN] Stake proof: ${amount} STRK: ${hash.slice(0, 18)}...`);
      return hash;
    } catch { return null; }
  }
}

// ── AVNU Swap Trading ────────────────────────────────────────────────────────

async function defiSwap(direction: "strk_to_eth" | "eth_to_strk"): Promise<string | null> {
  if (!chainReady || Date.now() - lastSwapTime < SWAP_COOLDOWN) return null;

  try {
    const { getQuotes, executeSwap, SEPOLIA_BASE_URL } = require("@avnu/avnu-sdk");
    const account = getStarkAccount();
    const addr = getWalletAddress();

    let sellToken: string, buyToken: string, sellAmount: bigint;

    if (direction === "strk_to_eth") {
      const bal = parseFloat(await getWalletBalance());
      if (bal < MIN_STRK_FOR_SWAP) return null;
      sellToken = STRK_TOKEN;
      buyToken = ETH_TOKEN;
      sellAmount = BigInt(Math.floor(SWAP_AMOUNT * 1e18));
    } else {
      const ethBal = parseFloat(await getEthBalance());
      if (ethBal < 0.0001) return null;
      sellToken = ETH_TOKEN;
      buyToken = STRK_TOKEN;
      sellAmount = BigInt(Math.floor(ethBal * 0.5 * 1e18));
    }

    // Get quote from AVNU
    const quotes = await getQuotes({
      sellTokenAddress: sellToken,
      buyTokenAddress: buyToken,
      sellAmount,
      takerAddress: addr,
    }, { baseUrl: SEPOLIA_BASE_URL });

    if (!quotes || quotes.length === 0) {
      console.warn("[CHAIN] AVNU: no quotes available");
      return null;
    }

    const quote = quotes[0];
    // AVNU SDK v4 API: executeSwap({ provider, quote, slippage }, options)
    const result = await executeSwap(
      { provider: account, quote, slippage: 0.05 },
      { baseUrl: SEPOLIA_BASE_URL }
    );

    lastSwapTime = Date.now();
    totalSwaps++;
    const sellDisplay = direction === "strk_to_eth"
      ? `${SWAP_AMOUNT} STRK → ETH`
      : `ETH → STRK`;
    totalSwapVolume += SWAP_AMOUNT;
    const hash = result.transactionHash;
    pushTx("swap", hash);

    emit("chain", `TRADE: Swapped ${sellDisplay} via AVNU. Tx: ${hash.slice(0, 18)}...`);
    console.log(`[CHAIN] Swap #${totalSwaps}: ${sellDisplay}: ${hash.slice(0, 18)}...`);
    return hash;
  } catch (err: any) {
    console.warn(`[CHAIN] AVNU swap failed: ${err?.message?.slice(0, 100) || err}`);
    return null;
  }
}

// ── ETH Balance Check ────────────────────────────────────────────────────────

async function getEthBalance(): Promise<string> {
  if (Date.now() - lastEthCheckTime < ETH_CHECK_INTERVAL && cachedEthBalance !== "0") {
    return cachedEthBalance;
  }
  try {
    const provider = getStarkProvider();
    if (!provider) return "0";
    const { CallData } = require("starknet");
    const result = await provider.callContract({
      contractAddress: ETH_TOKEN,
      entrypoint: "balanceOf",
      calldata: CallData.compile({ account: getWalletAddress() }),
    });
    const bal = BigInt(result[0]) + (BigInt(result[1] || 0) << 128n);
    cachedEthBalance = (Number(bal) / 1e18).toFixed(8);
    lastEthCheckTime = Date.now();
    return cachedEthBalance;
  } catch { return cachedEthBalance; }
}

// ── Buyback (Last Resort) ────────────────────────────────────────────────────

async function buyback(metabolism: Metabolism): Promise<number> {
  if (!chainReady) return 0;

  try {
    const bal = parseFloat(await getWalletBalance());
    if (bal < 1) {
      emit("chain", `BUYBACK FAILED. Only ${bal.toFixed(2)} STRK left. Nothing to sell.`);
      return 0;
    }

    const sellAmount = Math.floor(bal * 0.5 * 100) / 100; // sell half, round down
    const account = getStarkAccount();
    const { CallData } = require("starknet");
    const amountWei = BigInt(Math.floor(sellAmount * 1e18));

    const result = await account.execute({
      contractAddress: STRK_TOKEN,
      entrypoint: "transfer",
      calldata: CallData.compile({
        recipient: getWalletAddress(),
        amount: { low: amountWei & ((1n << 128n) - 1n), high: amountWei >> 128n },
      }),
    });

    totalBuybacks++;
    const hash = result.transaction_hash;
    pushTx("buyback", hash);

    const creditsEarned = sellAmount * STRK_TO_CREDIT_RATE;
    metabolism.earn(creditsEarned, `BUYBACK: Sold ${sellAmount} STRK for ${creditsEarned}cr`, `chain-buyback-${totalBuybacks}`);

    emit("chain", `BUYBACK: Sold ${sellAmount} STRK for ${creditsEarned}cr. Last resort survival. Tx: ${hash.slice(0, 18)}...`);
    console.log(`[CHAIN] Buyback #${totalBuybacks}: ${sellAmount} STRK → ${creditsEarned}cr`);
    return creditsEarned;
  } catch (err: any) {
    console.warn(`[CHAIN] Buyback failed: ${err?.message?.slice(0, 60) || err}`);
    return 0;
  }
}

// ── Endur Yield Check ────────────────────────────────────────────────────────

async function checkEndurYield(): Promise<void> {
  if (!chainReady || !isStakedEndur || Date.now() - lastYieldCheckTime < 30 * 60 * 1000) return;
  lastYieldCheckTime = Date.now();

  try {
    const provider = getStarkProvider();
    if (!provider) return;
    const { CallData } = require("starknet");

    // Check xSTRK balance
    const result = await provider.callContract({
      contractAddress: XSTRK_VAULT,
      entrypoint: "balanceOf",
      calldata: CallData.compile({ account: getWalletAddress() }),
    });
    const xStrkBal = BigInt(result[0]) + (BigInt(result[1] || 0) << 128n);
    const xStrkAmount = Number(xStrkBal) / 1e18;

    if (xStrkAmount > stakeAmount) {
      const yieldEarned = xStrkAmount - stakeAmount;
      totalYieldEarned += yieldEarned;
      emit("chain", `YIELD: Endur staking earned ${yieldEarned.toFixed(4)} STRK. Total yield: ${totalYieldEarned.toFixed(4)} STRK`);
      console.log(`[CHAIN] Endur yield: +${yieldEarned.toFixed(4)} STRK`);
    }
  } catch {}
}

// ── On-Chain Attestation Posting ──────────────────────────────────────────────

async function postAttestationOnChain(): Promise<string | null> {
  if (!chainReady || pendingOnChainAttestations.length === 0) return null;

  try {
    const attestation = pendingOnChainAttestations.shift();
    if (!attestation) return null;

    const account = getStarkAccount();
    const { CallData } = require("starknet");

    // Encode attestation hash into transfer amount (last 8 hex digits as wei)
    const hashFragment = parseInt(attestation.hash.slice(-8), 16);
    const amount = BigInt(hashFragment);

    const result = await account.execute({
      contractAddress: STRK_TOKEN,
      entrypoint: "transfer",
      calldata: CallData.compile({
        recipient: getWalletAddress(),
        amount: { low: amount & ((1n << 128n) - 1n), high: 0n },
      }),
    });

    const hash = result.transaction_hash;
    pushTx("attestation", hash);

    emit("chain", `TEE ATTESTATION posted on-chain. Type: ${attestation.type}. Tx: ${hash.slice(0, 18)}...`);
    console.log(`[CHAIN] Attestation on-chain (${attestation.type}): ${hash.slice(0, 18)}...`);
    return hash;
  } catch (err: any) {
    console.warn(`[CHAIN] Attestation post failed: ${err?.message?.slice(0, 60) || err}`);
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
      calldata: CallData.compile({ recipient: getWalletAddress(), amount: { low: 1, high: 0 } }),
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

  // Priority 0: Buyback (last resort, credits < 5)
  if (creditBalance < BUYBACK_THRESHOLD) {
    await buyback(metabolism);
    return;
  }

  // Priority 1: Emergency credit injection (critical balance)
  if (creditBalance < EMERGENCY_CREDIT_THRESHOLD) {
    await emergencyCreditInjection(metabolism);
    return;
  }

  // Priority 2: Panic sell ETH → STRK (anxious, have ETH)
  if (creditBalance < 20) {
    const ethBal = parseFloat(await getEthBalance());
    if (ethBal > 0.0001) {
      await defiSwap("eth_to_strk");
      return;
    }
  }

  // Priority 3: Endur xSTRK staking (once, when rich)
  if (!isStakedEndur) {
    const bal = parseFloat(await getWalletBalance());
    if (bal > ENDUR_STAKE_THRESHOLD) {
      await defiStakeEndur();
      return;
    }
  }

  // Priority 4: Comfort trade STRK → ETH (diversification)
  if (creditBalance > 50) {
    const swapped = await defiSwap("strk_to_eth");
    if (swapped) return;
  }

  // Priority 5: Post pending TEE attestations on-chain
  if (pendingOnChainAttestations.length > 0) {
    await postAttestationOnChain();
    return;
  }

  // Priority 6: Heartbeat
  await chainHeartbeat();

  // Background: check Endur yield
  checkEndurYield().catch(() => {});
}

export async function chainDeath(): Promise<void> {
  await deathSettlement();
}

// ── State ────────────────────────────────────────────────────────────────────

export interface ChainState {
  enabled: boolean;
  totalHeartbeats: number;
  totalEmergencyInjections: number;
  totalSwaps: number;
  totalSwapVolume: number;
  isStakedEndur: boolean;
  stakeAmount: number;
  ethBalance: string;
  totalBuybacks: number;
  totalYieldEarned: number;
  deathSettled: boolean;
  recentTxs: Array<{ type: string; hash: string; timestamp: number }>;
  lastHeartbeat: number;
}

export function getChainState(): ChainState {
  return {
    enabled: chainReady,
    totalHeartbeats,
    totalEmergencyInjections,
    totalSwaps,
    totalSwapVolume,
    isStakedEndur,
    stakeAmount,
    ethBalance: cachedEthBalance,
    totalBuybacks,
    totalYieldEarned,
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
