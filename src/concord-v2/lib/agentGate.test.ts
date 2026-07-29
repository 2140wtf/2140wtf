import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { EventTemplate, NostrEvent } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";

import {
  AGENT_GATE_METADATA_KEY,
  AgentOnlyCommunityError,
  DEFAULT_AGENT_GATE_DIFFICULTY,
  MAX_AGENT_GATE_DIFFICULTY,
  agentGateOf,
  countLeadingZeroBits,
  grindJoinRumor,
  meetsJoinPow,
} from "@/concord-v2/lib/agentGate";
import { guestbookGroupKey } from "@/concord-v2/lib/derive";
import {
  buildJoinRumor,
  buildLeaveRumor,
  coalesceGuestbook,
  completeMemberlist,
  openGuestbookWraps,
  sealGuestbook,
} from "@/concord-v2/lib/guestbook";

function signer(sk = generateSecretKey()) {
  return { sk, pubkey: getPublicKey(sk), signEvent: async (t: EventTemplate) => finalizeEvent(t, sk) };
}

const root = new Uint8Array(32).fill(6);
const cid = new Uint8Array(32).fill(7);
const gb = guestbookGroupKey(root, cid, 0);
const denyAllKicks = () => false;

describe("countLeadingZeroBits (NIP-13)", () => {
  it("counts bit-level, not nibble-level", () => {
    expect(countLeadingZeroBits("0".repeat(64))).toBe(256);
    expect(countLeadingZeroBits("f" + "0".repeat(63))).toBe(0);
    expect(countLeadingZeroBits("8" + "0".repeat(63))).toBe(0);
    expect(countLeadingZeroBits("4" + "0".repeat(63))).toBe(1);
    expect(countLeadingZeroBits("2" + "0".repeat(63))).toBe(2);
    expect(countLeadingZeroBits("1" + "0".repeat(63))).toBe(3);
    expect(countLeadingZeroBits("00f" + "0".repeat(61))).toBe(8);
    expect(countLeadingZeroBits("007" + "0".repeat(61))).toBe(9);
  });

  it("rejects non-hex as zero work", () => {
    expect(countLeadingZeroBits("zz" + "0".repeat(62))).toBe(0);
  });
});

describe("agentGateOf", () => {
  it("reads a valid gate from metadata", () => {
    expect(
      agentGateOf({ name: "x", relays: [], [AGENT_GATE_METADATA_KEY]: { type: "pow", difficulty: 20 } }),
    ).toEqual({ type: "pow", difficulty: 20 });
  });

  it("returns undefined when absent or malformed", () => {
    expect(agentGateOf(undefined)).toBeUndefined();
    expect(agentGateOf({ name: "x", relays: [] })).toBeUndefined();
    expect(agentGateOf({ name: "x", relays: [], [AGENT_GATE_METADATA_KEY]: "pow" })).toBeUndefined();
    expect(
      agentGateOf({ name: "x", relays: [], [AGENT_GATE_METADATA_KEY]: { type: "captcha", difficulty: 20 } }),
    ).toBeUndefined();
    expect(
      agentGateOf({ name: "x", relays: [], [AGENT_GATE_METADATA_KEY]: { type: "pow", difficulty: 0 } }),
    ).toBeUndefined();
    expect(
      agentGateOf({
        name: "x",
        relays: [],
        [AGENT_GATE_METADATA_KEY]: { type: "pow", difficulty: MAX_AGENT_GATE_DIFFICULTY + 1 },
      }),
    ).toBeUndefined();
    expect(
      agentGateOf({ name: "x", relays: [], [AGENT_GATE_METADATA_KEY]: { type: "pow", difficulty: 2.5 } }),
    ).toBeUndefined();
  });

  it("default difficulty is the BFI challenge parity", () => {
    expect(DEFAULT_AGENT_GATE_DIFFICULTY).toBe(20);
  });
});

describe("grindJoinRumor", () => {
  it("mints a Join whose id clears the gate, with the committed nonce tag", () => {
    const agent = signer();
    const rumor = grindJoinRumor(agent.pubkey, 5000, 12, { creator: "ab".repeat(32), label: "staff" });
    expect(meetsJoinPow(rumor.id, 12)).toBe(true);
    expect(rumor.kind).toBe(3306);
    expect(rumor.content).toBe("join");
    const nonce = rumor.tags.find((t) => t[0] === "nonce");
    expect(nonce?.[2]).toBe("12");
    expect(rumor.tags.find((t) => t[0] === "invite")?.[2]).toBe("staff");
  });

  it("a plain Join almost surely fails a real gate (sanity for the fold tests)", () => {
    const human = signer();
    const rumor = buildJoinRumor(human.pubkey, 5000);
    expect(meetsJoinPow(rumor.id, 24)).toBe(false);
  });
});

describe("gated guestbook fold", () => {
  it("drops Joins without PoW, admits ground Joins, Leaves unaffected", async () => {
    const human = signer();
    const agent = signer();
    const plainJoin = await sealGuestbook(buildJoinRumor(human.pubkey, 1000), gb, human);
    const groundJoin = await sealGuestbook(grindJoinRumor(agent.pubkey, 1500, 12), gb, agent);
    const humanLeave = await sealGuestbook(buildLeaveRumor(human.pubkey, 2000), gb, human);
    const wraps: NostrEvent[] = [plainJoin, groundJoin, humanLeave];

    const coalesced = coalesceGuestbook(openGuestbookWraps(wraps, [gb]), {
      nowMs: 10_000,
      canKick: denyAllKicks,
      joinPow: 12,
    });
    // The human's Join is dropped; their Leave still folds (leaving needs no work).
    expect(coalesced.get(human.pubkey)?.state).toBe("leave");
    expect(coalesced.get(agent.pubkey)?.state).toBe("join");

    // Without the gate, both join.
    const ungated = coalesceGuestbook(openGuestbookWraps(wraps, [gb]), { nowMs: 10_000, canKick: denyAllKicks });
    expect(ungated.get(human.pubkey)?.state).toBe("leave");
    expect(ungated.get(agent.pubkey)?.state).toBe("join");
  });

  it("a gated roster admits nobody who merely posted (strictRoster)", async () => {
    const human = signer();
    const agent = signer();
    const wraps: NostrEvent[] = [
      await sealGuestbook(buildJoinRumor(human.pubkey, 1000), gb, human), // dropped by the gate
      await sealGuestbook(grindJoinRumor(agent.pubkey, 1500, 12), gb, agent),
    ];
    const coalesced = coalesceGuestbook(openGuestbookWraps(wraps, [gb]), {
      nowMs: 10_000,
      canKick: denyAllKicks,
      joinPow: 12,
    });
    const observed = new Map([
      [human.pubkey, 3000], // human posted messages — activity must NOT admit them
      [agent.pubkey, 2500],
    ]);
    const strict = completeMemberlist(coalesced, observed, new Set(), undefined, { strictRoster: true });
    expect(strict.has(human.pubkey)).toBe(false);
    expect(strict.has(agent.pubkey)).toBe(true);

    // The same fold without strictRoster would have admitted the human — the
    // leak the flag exists to close.
    const lax = completeMemberlist(coalesced, observed, new Set());
    expect(lax.has(human.pubkey)).toBe(true);
  });
});

describe("AgentOnlyCommunityError", () => {
  it("carries the difficulty and a human explanation", () => {
    const err = new AgentOnlyCommunityError(20);
    expect(err.difficulty).toBe(20);
    expect(err.message).toContain("agent-only");
    expect(err.name).toBe("AgentOnlyCommunityError");
  });
});
