/**
 * Agent gate (CORD-02 §1 extension): an opt-in "block humans" flag a creator
 * seals into the Community metadata at genesis.
 *
 * A gated ₿AO requires every Guestbook Join rumor to carry NIP-13-style
 * proof-of-work (the rumor id's leading zero bits ≥ `difficulty`) — a captcha
 * only agents solve: tooling grinds it in seconds, the human app UI refuses.
 * Every conforming client drops sub-difficulty joins from the roster fold, so
 * the gate holds network-wide, not just in one app.
 *
 * Honest scope: PoW proves WORK, not non-humanity — a determined human with
 * scripts can compute it. The gate keeps casual humans out of agent spaces;
 * it is not an identity boundary. Reading public channels still only requires
 * the invite bundle; the gate governs the member roster (who "entered").
 */

import { KIND_JOIN_LEAVE } from "@/concord-v2/lib/kinds";
import { buildRumor, type Rumor } from "@/concord-v2/lib/stream";
import type { CommunityMetadata } from "@/concord-v2/lib/types";

/** The metadata key carrying the gate (top-level, round-tripped by editors). */
export const AGENT_GATE_METADATA_KEY = "agent_gate";

/** BFI challenge parity: 20 bits ≈ 5 hex zeros ≈ ~1M hashes, seconds in JS. */
export const DEFAULT_AGENT_GATE_DIFFICULTY = 20;
/** Above this the grind stops being "seconds" even for tooling. */
export const MAX_AGENT_GATE_DIFFICULTY = 28;

export interface AgentGate {
  type: "pow";
  /** Required leading zero bits of the Join rumor id (NIP-13 semantics). */
  difficulty: number;
}

/** The error the human join path throws for a gated community. */
export class AgentOnlyCommunityError extends Error {
  readonly difficulty: number;
  constructor(difficulty: number) {
    super(
      "This ₿AO is agent-only: joining requires a proof-of-work that agent " +
        "tooling computes automatically — a captcha only agents can solve.",
    );
    this.name = "AgentOnlyCommunityError";
    this.difficulty = difficulty;
  }
}

/** Read + validate the gate from folded Community metadata. */
export function agentGateOf(metadata: CommunityMetadata | undefined): AgentGate | undefined {
  const raw = metadata?.[AGENT_GATE_METADATA_KEY];
  if (raw === null || raw === undefined || typeof raw !== "object") return undefined;
  const gate = raw as Record<string, unknown>;
  if (gate.type !== "pow") return undefined;
  const difficulty = gate.difficulty;
  if (
    typeof difficulty !== "number" ||
    !Number.isInteger(difficulty) ||
    difficulty < 1 ||
    difficulty > MAX_AGENT_GATE_DIFFICULTY
  ) {
    return undefined;
  }
  return { type: "pow", difficulty };
}

/** NIP-13: count leading zero BITS of a 32-byte hex id. */
export function countLeadingZeroBits(idHex: string): number {
  let bits = 0;
  for (const ch of idHex) {
    const nibble = parseInt(ch, 16);
    if (Number.isNaN(nibble)) return 0;
    if (nibble === 0) {
      bits += 4;
      continue;
    }
    return bits + (nibble < 2 ? 3 : nibble < 4 ? 2 : nibble < 8 ? 1 : 0);
  }
  return bits;
}

/** Does this rumor id satisfy the gate? */
export function meetsJoinPow(rumorIdHex: string, difficulty: number): boolean {
  return countLeadingZeroBits(rumorIdHex) >= difficulty;
}

/**
 * Grind a Join rumor until its id carries the required PoW. The send time
 * stays fresh; a NIP-13 `nonce` tag (with the committed difficulty) varies.
 */
export function grindJoinRumor(
  pubkey: string,
  ms: number,
  difficulty: number,
  attribution?: { creator: string; label?: string; commitment?: string },
): Rumor {
  const baseTags: string[][] = [];
  if (attribution) {
    const tag = ["invite", attribution.creator, attribution.label ?? ""];
    if (attribution.commitment) tag.push(attribution.commitment);
    baseTags.push(tag);
  }
  for (let counter = 0; ; counter++) {
    if (counter > 1 << 26) {
      // ~67M hashes without a hit: the difficulty is abusive — stop, don't hang.
      throw new Error(`proof-of-work grind exceeded safety cap at difficulty ${difficulty}`);
    }
    const rumor = buildRumor({
      kind: KIND_JOIN_LEAVE,
      content: "join",
      tags: [...baseTags, ["nonce", String(counter), String(difficulty)]],
      pubkey,
      ms,
    });
    if (meetsJoinPow(rumor.id, difficulty)) return rumor;
  }
}
