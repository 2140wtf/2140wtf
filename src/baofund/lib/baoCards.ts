/**
 * baoCards - kind-39801 fundraiser cards + the G4 discovery feed (Concord C1).
 *
 * Spec: docs/bao-normative-spec-v0.md §2 (kind registry) + design doc §6
 * (event schema). Sprint item C1 (§44.3/§45): "card publishable and readable
 * headless; typed errors on all negative paths."
 *
 * Shapes (design doc §6, adopted verbatim):
 *   - 39801: creator-signed, addressable `d=<slug>`, parameterized-
 *     *replaceable* - relays serve only the newest event per (pubkey, d).
 *     Content = versioned JSON (`v: 1`) incl. `attestation` tier +
 *     `agentHints` (G3 machine-actionable contract).
 *   - 39803: registrar status updates, append-only `d=<slug>:<milestone>:<seq>`,
 *     content carries the FULL 39801 a-coordinate (never a bare slug).
 *   - Discovery (G4): canonical agent filter `{ kinds: [39801, 39803], '#t': [topic] }`.
 *
 * Everything here is pure except `subscribeFundFeed`, which adapts any
 * `{ subscribe(filter, cb): () => void }` connection (WebRelayConn matches)
 * so the fold stays unit-testable without a relay.
 */
import { verifyEvent, type Event } from 'nostr-tools';

export const FUNDRAISER_CARD_KIND = 39801;
export const MILESTONE_STATUS_KIND = 39803;
export const MAX_FEED_CARDS = 1000;
export const MAX_FEED_STATUSES = 2000;

export type CardFormat = 'milestones' | 'stream';
export type CardAttestation = 'human-court' | 'agent-verified' | 'none';
export type CardRail = 'cashu' | 'lightning' | 'l1' | 'liquid';
export type ContributeFrom = 'nostr-only' | 'browser' | 'mcp';

/** Full NIP-01 a-coordinate - the only form allowed to reference a card. */
export function fundraiserACoord(creatorPubkey: string, slug: string): string {
  if (!/^[0-9a-f]{64}$/i.test(creatorPubkey)) {
    throw new CardSchemaError(
      `creatorPubkey must be a 64-hex pubkey, got ${JSON.stringify(creatorPubkey)}`,
      'creatorPubkey',
    );
  }
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(slug)) {
    throw new CardSchemaError(`slug must be 1-64 [a-z0-9-], got ${JSON.stringify(slug)}`, 'slug');
  }
  return `${FUNDRAISER_CARD_KIND}:${creatorPubkey.toLowerCase()}:${slug}`;
}

const A_COORD_RE = /^39801:[0-9a-f]{64}:[a-z0-9][a-z0-9-]{0,63}$/i;
/** Strict a-coordinate check for inbound references (39803 → 39801). */
export const isFundraiserACoord = (v: unknown): v is string => typeof v === 'string' && A_COORD_RE.test(v);

export interface CardMilestone {
  id: string;
  title: string;
  /** Integer sats - floats are a typed error (agentHints.amountUnit: 'sats'). */
  amount: number;
  status: 'locked' | 'unlocked' | 'released' | 'refunded';
}

export interface AgentHints {
  amountUnit: 'sats';
  canContributeFrom: ContributeFrom[];
  /** Client-supplied dedup key name (design doc §6 G3). */
  idempotency: string;
}

export interface FundraiserCardContentV1 {
  v: 1;
  title: string;
  summary: string;
  format: CardFormat;
  rails: CardRail[];
  milestones: CardMilestone[];
  attestation: CardAttestation;
  /** Authoritative write path (REST) - https only. */
  api: string;
  agentHints: AgentHints;
}

const RAILS: readonly CardRail[] = ['cashu', 'lightning', 'l1', 'liquid'];

export function normalizeCardRail(rail: unknown): CardRail | null {
  if (typeof rail !== 'string') return null;
  return (RAILS as readonly string[]).includes(rail) ? (rail as CardRail) : null;
}
const SOURCES: readonly ContributeFrom[] = ['nostr-only', 'browser', 'mcp'];
export const MILESTONE_STATUSES: readonly CardMilestone['status'][] = ['locked', 'unlocked', 'released', 'refunded'];

export class CardSchemaError extends Error {
  constructor(
    message: string,
    public readonly field: string,
  ) {
    super(message);
    this.name = 'CardSchemaError';
  }
}

const requireInt = (field: string, value: unknown): number => {
  if (typeof value !== 'number' || typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new CardSchemaError(`${field} must be a non-negative integer (sats), got ${JSON.stringify(value)}`, field);
  }
  return value;
};

