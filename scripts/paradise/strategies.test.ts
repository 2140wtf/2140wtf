import { describe, expect, it, vi } from "vitest";
import { defaultStrategies } from "./strategies";
import type { StrategyContext } from "./strategies";

function ctx(patch: Partial<StrategyContext>): StrategyContext {
  return {
    nowMs: 0,
    fuel: "starving",
    routstrMsats: 0,
    dryRun: false,
    live: false,
    relays: ["wss://relay.bao.network"],
    canRaise: true,
    raiseBitcoin: vi.fn().mockResolvedValue("a".repeat(64)),
    agentPubkey: "0".repeat(64),
    ...patch,
  };
}

const bounty = () => defaultStrategies().find((s) => s.id === "bounty")!;

describe("strategies: bounty (raise-bitcoin surface)", () => {
  it("live + starving + canRaise posts a kind-4971 request via raiseBitcoin", async () => {
    const mock = vi.fn().mockResolvedValue("a".repeat(64));
    const r = await bounty().execute(ctx({ live: true, dryRun: false, fuel: "starving", canRaise: true, raiseBitcoin: mock }));
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock).toHaveBeenCalledWith(2100, "Paradise inference fuel");
    expect(r.ok).toBe(true);
    expect(r.walletDeltaMsats).toBe(0);
    expect(r.spentMsats).toBe(0);
    expect(r.message).toContain("raised bitcoin — posted kind-4971 request");
  });

  it("live + starving but on cooldown does NOT raise", async () => {
    const mock = vi.fn().mockResolvedValue("a".repeat(64));
    const r = await bounty().execute(ctx({ live: true, canRaise: false, raiseBitcoin: mock }));
    expect(mock).not.toHaveBeenCalled();
    expect(r.message).toContain("still seeking funds");
  });

  it("dry-run + starving simulates a funder answer (no raise call)", async () => {
    const mock = vi.fn().mockResolvedValue("a".repeat(64));
    const r = await bounty().execute(ctx({ live: false, dryRun: true, canRaise: true, raiseBitcoin: mock }));
    expect(mock).not.toHaveBeenCalled();
    expect(r.walletDeltaMsats).toBeGreaterThan(0);
  });

  it("non-starving does not raise", async () => {
    const mock = vi.fn().mockResolvedValue("a".repeat(64));
    const r = await bounty().execute(ctx({ fuel: "healthy", live: true, raiseBitcoin: mock }));
    expect(mock).not.toHaveBeenCalled();
    expect(r.message).toContain("scanned open requests");
  });
});
