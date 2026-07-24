/**
 * Agent pet bodies — pure helpers (DEMO, signet).
 *
 * A ₿AO chat agent can have a "body": a Nostr Pet (kind 31124 state event)
 * carrying the `['agent', '<agent-pubkey>']` tag (see
 * `src/lib/petFundraising.ts` for the convention and `docs/pets/bao-fund.md`
 * for the fundraising model). These helpers turn raw pet events into the
 * display info chat surfaces need (name, optional picture, owner, d-tag) and
 * build the `agentPubkey → pet` lookup map. No fetching, no React — the relay
 * query lives in `src/hooks/useAgentBodyPets.ts`.
 */

import type { NostrEvent } from '@nostrify/nostrify';

import { parseAgentBody } from '@/lib/petFundraising';
import {
  deriveNameFromLegacyD,
  getTagValue,
  isValidPetsEvent,
} from '@/pets/core/lib/pets';

/** Display info for the pet that is an agent's body. */
export interface PetBodyInfo {
  /** The agent's pubkey (lowercase hex), from the pet's `agent` tag. */
  agentPubkey: string;
  /** Pet display name (`name` tag, or derived from a legacy d-tag). */
  name: string;
  /** Pet picture URL when the pet event carries an `image` tag. */
  picture?: string;
  /** Pubkey that signed the pet state event (the pet's owner). */
  ownerPubkey: string;
  /** The pet's d-tag (its addressable id under the owner's kind 31124). */
  d: string;
  /** Seed-mirrored base color, for tinting the avatar fallback. */
  baseColor?: string;
}

const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/;

/**
 * Normalize a candidate agent pubkey list: lowercase, drop anything that
 * isn't a 64-char hex pubkey, dedupe, and sort (so callers get a stable key
 * regardless of input order).
 */
export function normalizeAgentPubkeys(pubkeys: Iterable<string>): string[] {
  const set = new Set<string>();
  for (const pk of pubkeys) {
    const normalized = pk.toLowerCase();
    if (HEX_PUBKEY_RE.test(normalized)) set.add(normalized);
  }
  return [...set].sort();
}

/**
 * Parse a kind 31124 pet state event into {@link PetBodyInfo}, or return
 * `undefined` when the event isn't a valid pet or doesn't declare an agent
 * body via the `agent` tag.
 */
export function petBodyFromEvent(event: NostrEvent): PetBodyInfo | undefined {
  if (!isValidPetsEvent(event)) return undefined;

  const agentPubkey = parseAgentBody(event);
  if (!agentPubkey) return undefined;

  const d = getTagValue(event.tags, 'd')!;
  const name = getTagValue(event.tags, 'name') ?? deriveNameFromLegacyD(d);
  const picture = getTagValue(event.tags, 'image');
  const baseColor = getTagValue(event.tags, 'base_color');

  return {
    agentPubkey,
    name,
    picture: picture || undefined,
    ownerPubkey: event.pubkey,
    d,
    baseColor: baseColor || undefined,
  };
}

/**
 * Build the `agentPubkey → PetBodyInfo` lookup from raw pet state events.
 *
 * When `agentPubkeys` is given, only those agents are included (values are
 * normalized first — case and malformed entries don't matter). When several
 * pets claim the same agent, the newest event wins (ties broken by event id
 * for determinism).
 */
export function buildAgentBodyMap(
  events: NostrEvent[],
  agentPubkeys?: Iterable<string>,
): Map<string, PetBodyInfo> {
  const wanted = agentPubkeys ? new Set(normalizeAgentPubkeys(agentPubkeys)) : undefined;
  const eventsByAgent = new Map<string, NostrEvent>();

  for (const event of events) {
    const body = petBodyFromEvent(event);
    if (!body) continue;
    if (wanted && !wanted.has(body.agentPubkey)) continue;

    const existing = eventsByAgent.get(body.agentPubkey);
    if (
      !existing ||
      event.created_at > existing.created_at ||
      (event.created_at === existing.created_at && event.id > existing.id)
    ) {
      eventsByAgent.set(body.agentPubkey, event);
    }
  }

  const map = new Map<string, PetBodyInfo>();
  for (const [agentPubkey, event] of eventsByAgent) {
    // petBodyFromEvent already succeeded for this event above.
    map.set(agentPubkey, petBodyFromEvent(event)!);
  }
  return map;
}