/** Build + validate card content. Throws CardSchemaError on any negative path. */
export function buildFundraiserCardContent(input: {
  title: string;
  summary: string;
  format: CardFormat;
  rails: CardRail[];
  milestones?: CardMilestone[];
  attestation: CardAttestation;
  api: string;
  agentHints: AgentHints;
}): FundraiserCardContentV1 {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CardSchemaError('card must be an object', 'content');
  if (typeof input.title !== 'string' || !input.title.trim()) {
    throw new CardSchemaError('title is required', 'title');
  }
  if (typeof input.summary !== 'string' || !input.summary.trim()) {
    throw new CardSchemaError('summary is required', 'summary');
  }
  if (input.format !== 'milestones' && input.format !== 'stream') {
    throw new CardSchemaError(`format must be 'milestones' | 'stream', got ${JSON.stringify(input.format)}`, 'format');
  }
  if (!Array.isArray(input.rails) || input.rails.length === 0 || input.rails.some((r) => !normalizeCardRail(r))) {
    throw new CardSchemaError(`rails must be a non-empty subset of ${RAILS.join('|')}`, 'rails');
  }
  if (!['human-court', 'agent-verified', 'none'].includes(input.attestation)) throw new CardSchemaError('invalid attestation', 'attestation');
  const milestones = input.milestones ?? [];
  if (!Array.isArray(milestones)) throw new CardSchemaError('milestones must be an array', 'milestones');
  const ids = new Set<string>();
  for (const m of milestones) {
    if (!m || typeof m.id !== 'string' || !m.id.trim() || typeof m.title !== 'string' || !m.title.trim() || ids.has(m.id)) {
      throw new CardSchemaError('milestones require distinct IDs and nonempty titles', 'milestones');
    }
    ids.add(m.id);
    requireInt(`milestones[${m.id}].amount`, m.amount);
    if (!MILESTONE_STATUSES.includes(m.status)) {
      throw new CardSchemaError(`milestone ${m.id}: status ${JSON.stringify(m.status)} invalid`, 'milestones');
    }
  }
  if (!input.agentHints || input.agentHints.amountUnit !== 'sats' || typeof input.agentHints.idempotency !== 'string' || !input.agentHints.idempotency.trim()) {
    throw new CardSchemaError('agentHints requires sats and a nonempty idempotency key', 'agentHints');
  }
  if (!Array.isArray(input.agentHints.canContributeFrom) || !SOURCES.includes(input.agentHints.canContributeFrom[0])) {
    throw new CardSchemaError('agentHints.canContributeFrom must start with a known source', 'agentHints.canContributeFrom');
  }
  for (const s of input.agentHints.canContributeFrom) {
    if (!SOURCES.includes(s)) {
      throw new CardSchemaError(`agentHints.canContributeFrom: unknown source ${JSON.stringify(s)}`, 'agentHints.canContributeFrom');
    }
  }
  let api: URL;
  try {
    api = new URL(input.api);
  } catch {
    throw new CardSchemaError(`api must be an absolute URL, got ${JSON.stringify(input.api)}`, 'api');
  }
  if (api.protocol !== 'https:' || api.username || api.password || api.hash) {
    throw new CardSchemaError('api must be https', 'api');
  }
  return {
    v: 1,
    title: input.title,
    summary: input.summary,
    format: input.format,
    rails: input.rails.map((r) => normalizeCardRail(r) as CardRail),
    milestones: milestones.map((m) => ({ ...m })),
    attestation: input.attestation,
    api: input.api,
    agentHints: {
      amountUnit: 'sats',
      canContributeFrom: [...input.agentHints.canContributeFrom],
      idempotency: input.agentHints.idempotency,
    },
  };
}

/** Card tags per design doc §6: d, title, summary, t, alt (+ relay hints). */
export function cardTags(card: {
  slug: string;
  title: string;
  summary: string;
  topics?: string[];
  image?: string;
}): string[][] {
  const tags: string[][] = [
    ['d', card.slug],
    ['title', card.title],
    ['summary', card.summary],
    ['alt', '₿AO Fund fundraiser card'],
  ];
  for (const t of card.topics ?? []) if (t.trim()) tags.push(['t', t.trim()]);
  if (card.image) tags.push(['image', card.image]);
  return tags;
}

/**
 * Publish a kind-39801 card, creator-signed, to an explicit public relay. Returns
 * the event id and the full a-coordinate others must use to reference it.
 */
