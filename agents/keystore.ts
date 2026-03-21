/**
 * Keystore — Ed25519 keypair generation and attestation.
 * Reused from swarm-mind. Provides cryptographic identity for the organism.
 */

import crypto from "crypto";

export interface Keypair {
  publicKey: string;
  privateKey: string;
  fingerprint: string;
}

export function generateKeypair(): Keypair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const pubHex = publicKey.export({ type: "spki", format: "der" }).toString("hex");
  const privHex = privateKey.export({ type: "pkcs8", format: "der" }).toString("hex");
  const fingerprint = crypto.createHash("sha256").update(pubHex).digest("hex").slice(0, 16);
  return { publicKey: pubHex, privateKey: privHex, fingerprint };
}

export function signContent(content: string, privateKeyHex: string): string {
  try {
    const privKeyObj = crypto.createPrivateKey({
      key: Buffer.from(privateKeyHex, "hex"),
      format: "der",
      type: "pkcs8",
    });
    const signature = crypto.sign(null, Buffer.from(content), privKeyObj);
    return signature.toString("hex");
  } catch {
    return crypto.createHash("sha256").update(content).digest("hex");
  }
}

export function buildAttestation(
  content: string, agentId: string, timestamp: number,
  privateKeyHex: string, publicKeyHex: string
): string {
  const payload = `${agentId}|${timestamp}|${crypto.createHash("sha256").update(content).digest("hex")}`;
  const sig = signContent(payload, privateKeyHex);
  return `ed25519:${sig.slice(0, 64)}:${publicKeyHex.slice(-32)}`;
}

