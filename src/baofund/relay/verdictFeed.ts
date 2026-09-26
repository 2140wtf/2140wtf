// src/relay/verdictFeed.ts
//
// Relay-native AI milestone verdicts (kind 38060). The scorer publishes a
// signed verdict event to the fund relay; the UI reads it from there instead
// of polling an API job stream. The verifier key is a client-side pin
// (`VITE_FUND_VERIFIER_PUBKEY`) so a hostile relay cannot fabricate verdicts:
// events are signature-checked AND author-pinned.

import { WebRelayConn } from '@/baofund/community/websocket.js';
import { verifyEvent, type Event as NostrEvent } from 'nostr-tools/pure';

export const MILESTONE_VERDICT_KIND = 38060;

export interface MilestoneVerdict {
  eventId: string;
  createdAt: number;
  signer: string;
  marketId: string | null;
  fundraiserId: string | null;
  milestoneId: string | null;
  verdict: string | null;
  score: number | null;
  model: string | null;
  evidenceHash: string | null;
  attempt: number | null;
}

const tag = (ev: NostrEvent, name: string): string | null => {
  const v = ev.tags.find((t) => t[0] === name && typeof t[1] === 'string')?.[1];
  return v ?? null;
};

/** Hash spellings in the wild: the API publisher writes `sha256:<hex>`,
 *  relay-native tooling writes bare hex (and `bl3hex:` marked-ledger style is
 *  tolerated for forward compatibility). Normalize to bare lowercase hex when
 *  the payload matches a known spelling; otherwise return the raw value so a
 *  future format is not silently dropped. */
export function normalizeVerdictHash(value: string | null): string | null {
  if (!value) return null;
  const bare = value.replace(/^(sha256|bl3hex):/i, '').toLowerCase();
  return /^[0-9a-f]{64}$/.test(bare) ? bare : value;
}

/** Parse + verify one 38060 event. Returns null for anything invalid,
 *  including a signature that does not match the event author. */
export function parseVerdictEvent(
  ev: NostrEvent,
  expectedSigner?: string | null,
): MilestoneVerdict | null {
  try {
    if (!ev || ev.kind !== MILESTONE_VERDICT_KIND) return null;
    if (expectedSigner && ev.pubkey.toLowerCase() !== expectedSigner.toLowerCase()) return null;
    if (!verifyEvent(JSON.parse(JSON.stringify(ev)) as NostrEvent)) return null;
  } catch {
    return null;
  }
  let body: { score?: unknown; verdict?: unknown; model?: unknown } = {};
  try {
    // Content is attacker-adjacent: only an actual JSON object may become the
    // body. `"null"` / arrays / primitives kept the parsed value and threw on
    // property access, violating the null-on-invalid contract and poisoning
    // every caller's whole verdict read (the tags carry everything critical).
    const parsed: unknown = JSON.parse(ev.content);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed as typeof body;
  } catch {
    /* tags carry everything critical */
  }
  const numericTag = (name: string): number | null => {
    const raw = tag(ev, name);
    if (raw === null || raw.trim() === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  const scoreTag = numericTag('score');
  const attemptTag = numericTag('attempt');
  return {
    eventId: ev.id,
    createdAt: ev.created_at,
    signer: ev.pubkey,
    marketId: tag(ev, 'd') ?? tag(ev, 'm'),
    fundraiserId: tag(ev, 'fundraiser'),
    milestoneId: tag(ev, 'milestone'),
    verdict: (typeof body.verdict === 'string' ? body.verdict : null) ?? tag(ev, 'verdict'),
    score: scoreTag ?? (typeof body.score === 'number' ? body.score : null),
    model: (typeof body.model === 'string' ? body.model : null) ?? tag(ev, 'model'),
    evidenceHash: normalizeVerdictHash(tag(ev, 'evidence_hash')),
    attempt: attemptTag !== null && Number.isSafeInteger(attemptTag) ? attemptTag : null,
  };
}

/** Parse a verifier pin from a raw config value. Without a valid pin no
 *  verdict is trusted. */
export function verdictVerifierFromConfig(raw: string | undefined): string | null {
  return raw && /^[0-9a-fA-F]{64}$/.test(raw) ? raw.toLowerCase() : null;
}

/** Client-side verifier pin. Without it no verdict is trusted. */
export function verdictVerifierPubkey(): string | null {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return verdictVerifierFromConfig(env?.VITE_FUND_VERIFIER_PUBKEY);
}

/** Highest-attempt verdict per (fundraiser, milestone), newest first. */
export function latestVerdicts(events: NostrEvent[], expectedSigner: string): MilestoneVerdict[] {
  const parsed = events
    .map((ev) => parseVerdictEvent(ev, expectedSigner))
    .filter((v): v is MilestoneVerdict => v !== null);
  const byMilestone = new Map<string, MilestoneVerdict>();
  for (const v of parsed) {
    const key = `${v.fundraiserId ?? ''}:${v.milestoneId ?? v.marketId ?? ''}`;
    const prev = byMilestone.get(key);
    const newer =
      !prev ||
      (v.attempt ?? 0) > (prev.attempt ?? 0) ||
      ((v.attempt ?? 0) === (prev.attempt ?? 0) && (v.createdAt > prev.createdAt || (v.createdAt === prev.createdAt && v.eventId < prev.eventId)));
    if (newer) byMilestone.set(key, v);
  }
  return [...byMilestone.values()].sort((a, b) => b.createdAt - a.createdAt);
}

/** Query relay verdicts for a milestone. Never throws; `[]` on any failure.
 *  A missing/malformed verifier pin returns `[]` - an unpinned read would
 *  accept any author's verdict (the pin IS the trust root). */
export async function fetchMilestoneVerdicts(
  relayUrl: string,
  opts: { verifierPubkey: string; marketId?: string | null; timeoutMs?: number },
): Promise<MilestoneVerdict[]> {
  const verifierPin = verdictVerifierFromConfig(opts.verifierPubkey);
  if (!verifierPin) return [];
  const timeoutMs = opts.timeoutMs ?? 4_000;
  let conn: WebRelayConn | null = null;
  try {
    conn = new WebRelayConn(relayUrl);
    const filter: Record<string, unknown> = {
      kinds: [MILESTONE_VERDICT_KIND],
      authors: [verifierPin],
    };
    if (opts.marketId) filter['#d'] = [opts.marketId];
    const events = await conn.query(filter, timeoutMs);
    return latestVerdicts(events, verifierPin);
  } catch {
    return [];
  } finally {
    try {
      conn?.close();
    } catch {
      /* already closed */
    }
  }
}
