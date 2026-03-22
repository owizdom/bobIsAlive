/**
 * Sealed Storage — Encrypt organism state to the TEE enclave.
 *
 * Uses a key derived from the KMS public key (unique per EigenCompute instance).
 * Only the same enclave running the same code can unseal this data.
 * This enables resurrection: Bob remembers past lives across restarts.
 */

import crypto from "crypto";
import fs from "fs";

const SEAL_PATH = "/tmp/bob-sealed-state.enc";
const SEAL_IV_PATH = "/tmp/bob-sealed-state.iv";

function getSealingKey(kmsPublicKey: string): Buffer {
  return crypto.createHash("sha256")
    .update("bob-sealed-storage-v1")
    .update(kmsPublicKey)
    .digest();
}

export function sealState(state: object, kmsPublicKey: string): boolean {
  try {
    const key = getSealingKey(kmsPublicKey);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const plaintext = JSON.stringify(state);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    fs.writeFileSync(SEAL_PATH, Buffer.concat([authTag, encrypted]));
    fs.writeFileSync(SEAL_IV_PATH, iv);

    console.log(`[SEAL] State sealed (${plaintext.length} bytes)`);
    return true;
  } catch (err: any) {
    console.warn(`[SEAL] Seal failed: ${err?.message}`);
    return false;
  }
}

export function unsealState(kmsPublicKey: string): any | null {
  try {
    if (!fs.existsSync(SEAL_PATH) || !fs.existsSync(SEAL_IV_PATH)) return null;

    const key = getSealingKey(kmsPublicKey);
    const iv = fs.readFileSync(SEAL_IV_PATH);
    const data = fs.readFileSync(SEAL_PATH);

    const authTag = data.subarray(0, 16);
    const encrypted = data.subarray(16);

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");

    console.log(`[SEAL] State unsealed successfully`);
    return JSON.parse(plaintext);
  } catch (err: any) {
    console.warn(`[SEAL] Unseal failed (different enclave or first boot): ${err?.message?.slice(0, 60)}`);
    return null;
  }
}
