import { describe, it, expect } from "vitest";
import crypto from "crypto";

describe("TEE attestation", () => {
  it("generates valid Ed25519 keypair", () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const msg = Buffer.from("test-message");
    const sig = crypto.sign(null, msg, privateKey);
    expect(crypto.verify(null, msg, publicKey, sig)).toBe(true);
  });

  it("attestation signature is verifiable", () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const payload = JSON.stringify({ type: "task", data: { taskId: "test-123" }, timestamp: Date.now() });
    const signature = crypto.sign(null, Buffer.from(payload), privateKey);
    expect(crypto.verify(null, Buffer.from(payload), publicKey, signature)).toBe(true);
  });

  it("different key cannot forge attestation", () => {
    const { privateKey: key1 } = crypto.generateKeyPairSync("ed25519");
    const { publicKey: key2pub } = crypto.generateKeyPairSync("ed25519");
    const payload = Buffer.from("forged-payload");
    const sig = crypto.sign(null, payload, key1);
    expect(crypto.verify(null, payload, key2pub, sig)).toBe(false);
  });

  it("SHA-256 hash is deterministic", () => {
    const data = "attestation-payload-test";
    const hash1 = crypto.createHash("sha256").update(data).digest("hex");
    const hash2 = crypto.createHash("sha256").update(data).digest("hex");
    expect(hash1).toBe(hash2);
  });

  it("HKDF wallet derivation is deterministic", () => {
    const kmsKey = "test-kms-public-key-content";
    const derive = (key: string) => {
      const ikm = crypto.createHash("sha256").update(key).digest();
      const salt = Buffer.from("bob-is-alive-starknet-wallet-v1");
      const info = Buffer.from("starknet-signing-key");
      const prk = crypto.createHmac("sha256", salt).update(ikm).digest();
      return crypto.createHmac("sha256", prk).update(Buffer.concat([info, Buffer.from([1])])).digest("hex");
    };
    expect(derive(kmsKey)).toBe(derive(kmsKey));
  });

  it("different KMS key produces different wallet", () => {
    const derive = (key: string) => {
      const ikm = crypto.createHash("sha256").update(key).digest();
      const salt = Buffer.from("bob-is-alive-starknet-wallet-v1");
      const prk = crypto.createHmac("sha256", salt).update(ikm).digest();
      return crypto.createHmac("sha256", prk).update(Buffer.concat([Buffer.from("starknet-signing-key"), Buffer.from([1])])).digest("hex");
    };
    expect(derive("kms-key-1")).not.toBe(derive("kms-key-2"));
  });
});
