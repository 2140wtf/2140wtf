import { describe, it, expect } from "vitest";

import { openCreditRequests, totalOpenSats } from "./baoWorkDiscovery";
import type { ComputeCreditReceipt, ComputeCreditRequest } from "./baoComputeCredits";

const req = (id: string, pubkey: string, amountSats: number, createdAt: number): ComputeCreditRequest => ({
  id,
  pubkey,
  amountSats,
  purpose: `work ${id}`,
  createdAt,
});

const receipt = (requestId: string, pubkey: string): ComputeCreditReceipt => ({
  id: `r-${requestId}`,
  pubkey,
  requestId,
  amountSats: 100,
  note: "redeemed",
  claimedFunders: [],
  createdAt: 2_000_000_000,
});

describe("openCreditRequests", () => {
  it("keeps requests whose author has not self-receipted", () => {
    const requests = [req("a1", "aa", 1000, 100), req("b1", "bb", 2000, 200)];
    const open = openCreditRequests(requests, []);
    expect(open).toHaveLength(2);
  });

  it("drops a request once its own author receipts it", () => {
    const requests = [req("a1", "aa", 1000, 100), req("b1", "bb", 2000, 200)];
    const open = openCreditRequests(requests, [receipt("a1", "aa")]);
    expect(open).toEqual([req("b1", "bb", 2000, 200)]);
  });

  it("ignores a third-party receipt — only the requester closes their own request", () => {
    const requests = [req("a1", "aa", 1000, 100)];
    // A funder (bb) published a receipt referencing a1 — that is NOT the
    // requester redeeming, so the request stays open.
    const open = openCreditRequests(requests, [receipt("a1", "bb")]);
    expect(open).toHaveLength(1);
  });

  it("sorts newest first", () => {
    const requests = [req("old", "aa", 1000, 100), req("new", "bb", 2000, 999)];
    const open = openCreditRequests(requests, []);
    expect(open.map((r) => r.id)).toEqual(["new", "old"]);
  });
});

describe("totalOpenSats", () => {
  it("sums the sats across open requests", () => {
    expect(totalOpenSats([req("a", "x", 2100, 1), req("b", "y", 7900, 2)])).toBe(10000);
  });
});
