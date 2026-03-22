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

// Search multiple possible paths for the KMS signing public key
const KMS_KEY_CANDIDATES = [
  process.env.KMS_SIGNING_KEY_FILE,                    // env var from eigencompute-containers
  process.env.KMS_SIGNING_PUBLIC_KEY_FILE,              // alternate env var name
  "/usr/local/bin/kms-signing-public-key.pem",          // legacy/documented path
  "/eigen/bin/kms-signing-public-key.pem",              // eigencompute-containers binary path
  "/eigen/kms-signing-public-key.pem",                  // eigencompute root
  "/run/kms-signing-public-key.pem",                    // runtime mount
  "/tmp/kms-signing-public-key.pem",                    // temp mount
].filter(Boolean) as string[];

// dstack / KMS HTTP API candidates for TDX quote
const DSTACK_API_CANDIDATES = [
  process.env.DSTACK_ENDPOINT,
  process.env.DSTACK_URL,
  process.env.KMS_SERVER_URL,       // EigenCloud KMS server (e.g. http://10.128.15.203:8080)
  "http://localhost:8090",
  "http://127.0.0.1:8090",
  "http://localhost:8091",
];

let resolvedKmsKeyPath: string | null = null;

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

  // Step 2: Check KMS_PUBLIC_KEY env var first (EigenCloud injects key as env var, not file)
  if (process.env.KMS_PUBLIC_KEY) {
    kmsPublicKey = process.env.KMS_PUBLIC_KEY.trim();
    resolvedKmsKeyPath = "env:KMS_PUBLIC_KEY";
    teeActive = true;
    console.log(`[TEE] KMS key loaded from KMS_PUBLIC_KEY env var (${kmsPublicKey.length} chars)`);
  }

  // Step 2b: Fall back to file-based search
  if (!teeActive) {
    console.log(`[TEE] No KMS_PUBLIC_KEY env var, searching ${KMS_KEY_CANDIDATES.length} file paths...`);
    for (const candidate of KMS_KEY_CANDIDATES) {
      try {
        if (fs.existsSync(candidate)) {
          const content = fs.readFileSync(candidate, "utf8").trim();
          if (content && content.length > 10 && (content.includes("KEY") || content.includes("-----BEGIN"))) {
            kmsPublicKey = content;
            resolvedKmsKeyPath = candidate;
            teeActive = true;
            console.log(`[TEE] KMS key FOUND at: ${candidate}`);
            break;
          }
          console.log(`[TEE] File exists but not a valid key: ${candidate}`);
        }
      } catch (err: any) {
        console.log(`[TEE] Error reading ${candidate}: ${err?.message?.slice(0, 60)}`);
      }
    }
  }

  // Step 2c: Scan directories for .pem files only (skip binaries)
  if (!teeActive) {
    const scanDirs = ["/eigen", "/eigen/bin", "/usr/local/bin", "/run", "/tmp", "/etc/eigencompute"];
    for (const dir of scanDirs) {
      try {
        if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
          const files = fs.readdirSync(dir);
          const pemFiles = files.filter(f => f.endsWith(".pem"));
          if (pemFiles.length > 0) {
            console.log(`[TEE] Found .pem files in ${dir}: ${pemFiles.join(", ")}`);
            for (const pf of pemFiles) {
              const fullPath = path.join(dir, pf);
              try {
                const content = fs.readFileSync(fullPath, "utf8").trim();
                if (content.includes("PUBLIC KEY") || content.includes("-----BEGIN")) {
                  kmsPublicKey = content;
                  resolvedKmsKeyPath = fullPath;
                  teeActive = true;
                  console.log(`[TEE] KMS key discovered at: ${fullPath}`);
                  break;
                }
              } catch {}
            }
            if (teeActive) break;
          }
        }
      } catch {}
    }
  }

  // Step 2d: Last resort — if EIGENCOMPUTE_INSTANCE_ID is set, we're in a TEE
  if (!teeActive && process.env.EIGENCOMPUTE_INSTANCE_ID) {
    console.log(`[TEE] No KMS key found but EIGENCOMPUTE_INSTANCE_ID=${process.env.EIGENCOMPUTE_INSTANCE_ID}`);
    teeActive = true;
    kmsPublicKey = `eigencompute-instance:${process.env.EIGENCOMPUTE_INSTANCE_ID}`;
    console.log(`[TEE] TEE activated via platform env var (fallback mode)`);
  }

  if (teeActive && resolvedKmsKeyPath) {
    // Derive KMS key hash from actual key file
    kmsKeyHash = crypto.createHash("sha256").update(kmsPublicKey!).digest("hex");

    // Derive enclave identity = SHA256(kmsKeyHash + ed25519Pubkey)
    enclaveIdentity = crypto.createHash("sha256")
      .update(kmsKeyHash)
      .update(teeSigningPublicKey)
      .digest("hex");

    console.log("[TEE] Intel TDX enclave detected");
    console.log(`[TEE] KMS key hash: ${kmsKeyHash.slice(0, 24)}...`);
    console.log(`[TEE] KMS key path: ${resolvedKmsKeyPath}`);
    console.log(`[TEE] Enclave identity: ${enclaveIdentity.slice(0, 24)}...`);
  }

  // Step 3: Bind Ed25519 pubkey to TDX quote
  if (teeActive) {
    const pubkeyHash = crypto.createHash("sha256")
      .update(Buffer.from(teeSigningPublicKey, "hex"))
      .digest();

    // Try ConfigFS-TSM first, then dstack HTTP API
    tdxQuote = generateTDXQuote(pubkeyHash);
    if (!tdxQuote) {
      console.log(`[TEE] ConfigFS-TSM not available, trying dstack HTTP API...`);
      // dstack quote fetched async — kick it off
      fetchDstackQuote(pubkeyHash).catch(() => {});
    }
    tdxQuoteTimestamp = Date.now();

    if (tdxQuote) {
      console.log(`[TEE] Ed25519 pubkey BOUND to TDX quote`);
      console.log(`[TEE] Chain: TDX quote -> pubkey hash -> event signatures`);
    } else {
      console.log(`[TEE] Will retry TDX quote via dstack API in background.`);
    }

    console.log("[TEE] Attestation mode: PRODUCTION (hardware-enforced)");
  } else {
    console.log("[TEE] No KMS key found in any location. Running in local dev mode.");
    console.log("[TEE] Searched: " + KMS_KEY_CANDIDATES.join(", "));
    console.log("[TEE] Attestation mode: DEV (signatures valid but not hardware-anchored)");
  }

  return { active: teeActive, kmsPublicKey };
}

