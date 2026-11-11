/**
 * Security round 36 — the summons caps attacked as a DoS on the true signal.
 *
 * Round 35 capped the notice list and the toast queue, newest-first. But ANY
 * key can publish a `#p`-tagged kind-39002/38026 to a juror's npub, so
 * "newest wins" let a stranger flood 200+ notices and push a GENUINE court
 * summons off the list entirely — it disappeared from `unseen`, from the badge
 * and from the toast queue (the real signal was silenced, not just crowded).
 *
 *  R36-S1 a court-attributed summons survives a 250-notice unattributed flood
 *         (list, unseen list and the first toast),
 *  R36-S2 unattributed toasts are capped so they cannot spend the whole queue,
 *  R36-S3 the toast body inherits the display guard (bidi / surrogate-safe).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";

import type { NostrEvent } from "@nostrify/nostrify";

import { useMySummons, SUMMONS_PROPOSAL_KIND } from "./useMySummons";

const mySeckey = generateSecretKey();
const myPubkey = getPublicKey(mySeckey);
const courtSeckey = generateSecretKey();
const courtPubkey = getPublicKey(courtSeckey);
const attackerSeckey = generateSecretKey();

let relayEvents: NostrEvent[] = [];

const toastMock = vi.fn();

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    user: {
      pubkey: getPublicKey(mySeckey),
      signer: {
        signEvent: async (event: {
          kind: number;
          created_at: number;
          tags: string[][];
          content: string;
        }) => finalizeEvent(event, mySeckey),
      },
    },
  }),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@nostrify/nostrify", () => ({
  NRelay1: class {
    constructor(_url: string) {}
    async query() {
      return relayEvents;
    }
    async *_req() {
      // no live events
    }
    req() {
      return this._req();
    }
    async close() {}
  },
}));

vi.mock("@/lib/baoFundraising", () => ({
  baoApiBase: () => "https://api.bao.test",
}));

const NOW = Math.floor(Date.now() / 1000);

function summons(
  caseId: string,
  createdAt: number,
  secret: Uint8Array,
): NostrEvent {
  return finalizeEvent(
    {
      kind: SUMMONS_PROPOSAL_KIND,
      created_at: createdAt,
      tags: [
        ["d", caseId],
        ["market", "market-1"],
        ["proposed", "YES"],
        ["p", myPubkey],
      ],
      content: "",
    },
    secret,
  ) as unknown as NostrEvent;
}

beforeEach(() => {
  localStorage.clear();
  toastMock.mockClear();
  relayEvents = [];
  vi.stubEnv("VITE_FUND_COURT_GROUP_PUBKEY", courtPubkey);
  vi.stubEnv("VITE_FUND_COURT_PROPOSAL_PUBKEY", courtPubkey);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("R36-S1 — a flood cannot evict the real summons", () => {
  it("keeps the court-attributed notice through 250 newer unattributed ones", async () => {
    const real = summons("REAL-CASE", NOW - 3_600, courtSeckey);
    const flood = Array.from({ length: 250 }, (_, i) =>
      summons(`FAKE-${i}`, NOW - 10 + i, attackerSeckey),
    );
    relayEvents = [real, ...flood];

    const { result } = renderHook(() => useMySummons());
    await waitFor(() => expect(result.current.summons.length).toBeGreaterThan(0));

    const caseIds = result.current.summons.map((n) => n.caseId);
    expect(caseIds).toContain("REAL-CASE");
    // The unread badge / prompt set must still contain it…
    expect(result.current.unseen.some((n) => n.caseId === "REAL-CASE")).toBe(true);
    expect(result.current.unreadCount).toBeGreaterThan(0);
    // …and the capped list is still bounded, attributed first.
    expect(result.current.summons.length).toBeLessThanOrEqual(200);
    expect(result.current.summons[0]!.caseId).toBe("REAL-CASE");
    expect(result.current.summons[0]!.attributed).toBe(true);
  });
});

describe("R36-S2 — the toast queue reserves room for the court", () => {
  it("shows the attributed summons first and caps unattributed toasts", async () => {
    // Flood arrives first (older), the real summons a moment later: a plain
    // first-come queue would already be full by then.
    const flood = Array.from({ length: 12 }, (_, i) =>
      summons(`FAKE-${i}`, NOW - 20 + i, attackerSeckey),
    );
    const real = summons("REAL-CASE", NOW - 5, courtSeckey);
    relayEvents = [...flood, real];

    const { result } = renderHook(() => useMySummons());
    await waitFor(() => expect(result.current.summons.length).toBe(13));
    await waitFor(() => expect(toastMock.mock.calls.length).toBeGreaterThan(0));

    const titles = toastMock.mock.calls.map(([arg]) => String(arg.title));
    const attributedToast = toastMock.mock.calls.findIndex(([arg]) =>
      !String(arg.title).includes("unverified publisher") && !String(arg.title).includes("more court notices"),
    );
    // Attribution is announced BEFORE the stranger notices.
    expect(attributedToast).toBe(0);
    // Total: at most 5 individual toasts + 1 aggregate line.
    expect(titles.filter((t) => !t.includes("more court notices")).length).toBeLessThanOrEqual(5);
    // The stream of stranger notices did not get a toast each.
    expect(titles.filter((t) => t.includes("unverified publisher")).length).toBeLessThanOrEqual(2);
    expect(titles.some((t) => t.includes("more court notices"))).toBe(true);
  });
});

describe("R36-S3 — toast bodies are display-guarded", () => {
  it("strips bidi controls from the case id and never splits a surrogate pair", async () => {
    // A hostile case id: RTL override + a case id long enough to be sliced.
    const hostileCase = "\u202E" + "😀".repeat(40);
    relayEvents = [summons(hostileCase, NOW - 30, attackerSeckey)];

    const { result } = renderHook(() => useMySummons());
    await waitFor(() => expect(result.current.summons).toHaveLength(1));
    await waitFor(() => expect(toastMock).toHaveBeenCalled());

    const toast = toastMock.mock.calls[0]![0] as { description: string };
    expect(toast.description).not.toContain("\u202E");
    // 16 code points of content (15 emoji + the ellipsis) plus the sentence.
    const casePart = toast.description.split(" — ")[0]!.replace("Case ", "");
    expect(Array.from(casePart).length).toBeLessThanOrEqual(17);
    // No lone surrogate (U+FFFD would appear if a pair were split).
    expect(casePart).not.toContain("\uFFFD");
  });
});
