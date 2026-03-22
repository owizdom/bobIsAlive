import { describe, it, expect } from "vitest";
import { Metabolism } from "../agents/metabolism";

describe("Metabolism", () => {
  it("starts with correct balance", () => {
    const m = new Metabolism(100, "test-agent", "privkey", "pubkey");
    expect(m.getBalance()).toBe(100);
    expect(m.isAlive()).toBe(true);
  });

  it("burns credits each tick", () => {
    const m = new Metabolism(100, "test-agent", "privkey", "pubkey");
    m.tick();
    expect(m.getBalance()).toBeLessThan(100);
  });

  it("dies at zero balance", () => {
    const m = new Metabolism(0.01, "test-agent", "privkey", "pubkey");
    m.tick(); // burns 0.05
    expect(m.isAlive()).toBe(false);
    expect(m.getBalance()).toBe(0);
  });

  it("earns credits from tasks", () => {
    const m = new Metabolism(50, "test-agent", "privkey", "pubkey");
    m.earn(10, "Task completed", "task-1");
    expect(m.getBalance()).toBe(60);
    expect(m.getTotalEarned()).toBe(10);
  });

  it("deducts inference cost", () => {
    const m = new Metabolism(100, "test-agent", "privkey", "pubkey");
    m.deductInference(500, "task-1"); // 500 tokens * 0.001 = 0.5
    expect(m.getBalance()).toBe(99.5);
  });

  it("calculates correct TTD", () => {
    const m = new Metabolism(100, "test-agent", "privkey", "pubkey");
    const snap = m.snapshot();
    expect(snap.alive).toBe(true);
    expect(snap.balance).toBe(100);
    expect(snap.burnRate).toBeGreaterThan(0);
  });

  it("tracks total spent", () => {
    const m = new Metabolism(100, "test-agent", "privkey", "pubkey");
    m.tick();
    m.tick();
    expect(m.getTotalSpent()).toBeGreaterThan(0);
  });
});