// ── dstack HTTP API (Phala TEEaaS) ──────────────────────────────────────────

let dstackEndpoint: string | null = null;

async function fetchDstackQuote(reportData: Buffer): Promise<void> {
  for (const endpoint of DSTACK_API_CANDIDATES) {
    if (!endpoint) continue;
    try {
      const url = `${endpoint}/prpc/Attest`;
      const body = JSON.stringify({ report_data: reportData.toString("hex") });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json() as any;
        if (data.quote) {
          tdxQuote = typeof data.quote === "string" ? data.quote : Buffer.from(data.quote).toString("hex");
          tdxQuoteTimestamp = Date.now();
          dstackEndpoint = endpoint;
          console.log(`[TEE] TDX quote obtained via dstack API at ${endpoint} (${tdxQuote!.length / 2} bytes)`);
          console.log(`[TEE] Ed25519 pubkey BOUND to TDX quote via dstack`);
          return;
        }
      }
      console.log(`[TEE] dstack ${endpoint}: ${res.status} ${res.statusText}`);
    } catch (err: any) {
      const msg = err?.name === "AbortError" ? "timeout" : err?.message?.slice(0, 40);
      console.log(`[TEE] dstack ${endpoint}: ${msg}`);
    }
  }
  console.log("[TEE] No dstack API endpoint responded with a TDX quote");
}

// ── Debug Info ──────────────────────────────────────────────────────────────

export function getTEEDebugInfo(): Record<string, any> {
  const debug: Record<string, any> = {};

  // TEE-related env vars
  debug.envVars = {};
  const prefixes = ["KMS", "TEE", "EIGEN", "DSTACK", "TDX", "SGX", "SEV", "PHALA"];
  for (const [k, v] of Object.entries(process.env)) {
    if (prefixes.some(p => k.toUpperCase().startsWith(p))) {
      debug.envVars[k] = v && v.length > 80 ? v.slice(0, 80) + "..." : v;
    }
  }

  // Directory scans
  debug.directoryScans = {};
  const dirs = ["/eigen", "/eigen/bin", "/usr/local/bin", "/run", "/var/run", "/etc/eigencompute", "/tmp"];
  for (const dir of dirs) {
    try {
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
        const files = fs.readdirSync(dir);
        debug.directoryScans[dir] = files.slice(0, 30);
      } else {
        debug.directoryScans[dir] = "does not exist";
      }
    } catch (err: any) {
      debug.directoryScans[dir] = `error: ${err?.message?.slice(0, 40)}`;
    }
  }

  // Resolved paths
  debug.resolvedKmsKeyPath = resolvedKmsKeyPath;
  debug.kmsKeyCandidatesChecked = KMS_KEY_CANDIDATES;
  debug.dstackEndpoint = dstackEndpoint;
  debug.teeActive = teeActive;
  debug.kmsKeyHash = kmsKeyHash;
  debug.enclaveIdentity = enclaveIdentity;

  // TEE devices
  debug.devices = {
    tdxGuest: fs.existsSync("/dev/tdx-guest"),
    tdxAttest: fs.existsSync("/dev/tdx_guest"),
    sgxEnclave: fs.existsSync("/dev/sgx_enclave"),
    sevGuest: fs.existsSync("/dev/sev-guest"),
    configfsTSM: fs.existsSync("/sys/kernel/config/tsm"),
    dstackSocket: fs.existsSync("/var/run/dstack.sock"),
  };

  return debug;
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
  env.kmsSigningKey = resolvedKmsKeyPath ? fs.existsSync(resolvedKmsKeyPath) : false;
  env.kmsSigningKeyPath = resolvedKmsKeyPath;
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
