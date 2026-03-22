import { describe, it, expect } from "vitest";
import { sealState, unsealState } from "../agents/sealed-storage";

describe("Sealed storage", () => {
  const testKey = "test-kms-public-key-for-sealing";

  it("seals and unseals with same key", () => {
    const state = { balance: 42.5, tasksCompleted: 7, totalEarned: 35.0 };
    const sealed = sealState(state, testKey);
    expect(sealed).toBe(true);

    const unsealed = unsealState(testKey);
    expect(unsealed).not.toBeNull();
    expect(unsealed.balance).toBe(42.5);
    expect(unsealed.tasksCompleted).toBe(7);
    expect(unsealed.totalEarned).toBe(35.0);
  });

  it("fails to unseal with different key", () => {
    const state = { balance: 100, tasksCompleted: 0 };
    sealState(state, testKey);

    const unsealed = unsealState("wrong-key-different-enclave");
    expect(unsealed).toBeNull();
  });

  it("handles complex state objects", () => {
    const state = {
      balance: 73.2,
      totalEarned: 150.5,
      tasksCompleted: 23,
      bornAt: Date.now(),
      tickCount: 1440,
    };
    sealState(state, testKey);
    const unsealed = unsealState(testKey);
    expect(unsealed.tickCount).toBe(1440);
    expect(unsealed.tasksCompleted).toBe(23);
  });
});