export async function publishFundraiserCard(
  publish: (t: { kind: number; content: string; tags: string[][]; relay?: string }) => Promise<{ id: string }>,
  card: {
    /** 64-hex creator pubkey (the key that signs the publish). */
    creatorPubkey: string;
    slug: string;
    content: FundraiserCardContentV1;
    tags: string[][];
    /** Explicit public discovery relay; never defaults to the private chat relay. */
    relay: string;
  },
): Promise<{ id: string; aCoord: string }> {
  const aCoord = fundraiserACoord(card.creatorPubkey, card.slug);
  let relay: URL;
  try { relay = new URL(card.relay); } catch { throw new CardSchemaError('explicit public relay required', 'relay'); }
  if (!['ws:', 'wss:'].includes(relay.protocol) || relay.username || relay.password || relay.hash) throw new CardSchemaError('invalid public relay', 'relay');
  const ds = card.tags.filter(t => t[0] === 'd');
  if (ds.length !== 1 || ds[0][1] !== card.slug) throw new CardSchemaError('d tag must match slug exactly', 'tags');
  const content = parseCardContent(JSON.stringify(card.content));
  if (!content) throw new CardSchemaError('invalid card content', 'content');
  const r = await publish({
    kind: FUNDRAISER_CARD_KIND,
    content: JSON.stringify(content),
    tags: card.tags,
    relay: card.relay,
  });
  return { id: r.id, aCoord };
}

// ─── Feed fold (pure) ──────────────────────────────────────────────────────

export type FundraiserCardEvent = Event;
export type MilestoneStatusEvent = Event;

/** Caller-owned authorization pins, obtained outside the untrusted feed.
 * Missing pins deny status events. This does not verify ledger eligibility. */
export interface FeedAuthority {
  registrarPins: ReadonlyMap<string, ReadonlySet<string>>;
}

export interface MilestoneStatusEntry {
  d: string;
  milestone: string;
  signer: string;
  ledgerHead: string | null;
  /** A signed assertion is not a checked ledger or release decision. */
  ledgerVerified: false;
  seq: number;
  status: string;
  totals?: { totalRaised?: number; supporterCount?: number | null; anonymousSats?: number | null };
  eventId: string;
}

export interface FundFeedFoldState {
  /** Latest card per full a-coordinate (replaceable semantics). */
  cards: Map<string, { aCoord: string; eventId: string; createdAt: number; content: FundraiserCardContentV1 }>;
  /** Append-only 39803s per fundraiser a-coordinate, sorted by seq. */
  milestoneStatuses: Map<string, MilestoneStatusEntry[]>;
  invalid: number;
}

export const emptyFundFeedFoldState = (): FundFeedFoldState => ({
  cards: new Map(),
  milestoneStatuses: new Map(),
  invalid: 0,
});

function tagValue(tags: string[][], name: string): string | undefined {
  return tags.find((t) => t[0] === name)?.[1];
}

/** Parse card content defensively - invalid events never throw, they count. */
function parseCardContent(raw: string): FundraiserCardContentV1 | null {
  try {
    const c = JSON.parse(raw) as FundraiserCardContentV1;
    if (c?.v !== 1) return null;
    if (!Array.isArray(c.milestones)) return null;
    return buildFundraiserCardContent(c);
  } catch {
    return null;
  }
}

/**
 * Fold one relay event into the feed state. 39801 uses *replaceable*
 * semantics (latest created_at per a-coord wins; equal created_at breaks
 * ties by event id so folds are order-independent). 39803 is append-only:
 * deduped by event id, keyed by the fundraiser a-coordinate in content.
 */
