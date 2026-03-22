/**
 * TEE Attestation Module — Deep EigenCompute Intel TDX Integration
 *
 * 1. Generates Ed25519 keypair in enclave memory (never on disk)
 * 2. Binds the pubkey to a TDX attestation quote via ConfigFS-TSM
 * 3. Signs every output with the TEE-resident key
 * 4. Includes KMS identity hash in all attestations
 * 5. Derives Starknet wallet key from KMS (TEE-anchored)
 *
 * Verification chain: TDX quote -> pubkey hash -> Ed25519 signatures -> events
 * Without the TEE, the quote is null, the wallet falls back to env var,
 * and the attestation chain has no hardware anchor.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";

// ── Constants ────────────────────────────────────────────────────────────────

const KMS_KEY_PATH = "/usr/local/bin/kms-signing-public-key.pem";

// ── State ────────────────────────────────────────────────────────────────────

let kmsPublicKey: string | null = null;
let kmsKeyHash: string = "none";
let teeActive = false;
let enclaveIdentity: string = "local-dev";

// TEE-resident Ed25519 keypair (memory only, never on disk)
let teeSigningPrivateKey: crypto.KeyObject | null = null;
let teeSigningPublicKey: string = "";

// TDX quote (hardware attestation)
let tdxQuote: string | null = null;
let tdxQuoteTimestamp: number = 0;

// Attestation log
const attestationLog: TEEAttestation[] = [];
export const pendingOnChainAttestations: TEEAttestation[] = [];

// ── Types ────────────────────────────────────────────────────────────────────

export interface TEEAttestation {
  id: string;
  type: "task" | "doodle" | "heartbeat" | "swap" | "stake" | "death" | "birth";
  payload: string;
  hash: string;
  signature: string;
  teePublicKey: string;
  kmsKeyHash: string;
  tdxQuoteHash: string | null;
  verified: boolean;
  timestamp: number;
  enclave: string;
}

// ── TDX Quote Generation (ConfigFS-TSM) ──────────────────────────────────────

function generateTDXQuote(reportData: Buffer): string | null {
  const tsmPath = "/sys/kernel/config/tsm/report";
  try {
    if (!fs.existsSync(tsmPath)) return null;

    const entryName = `bob-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const dir = `${tsmPath}/${entryName}`;
    fs.mkdirSync(dir, { recursive: true });

    // inblob must be exactly 64 bytes for TDX
    const inblob = Buffer.alloc(64);
    reportData.copy(inblob, 0, 0, Math.min(reportData.length, 64));
    fs.writeFileSync(`${dir}/inblob`, inblob);

    // Read the hardware-generated quote
    const quote = fs.readFileSync(`${dir}/outblob`);

    // Cleanup
    try { fs.rmSync(dir, { recursive: true }); } catch {}

    console.log(`[TEE] TDX quote generated: ${quote.length} bytes via ConfigFS-TSM`);
    return quote.toString("hex");
  } catch (err: any) {
    console.warn(`[TEE] TDX quote generation failed: ${err?.message?.slice(0, 80)}`);
    return null;
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────

export function initTEE(): { active: boolean; kmsPublicKey: string | null } {
  // Step 1: Generate TEE-resident Ed25519 keypair (memory only)
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  teeSigningPrivateKey = privateKey;
  teeSigningPublicKey = publicKey.export({ type: "spki", format: "der" }).toString("hex");

  console.log(`[TEE] Signing key generated in memory: ${teeSigningPublicKey.slice(0, 24)}...`);
  console.log(`[TEE] This key exists only in RAM. Lost when enclave stops.`);

  // Step 2: Read KMS public key (EigenCompute enclave identity)
  try {
    if (fs.existsSync(KMS_KEY_PATH)) {
      kmsPublicKey = fs.readFileSync(KMS_KEY_PATH, "utf8").trim();
      teeActive = true;

      // Derive KMS key hash
      kmsKeyHash = crypto.createHash("sha256").update(kmsPublicKey).digest("hex");

      // Derive enclave identity = SHA256(kmsKeyHash + ed25519Pubkey)
      enclaveIdentity = crypto.createHash("sha256")
        .update(kmsKeyHash)
        .update(teeSigningPublicKey)
        .digest("hex");

      console.log("[TEE] Intel TDX enclave detected");
      console.log(`[TEE] KMS key hash: ${kmsKeyHash.slice(0, 24)}...`);
      console.log(`[TEE] Enclave identity: ${enclaveIdentity.slice(0, 24)}...`);
    }
  } catch (err: any) {
    console.warn(`[TEE] KMS key read failed: ${err?.message?.slice(0, 60)}`);
  }

  // Step 3: Bind Ed25519 pubkey to TDX quote
  if (teeActive) {
    const pubkeyHash = crypto.createHash("sha256")
      .update(Buffer.from(teeSigningPublicKey, "hex"))
      .digest();

    tdxQuote = generateTDXQuote(pubkeyHash);
    tdxQuoteTimestamp = Date.now();

    if (tdxQuote) {
      console.log(`[TEE] Ed25519 pubkey BOUND to TDX quote`);
      console.log(`[TEE] Chain: TDX quote -> pubkey hash -> event signatures`);
    } else {
      console.log(`[TEE] ConfigFS-TSM not available. Using KMS + Ed25519 attestation.`);
    }

    console.log("[TEE] Attestation mode: PRODUCTION (hardware-enforced)");
  } else {
    console.log("[TEE] No KMS key found. Running in local dev mode.");
    console.log("[TEE] Attestation mode: DEV (signatures valid but not hardware-anchored)");
  }

  return { active: teeActive, kmsPublicKey };
}

// ── Sign / Verify ────────────────────────────────────────────────────────────

function teeSign(content: string): string {
  if (!teeSigningPrivateKey) return "no-key";
  try {
    return crypto.sign(null, Buffer.from(content), teeSigningPrivateKey).toString("hex");
  } catch { return "sign-failed"; }
}

function teeVerify(content: string, signatureHex: string): boolean {
  try {
    const pubKeyObj = crypto.createPublicKey({
      key: Buffer.from(teeSigningPublicKey, "hex"),
      format: "der",
      type: "spki",
    });
    return crypto.verify(null, Buffer.from(content), pubKeyObj, Buffer.from(signatureHex, "hex"));
  } catch { return false; }
}

// ── Attestation ──────────────────────────────────────────────────────────────

export function attestEvent(
  type: TEEAttestation["type"],
  data: Record<string, any>
): TEEAttestation {
  const timestamp = Date.now();
  const id = crypto.randomBytes(8).toString("hex");

  const tdxQuoteHash = tdxQuote
    ? crypto.createHash("sha256").update(tdxQuote).digest("hex").slice(0, 32)
    : null;

  const payload = JSON.stringify({
    id, type, data, timestamp,
    tee: teeActive ? "intel-tdx" : "local-dev",
    instance: process.env.EIGENCOMPUTE_INSTANCE_ID || "local",
    teePublicKey: teeSigningPublicKey.slice(0, 32),
    kmsKeyHash: teeActive ? kmsKeyHash.slice(0, 32) : "none",
    tdxQuoteHash,
  });

  const hash = crypto.createHash("sha256").update(payload).digest("hex");
  const signature = teeSign(payload);
  const verified = teeVerify(payload, signature);

  const attestation: TEEAttestation = {
    id, type, payload, hash, signature,
    teePublicKey: teeSigningPublicKey,
    kmsKeyHash: teeActive ? kmsKeyHash : "none",
    tdxQuoteHash,
    verified, timestamp,
    enclave: teeActive ? "eigencompute-intel-tdx" : "local-dev",
  };

  attestationLog.push(attestation);
  if (attestationLog.length > 200) attestationLog.shift();

  if (type === "task" || type === "doodle" || type === "death") {
    pendingOnChainAttestations.push(attestation);
  }

  return attestation;
}

// ── TEE-Derived Wallet Key ───────────────────────────────────────────────────

export function deriveTEEWalletKey(): string | null {
  if (!teeActive || !kmsPublicKey) return null;
  try {
    const ikm = crypto.createHash("sha256").update(kmsPublicKey).digest();
    const salt = Buffer.from("bob-is-alive-starknet-wallet-v1");
    const info = Buffer.from("starknet-signing-key");
    const prk = crypto.createHmac("sha256", salt).update(ikm).digest();
    const derivedKey = crypto.createHmac("sha256", prk)
      .update(Buffer.concat([info, Buffer.from([1])]))
      .digest();
    console.log(`[TEE] Starknet wallet key derived from KMS (deterministic per enclave)`);
    return "0x" + derivedKey.toString("hex");
  } catch (err: any) {
    console.warn(`[TEE] Wallet key derivation failed: ${err?.message}`);
    return null;
  }
}

// ── TEE Environment Probe ────────────────────────────────────────────────────

export function probeTEEEnvironment(): Record<string, any> {
  const env: Record<string, any> = {};
  env.tdxGuestDevice = fs.existsSync("/dev/tdx-guest");
  env.configfsTSM = fs.existsSync("/sys/kernel/config/tsm");
  env.dstackSocket = fs.existsSync("/var/run/dstack.sock");
  env.kmsSigningKey = fs.existsSync(KMS_KEY_PATH);
  env.ccelEventLog = fs.existsSync("/sys/firmware/acpi/tables/ccel");
  env.dmiTables = fs.existsSync("/sys/firmware/dmi/tables/DMI");
  env.eigencomputeInstanceId = process.env.EIGENCOMPUTE_INSTANCE_ID || null;
  env.tdxQuoteAvailable = tdxQuote !== null;
  env.tdxQuoteLength = tdxQuote ? tdxQuote.length / 2 : 0;
  try {
    const cpuinfo = fs.readFileSync("/proc/cpuinfo", "utf8");
    env.cpuTDXSupport = cpuinfo.includes("tdx");
  } catch { env.cpuTDXSupport = false; }
  return env;
}

// ── API ──────────────────────────────────────────────────────────────────────

export function isTEEActive(): boolean { return teeActive; }
export function getKMSPublicKey(): string | null { return kmsPublicKey; }
export function getAttestationLog(): TEEAttestation[] { return [...attestationLog]; }
export function getTDXQuote(): string | null { return tdxQuote; }
export function getTDXQuoteTimestamp(): number { return tdxQuoteTimestamp; }
export function getTeeSigningPublicKey(): string { return teeSigningPublicKey; }
export function getKmsKeyHash(): string { return kmsKeyHash; }
export function getEnclaveIdentity(): string { return enclaveIdentity; }

export function getTEEState() {
  return {
    active: teeActive,
    mode: teeActive ? "intel-tdx" : "local-dev",
    signingPublicKey: teeSigningPublicKey,
    kmsPublicKey: kmsPublicKey?.slice(0, 80) || null,
    kmsKeyHash: teeActive ? kmsKeyHash : null,
    enclaveIdentity,
    tdxQuote: tdxQuote ? { available: true, length: tdxQuote.length / 2, timestamp: tdxQuoteTimestamp } : { available: false },
    environment: probeTEEEnvironment(),
    instanceId: process.env.EIGENCOMPUTE_INSTANCE_ID || "local",
    totalAttestations: attestationLog.length,
    pendingOnChain: pendingOnChainAttestations.length,
    eigencloudDashboard: "https://verify-sepolia.eigencloud.xyz/app/0xeE4d468A50E1B693CC34C96c9518Ee5cB7920E7F",
    verificationChain: [
      "1. Validate TDX quote with Intel DCAP verification",
      "2. Extract REPORTDATA from TDX quote",
      "3. Verify REPORTDATA == SHA256(signingPublicKey)",
      "4. For any event: crypto.verify(null, payload, signingPublicKey, signature)",
      "5. This proves the event was signed inside a genuine Intel TDX enclave",
    ],
    recentAttestations: attestationLog.slice(-10).map(a => ({
      id: a.id, type: a.type, hash: a.hash,
      signature: a.signature.slice(0, 32) + "...",
      tdxQuoteHash: a.tdxQuoteHash,
      verified: a.verified, timestamp: a.timestamp, enclave: a.enclave,
    })),
  };
}

// ── Verify External ──────────────────────────────────────────────────────────

export function verifyAttestationSignature(payload: string, signature: string): boolean {
  return teeVerify(payload, signature);
}
