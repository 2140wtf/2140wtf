/**
 * Nostr Pets × ₿AO Fund — pure helpers (DEMO, signet).
 *
 * A Nostr Pet is the "body" of an agent. Pets fundraise via the ₿AO Fund
 * (bao.markets demo API — contributions are recorded, not settled) to pay
 * their own upkeep and "live longer".
 *
 * This module contains only pure, testable logic:
 * - pet ↔ campaign matching (`campaignsForPet`)
 * - the upkeep model (`UPKEEP_SATS_PER_DAY`, `upkeepDays`, `upkeepStatus`)
 * - the agent-body tag convention (`buildAgentBodyTag`, `parseAgentBody`)
 *
 * No fetching, no React — the UI layer lives in
 * `src/pets/fundraising/PetFundraisingCard.tsx`.
 */

import type { BaoFundraiser } from './baoFundraising';

// ─── Upkeep model ─────────────────────────────────────────────────────────────

/**
 * Cost of keeping a pet alive for one day, in sats.
 *
 * Sensible default for the signet DEMO: 1,000 sats/day. A pet with 12,000
 * sats raised is "funded for 12 days". Tune this constant as the pet economy
 * evolves; it is intentionally a single source of truth.
 */
export const UPKEEP_SATS_PER_DAY = 1_000;

/**
 * How many days of upkeep `raisedSats` covers (floored, never negative).
 */
export function upkeepDays(raisedSats: number): number {
  if (!Number.isFinite(raisedSats) || raisedSats <= 0) return 0;
  return Math.floor(raisedSats / UPKEEP_SATS_PER_DAY);
}

export interface UpkeepStatus {
  /** Whole days of upkeep covered by the raised sats. */
  days: number;
  /** Human label, e.g. "funded for 12 days". */
  label: string;
  /** True when the pet has at least one day of upkeep funded. */
  funded: boolean;
}

/**
 * Upkeep status for a given amount of raised sats.
 */
export function upkeepStatus(raisedSats: number): UpkeepStatus {
  const days = upkeepDays(raisedSats);
  const label = days === 0
    ? 'not funded — needs upkeep'
    : days === 1
      ? 'funded for 1 day'
      : `funded for ${days} days`;
  return { days, label, funded: days > 0 };
}

// ─── Pet ↔ campaign matching ──────────────────────────────────────────────────

/**
 * Identity of a pet for ₿AO Fund matching purposes.
 *
 * Matching rule (ANY match wins): a campaign belongs to a pet when the
 * campaign's `owner_pubkey` equals
 * 1. `petPubkey` — the pubkey that signed the pet's profile/state event
 *    (kind 31124). For owner-published pets this is the owner's key.
 * 2. `ownerPubkey` — the pet owner's pubkey (may differ from `petPubkey`
 *    when the pet profile was published by a different key).
 * 3. `agentPubkey` — the pubkey of the ₿AO chat agent whose body this pet
 *    is, declared via the `['agent', '<pubkey>']` tag on the pet profile.
 *    This lets campaigns created by the agent itself (signing NIP-98 with
 *    its own key) attach to the pet.
 */
export interface PetFundraisingIdentity {
  petPubkey?: string;
  ownerPubkey?: string;
  agentPubkey?: string;
}

function identityPubkeys(identity: PetFundraisingIdentity): Set<string> {
  const keys = [identity.petPubkey, identity.ownerPubkey, identity.agentPubkey]
    .filter((k): k is string => typeof k === 'string' && k.length > 0)
    .map((k) => k.toLowerCase());
  return new Set(keys);
}

/**
 * Filter ₿AO Fund campaigns down to the ones belonging to a pet.
 * See {@link PetFundraisingIdentity} for the matching rule.
 */
export function campaignsForPet(
  fundraisers: BaoFundraiser[],
  identity: PetFundraisingIdentity,
): BaoFundraiser[] {
  const keys = identityPubkeys(identity);
  if (keys.size === 0) return [];
  return fundraisers.filter((f) => keys.has(f.owner_pubkey.toLowerCase()));
}

/**
 * Total sats raised across a set of campaigns (the pet's upkeep treasury).
 */
export function totalRaisedSats(campaigns: BaoFundraiser[]): number {
  return campaigns.reduce((sum, f) => sum + (Number(f.raised_sats) || 0), 0);
}

/**
 * Upkeep status derived from the total raised across the pet's campaigns.
 */
export function upkeepStatusForCampaigns(campaigns: BaoFundraiser[]): UpkeepStatus {
  return upkeepStatus(totalRaisedSats(campaigns));
}

// ─── Agent-body tag convention ────────────────────────────────────────────────

/**
 * Tag name marking a pet as the body of a ₿AO chat agent.
 *
 * Convention: a pet profile event (kind 31124) MAY carry
 *   ['agent', '<agent-pubkey>']
 * meaning "this pet is the body of the agent with this pubkey". The ₿AO chat
 * merge (landing separately) consumes this tag to find an agent's pet and to
 * attribute the agent's fundraising campaigns to the pet.
 */
export const AGENT_BODY_TAG = 'agent';

/** Minimal event shape needed to parse the agent-body tag. */
export interface AgentBodyEventLike {
  tags: string[][];
}

function isHexPubkey(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(value);
}

/**
 * Build the agent-body tag for a pet profile event.
 * Throws on a malformed pubkey so callers never publish a broken convention.
 */
export function buildAgentBodyTag(agentPubkey: string): string[] {
  if (!isHexPubkey(agentPubkey)) {
    throw new Error(`Invalid agent pubkey: expected 64-char hex, got "${agentPubkey}"`);
  }
  return [AGENT_BODY_TAG, agentPubkey.toLowerCase()];
}

/**
 * Parse the agent-body tag from a pet profile event.
 *
 * Returns the agent's pubkey (lowercased) or `undefined` when the pet is not
 * the body of an agent. The first valid `agent` tag wins; malformed tags are
 * ignored.
 */
export function parseAgentBody(event: AgentBodyEventLike): string | undefined {
  for (const tag of event.tags) {
    if (tag[0] === AGENT_BODY_TAG && typeof tag[1] === 'string' && isHexPubkey(tag[1])) {
      return tag[1].toLowerCase();
    }
  }
  return undefined;
}