export function foldFundFeedEvent(state: FundFeedFoldState, ev: FundraiserCardEvent | MilestoneStatusEvent, kind: number, authority?: FeedAuthority): FundFeedFoldState {
  const next: FundFeedFoldState = { cards: state.cards, milestoneStatuses: state.milestoneStatuses, invalid: state.invalid };

  // Clone via JSON to avoid the verifier's cached-symbol fast path on a mutable
  // event. Validate the exact signed content before parsing or projecting it.
  try {
    if (!ev || typeof ev.content !== 'string' || ev.content.length > 65_536 || !Array.isArray(ev.tags) || ev.tags.length > 128) throw new Error();
    ev = JSON.parse(JSON.stringify(ev)) as Event;
    if (ev.kind !== kind || !Number.isSafeInteger(ev.created_at) || ev.created_at < 0 || !verifyEvent(ev)) throw new Error();
    if (!Array.isArray(ev.tags) || ev.tags.some(t => !Array.isArray(t) || t.some(v => typeof v !== 'string'))) throw new Error();
  } catch { next.invalid++; return next; }

  if (kind === FUNDRAISER_CARD_KIND) {
    const e = ev as FundraiserCardEvent;
    const slug = tagValue(e.tags, 'd');
    const content = slug && /^[a-z0-9][a-z0-9-]{0,63}$/i.test(slug) && e.tags.filter(t => t[0] === 'd').length === 1 ? parseCardContent(e.content) : null;
    if (!slug || !content) {
      next.invalid += 1;
      return next;
    }
    const aCoord = fundraiserACoord(e.pubkey, slug);
    const prev = state.cards.get(aCoord);
    if (!prev && state.cards.size >= MAX_FEED_CARDS) { next.invalid++; return next; }
    if (prev) {
      const newer = e.created_at > prev.createdAt || (e.created_at === prev.createdAt && e.id < prev.eventId);
      if (!newer) return next; // stale copy (relay replay, out-of-order delivery)
    }
    next.cards = new Map(state.cards);
    next.cards.set(aCoord, { aCoord, eventId: e.id, createdAt: e.created_at, content });
    return next;
  }

  if (kind === MILESTONE_STATUS_KIND) {
    const e = ev as MilestoneStatusEvent;
    const d = tagValue(e.tags, 'd');
    type StatusBody = { v?: number; fundraiser?: string; milestone?: string; ledgerHead?: string; seq?: number; status?: string; totals?: MilestoneStatusEntry['totals'] };
    let body: StatusBody | null;
    try {
      body = JSON.parse(e.content) as StatusBody;
    } catch {
      body = null;
    }
    if (!d || !body) {
      next.invalid += 1;
      return next;
    }
    const { v, fundraiser, milestone, ledgerHead, seq, status, totals } = body;
    // Spec §2: "full a-coordinate, never bare slug" - a bare slug cannot be
    // verified against a card and is rejected at the fold.
    if (v !== 1 || !isFundraiserACoord(fundraiser) || typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 1 || typeof status !== 'string' || !MILESTONE_STATUSES.includes(status as CardMilestone['status']) || typeof milestone !== 'string' || !milestone.trim()) {
      next.invalid += 1;
      return next;
    }
    const slug = fundraiser.split(':')[2];
    if (e.tags.filter(t => t[0] === 'd').length !== 1 || d !== `${slug}:${milestone}:${seq}` ||
        !authority?.registrarPins.get(fundraiser)?.has(e.pubkey) ||
        (ledgerHead !== undefined && !/^[0-9a-f]{64}$/.test(ledgerHead)) ||
        (totals !== undefined && (!totals || typeof totals !== 'object' || Array.isArray(totals) ||
          Object.entries(totals).some(([key, value]) => !['totalRaised', 'supporterCount', 'anonymousSats'].includes(key) ||
            (value === null ? key === 'totalRaised' : typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0))))) {
      next.invalid++; return next;
    }
    const list = state.milestoneStatuses.get(fundraiser) ?? [];
    if (list.some((m) => m.eventId === e.id)) return next; // duplicate delivery
    const count = [...state.milestoneStatuses.values()].reduce((sum, rows) => sum + rows.length, 0);
    if (count >= MAX_FEED_STATUSES) { next.invalid++; return next; }
    next.milestoneStatuses = new Map(state.milestoneStatuses);
    next.milestoneStatuses.set(fundraiser, [...list, { d, milestone, signer: e.pubkey, ledgerHead: ledgerHead ?? null, ledgerVerified: false as const, seq, status, totals, eventId: e.id }].sort((a, b) => a.seq - b.seq || a.eventId.localeCompare(b.eventId)));
    return next;
  }

  next.invalid += 1;
  return next;
}

// ─── G4 discovery subscription ─────────────────────────────────────────────

export interface DiscoveryFilter {
  kinds: number[];
  '#t'?: string[];
}

/** The canonical G4 agent-discovery filter (publish this in manifests). */
export function discoveryFilter(topic?: string): DiscoveryFilter {
  const f: DiscoveryFilter = { kinds: [FUNDRAISER_CARD_KIND, MILESTONE_STATUS_KIND] };
  if (topic) f['#t'] = [topic];
  return f;
}

export interface SubscribeFn {
  /**
   * WebRelayConn-shaped subscription: filter in, events out, unsubscribe
   * function back. Reused so tests can drive the fold with fakes.
   */
  subscribe(filter: DiscoveryFilter, onEvent: (ev: FundraiserCardEvent | MilestoneStatusEvent & { kind?: number }) => void): () => void;
}

/**
 * subscribeFundFeed - the relay-side discovery feed (C1). Folds 39801 cards
 * and 39803 milestone statuses into `state` (mutated via the returned
 * snapshot callback). Returns the unsubscribe function. Unknown kinds are
 * counted, never thrown.
 */
export function subscribeFundFeed(
  conn: SubscribeFn,
  opts: {
    topic?: string;
    authority?: FeedAuthority;
    onState: (state: FundFeedFoldState) => void;
    onError?: (err: unknown) => void;
  },
): () => void {
  let state = emptyFundFeedFoldState();
  let active = true;
  const emit = () => opts.onState(state);
  try {
    const unsub = conn.subscribe(discoveryFilter(opts.topic), (ev) => {
      if (!active) return;
      try {
        state = foldFundFeedEvent(state, ev, ev.kind, opts.authority);
        emit();
      } catch (err) {
        opts.onError?.(err);
      }
    });
    return () => {
      if (!active) return;
      active = false;
      try {
        unsub();
      } catch {
        /* already closed */
      }
    };
  } catch (err) {
    opts.onError?.(err);
    return () => {};
  }
}
