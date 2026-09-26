/**
 * mintDiscovery - NIP-87 Cashu mint discovery (ported from the 2140 wallet).
 *
 * Two event kinds over public relays:
 *   - kind 38172: mint announcement (d = mint id, u = mint URL, n = network,
 *     nuts = supported NUT list, content = kind-0-style metadata JSON)
 *   - kind 38000: mint recommendation/review (d = mint id, k = "38172",
 *     u = mint URL, rating = 1..5, content = review text)
 *
 * The fold is pure and unit-tested; `discoverMints` is the only network
 * function. Discovery is best-effort: any relay failure yields whatever the
 * other relays returned, never a hard error.
 */
import { SimplePool, type Event } from 'nostr-tools';
import { isAllowedMintUrl, safeNormalizeMintUrl } from '../lib/cashu/tokenUtils';
import { isBlockedMintUrl } from './mintConfig';

export const MINT_ANNOUNCEMENT_KIND = 38172;
export const MINT_RECOMMENDATION_KIND = 38000;

/**
 * Relays queried by default. Override with VITE_BAO_MINT_DISCOVERY_RELAYS.
 * Hosts that deploy a Content-Security-Policy must list these (and any
 * override) in connect-src or discovery silently returns nothing.
 */
export const DEFAULT_DISCOVERY_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
] as const;

const MAX_RELAYS = 8;
const DEFAULT_LIMIT = 500;
const DEFAULT_TIMEOUT_MS = 6_000;
/** Hostile-relay bounds: a public relay can stream unbounded events/tags. */
const MAX_EVENTS = 1_000;
const MAX_TAGS_SCANNED = 256;
const MAX_REC_URLS = 16;
const MAX_NUTS = 64;

const VALID_NETWORKS = new Set(['mainnet', 'testnet', 'signet', 'regtest']);

export type MintNetwork = 'mainnet' | 'testnet' | 'signet' | 'regtest' | 'unknown';

export interface MintAnnouncement {
  eventId: string;
  /** Event created_at - the latest announcement per mint wins. */
  createdAt: number;
  /** Mint identifier (d-tag of the announcement). */
  mintId: string;
  /** Normalized mint URL (https, public). */
  mintUrl: string;
  network: MintNetwork;
  nuts: number[];
  name?: string;
  description?: string;
}

export interface MintRecommendation {
  eventId: string;
  createdAt: number;
  author: string;
  mintId: string;
  mintUrls: string[];
  rating?: number;
  content: string;
}

export interface DiscoveredMint {
  url: string;
  announcement?: MintAnnouncement;
  recommendations: MintRecommendation[];
  name?: string;
  description?: string;
  network: MintNetwork;
  nuts: number[];
  avgRating?: number;
  /** Higher is better (mainnet + NUT support + recommendations + rating). */
  score: number;
}

/** A syntactically usable wss:// relay URL (hostname present). */
function validRelay(url: string): boolean {
  if (typeof url !== 'string' || !url.startsWith('wss://') || url.length > 256) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'wss:' && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

/**
 * Parse comma/space separated discovery relay list (wss only, bounded).
 * Unset/blank → the public defaults. A CONFIGURED but unparseable list
 * returns [] (never the public defaults): silently querying third-party
 * relays because of a typo would leak traffic the operator did not choose.
 */
export function parseDiscoveryRelays(raw: string | undefined): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return [...DEFAULT_DISCOVERY_RELAYS];
  const out: string[] = [];
  for (const part of raw.split(/[\s,]+/)) {
    const candidate = part.trim();
    if (!validRelay(candidate) || out.includes(candidate)) continue;
    out.push(candidate);
    if (out.length >= MAX_RELAYS) break;
  }
  return out;
}

function tag(event: Event, name: string): string | undefined {
  const tags = Array.isArray(event.tags) ? event.tags.slice(0, MAX_TAGS_SCANNED) : [];
  return tags.find((t) => t[0] === name)?.[1];
}

function parseMetadata(content: string): Record<string, unknown> {
  if (!content.trim()) return {};
  try {
    const parsed = JSON.parse(content) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    /* not JSON: no metadata */
  }
  return {};
}

function parseNuts(value: string | undefined): number[] {
  if (!value) return [];
  const out = new Set<number>();
  for (const part of value.split(',')) {
    const n = Number(part.trim());
    if (Number.isInteger(n) && n > 0) out.add(n);
    if (out.size >= MAX_NUTS) break;
  }
  return [...out];
}

function sanitizeMintUrl(raw: string | undefined): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const normalized = safeNormalizeMintUrl(raw.trim());
  return isAllowedMintUrl(normalized) ? normalized : null;
}

/** Parse a kind-38172 mint announcement; null when malformed/not allowed. */
export function parseMintAnnouncement(event: Event): MintAnnouncement | null {
  if (event.kind !== MINT_ANNOUNCEMENT_KIND) return null;
  const mintId = tag(event, 'd')?.trim();
  if (!mintId) return null;
  const mintUrl = sanitizeMintUrl(tag(event, 'u'));
  if (!mintUrl) return null;
  const rawNetwork = tag(event, 'n')?.toLowerCase() ?? 'unknown';
  const metadata = parseMetadata(event.content);
  const name = typeof metadata.name === 'string' && metadata.name.trim() ? metadata.name.trim().slice(0, 80) : undefined;
  const description =
    typeof metadata.description === 'string' && metadata.description.trim()
      ? metadata.description.trim().slice(0, 240)
      : undefined;
  return {
    eventId: event.id,
    createdAt: event.created_at,
    mintId,
    mintUrl,
    network: VALID_NETWORKS.has(rawNetwork) ? (rawNetwork as MintNetwork) : 'unknown',
    nuts: parseNuts(tag(event, 'nuts')),
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
  };
}

/** Parse a kind-38000 recommendation for a Cashu mint (k=38172). */
export function parseMintRecommendation(event: Event): MintRecommendation | null {
  if (event.kind !== MINT_RECOMMENDATION_KIND) return null;
  if (tag(event, 'k') !== String(MINT_ANNOUNCEMENT_KIND)) return null;
  const mintId = tag(event, 'd')?.trim();
  if (!mintId) return null;
  const mintUrls: string[] = [];
  const seenUrls = new Set<string>();
  const tags = Array.isArray(event.tags) ? event.tags.slice(0, MAX_TAGS_SCANNED) : [];
  for (const t of tags) {
    if (t[0] !== 'u' || !t[1]) continue;
    const url = sanitizeMintUrl(t[1]);
    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);
    mintUrls.push(url);
    if (mintUrls.length >= MAX_REC_URLS) break;
  }
  const rawRating = tag(event, 'rating');
  const rating = rawRating !== undefined && Number.isFinite(Number(rawRating)) ? Number(rawRating) : undefined;
  return {
    eventId: event.id,
    createdAt: event.created_at,
    author: event.pubkey,
    mintId,
    mintUrls,
    ...(rating !== undefined && rating >= 1 && rating <= 5 ? { rating } : {}),
    content: event.content.trim().slice(0, 500),
  };
}

/**
 * Build the kind-38000 review template for the signed-in author to sign.
 * Addressable semantics come from the `d` tag (the mint id, falling back to
 * the normalized URL for URL-only mints): a newer event by the same author
 * replaces the older one on every NIP-87 reader. Throws on invalid input -
 * a review is a public, signed statement, never fire-and-forget garbage.
 */
export interface MintRecommendationInput {
  mintUrl: string;
  /** Announcement d-tag when known; the normalized URL otherwise. */
  mintId?: string;
  /** 1..5 when rated; a text-only review is allowed. */
  rating?: number;
  content?: string;
  nowSeconds?: number;
}

export interface MintRecommendationTemplate {
  kind: typeof MINT_RECOMMENDATION_KIND;
  created_at: number;
  tags: string[][];
  content: string;
}

export function buildMintRecommendationEvent(input: MintRecommendationInput): MintRecommendationTemplate {
  const mintUrl = sanitizeMintUrl(input.mintUrl);
  if (!mintUrl) throw new Error('A valid public mint URL is required to review a mint');
  const mintId = (input.mintId?.trim() || mintUrl).slice(0, 256);
  const content = (input.content ?? '').trim().slice(0, 500);
  const rating = input.rating;
  if (rating !== undefined && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
    throw new Error('A mint rating must be an integer from 1 to 5');
  }
  if (rating === undefined && !content) {
    throw new Error('A mint review needs a rating or some text');
  }
  const tags: string[][] = [
    ['d', mintId],
    ['k', String(MINT_ANNOUNCEMENT_KIND)],
    ['u', mintUrl],
  ];
  if (rating !== undefined) tags.push(['rating', String(rating)]);
  return {
    kind: MINT_RECOMMENDATION_KIND,
    created_at: input.nowSeconds ?? Math.floor(Date.now() / 1000),
    tags,
    content,
  };
}

/** Publish a SIGNED kind-38000 event; returns how many relays accepted it. */
export async function publishMintRecommendation(
  relays: readonly string[],
  event: Event,
  timeoutMs = 6_000,
): Promise<number> {
  const targets = relays.filter(validRelay).slice(0, MAX_RELAYS);
  if (targets.length === 0 || event.kind !== MINT_RECOMMENDATION_KIND) return 0;
  const pool = new SimplePool();
  try {
    const settled = await Promise.race([
      Promise.allSettled(pool.publish(targets, event)),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('publish timeout')), timeoutMs)),
    ]);
    return settled.filter((r) => r.status === 'fulfilled').length;
  } catch {
    return 0;
  } finally {
    try {
      pool.close(targets);
    } catch {
      /* pool cleanup is best-effort */
    }
  }
}

/** Group recommendations by every mint URL they mention. */
export function groupRecommendationsByUrl(
  recommendations: readonly MintRecommendation[],
): Map<string, MintRecommendation[]> {
  const groups = new Map<string, MintRecommendation[]>();
  for (const r of recommendations) {
    for (const url of r.mintUrls) {
      const list = groups.get(url) ?? [];
      list.push(r);
      groups.set(url, list);
    }
  }
  return groups;
}

function supportsNut(nuts: readonly number[], nut: number): boolean {
  return nuts.includes(nut);
}

/** The network-quality score shared by the ranker and local review upserts. */
export function scoreFor(
  network: MintNetwork,
  nuts: readonly number[],
  recommendations: readonly MintRecommendation[],
): number {
  const ratings = recommendations.map((r) => r.rating).filter((r): r is number => r !== undefined);
  const avgRating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : undefined;
  let score = 0;
  if (network === 'mainnet') score += 1;
  if (supportsNut(nuts, 4)) score += 1;
  if (supportsNut(nuts, 5)) score += 1;
  if (supportsNut(nuts, 7)) score += 0.5;
  if (supportsNut(nuts, 17)) score += 0.5;
  score += Math.min(recommendations.length, 5) * 0.5;
  if (avgRating !== undefined) score += (avgRating / 5) * 1.5;
  return score;
}

/**
 * Rank discovered mints. Mints the user already holds are boosted by the
 * caller (not here); this is the network-quality score:
 * mainnet +1, NUT-04/05 +1 each, NUT-07/17 +0.5 each, up to 5 recommendations
 * +0.5 each, average rating / 5 * 1.5.
 */
export function rankDiscoveredMints(
  announcements: readonly MintAnnouncement[],
  recommendations: readonly MintRecommendation[],
  opts: { followPubkeys?: ReadonlySet<string> } = {},
): DiscoveredMint[] {
  // Replaceable events: relays can serve several versions of the same
  // (pubkey, d) announcement/review. Keep the newest by created_at.
  const latestAnnouncement = new Map<string, MintAnnouncement>();
  for (const a of announcements) {
    const existing = latestAnnouncement.get(a.mintUrl);
    if (!existing || a.createdAt > existing.createdAt) latestAnnouncement.set(a.mintUrl, a);
  }
  const mintIdToUrl = new Map<string, string>();
  for (const a of latestAnnouncement.values()) mintIdToUrl.set(a.mintId, a.mintUrl);

  const scoped = opts.followPubkeys
    ? recommendations.filter((r) => opts.followPubkeys!.has(r.author.toLowerCase()))
    : recommendations;
  // Group first (a review without a u tag still binds to the announcement's
  // d-tag), THEN dedupe per (author, URL): keying the dedupe on the FIRST url
  // only let a multi-url review plus a later single-url review count one
  // author twice for the shared url.
  const groupedByAuthor = new Map<string, Map<string, MintRecommendation>>();
  for (const r of scoped) {
    const urls = r.mintUrls.length > 0
      ? r.mintUrls
      : (mintIdToUrl.get(r.mintId) ? [mintIdToUrl.get(r.mintId)!] : []);
    for (const url of urls) {
      const perAuthor = groupedByAuthor.get(url) ?? new Map<string, MintRecommendation>();
      const key = r.author.toLowerCase();
      const existing = perAuthor.get(key);
      if (!existing || r.createdAt > existing.createdAt) perAuthor.set(key, r);
      groupedByAuthor.set(url, perAuthor);
    }
  }
  const grouped = new Map<string, MintRecommendation[]>();
  for (const [url, perAuthor] of groupedByAuthor) {
    grouped.set(url, [...perAuthor.values()]);
  }

  // Follows scope is RECOMMENDATION scope: a mint with no review from the
  // followed set is anonymous-announcement metadata and must not be presented
  // as "recommended by the people you follow" (owner ask: filter it or label
  // it; filtering keeps the toggle honest).
  const followsScope = opts.followPubkeys !== undefined;

  const byUrl = new Map<string, DiscoveredMint>();
  for (const a of latestAnnouncement.values()) {
    // Owner rule 2026-09-21: no signet/testnet Cashu wallet anywhere - a
    // discovered test mint must never be offered for the wallet.
    if (a.network === 'testnet' || a.network === 'signet' || a.network === 'regtest') continue;
    if (isBlockedMintUrl(a.mintUrl)) continue;
    if (followsScope && !grouped.has(a.mintUrl)) continue;
    byUrl.set(a.mintUrl, {
      url: a.mintUrl,
      announcement: a,
      recommendations: [],
      ...(a.name ? { name: a.name } : {}),
      ...(a.description ? { description: a.description } : {}),
      network: a.network,
      nuts: a.nuts,
      score: 0,
    });
  }
  // URL-only mints (recommendations without a known announcement). Known
  // test-network hosts are never offered (owner rule: no signet wallet).
  for (const url of grouped.keys()) {
    if (byUrl.has(url)) continue;
    if (isBlockedMintUrl(url)) continue;
    byUrl.set(url, { url, recommendations: [], network: 'unknown', nuts: [], score: 0 });
  }

  for (const mint of byUrl.values()) {
    const recs = grouped.get(mint.url) ?? [];
    mint.recommendations = recs;
    const ratings = recs.map((r) => r.rating).filter((r): r is number => r !== undefined);
    if (ratings.length > 0) {
      mint.avgRating = ratings.reduce((a, b) => a + b, 0) / ratings.length;
    }
    mint.score = scoreFor(mint.network, mint.nuts, recs);
  }

  return [...byUrl.values()].sort((a, b) => b.score - a.score || a.url.localeCompare(b.url));
}

/**
 * Upsert ONE review into a discovered list (the local publish echo — no
 * refetch). Addressable semantics: the author's previous review for that URL
 * is replaced, exactly like the ranker's per-(author, URL) latest-wins fold.
 */
export function upsertRecommendation(
  mints: readonly DiscoveredMint[],
  recommendation: MintRecommendation,
): DiscoveredMint[] {
  const author = recommendation.author.toLowerCase();
  return mints.map((mint) => {
    if (!recommendation.mintUrls.includes(mint.url)) return mint;
    const recommendations = [
      ...mint.recommendations.filter(
        (r) => r.author.toLowerCase() !== author || !r.mintUrls.includes(mint.url),
      ),
      recommendation,
    ];
    const ratings = recommendations.map((r) => r.rating).filter((r): r is number => r !== undefined);
    const next: DiscoveredMint = {
      ...mint,
      recommendations,
      score: scoreFor(mint.network, mint.nuts, recommendations),
    };
    if (ratings.length > 0) next.avgRating = ratings.reduce((a, b) => a + b, 0) / ratings.length;
    else delete next.avgRating;
    return next;
  });
}

export interface DiscoverMintsOptions {
  relays?: string[];
  /** When set, only recommendations from these pubkeys count (follows scope). */
  followPubkeys?: string[];
  limit?: number;
  timeoutMs?: number;
}

/**
 * Query the discovery relays for NIP-87 announcements + recommendations and
 * return the ranked mint list. Best-effort: relay errors are swallowed.
 */
export async function discoverMints(opts: DiscoverMintsOptions = {}): Promise<DiscoveredMint[]> {
  const relays = (opts.relays ?? parseDiscoveryRelays(import.meta.env?.VITE_BAO_MINT_DISCOVERY_RELAYS))
    .filter(validRelay);
  if (relays.length === 0) return [];
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const maxWait = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pool = new SimplePool();
  try {
    const [announcementEvents, recommendationEvents] = await Promise.all([
      pool.querySync(relays, { kinds: [MINT_ANNOUNCEMENT_KIND], limit }, { maxWait }),
      pool.querySync(
        relays,
        { kinds: [MINT_RECOMMENDATION_KIND], '#k': [String(MINT_ANNOUNCEMENT_KIND)], limit },
        { maxWait },
      ),
    ]);
    // Bound hostile relay streams: `limit` is only a REQ hint.
    const seenA = new Set<string>();
    const announcements: MintAnnouncement[] = [];
    for (const ev of announcementEvents) {
      if (seenA.size >= MAX_EVENTS) break;
      if (seenA.has(ev.id)) continue;
      seenA.add(ev.id);
      const parsed = parseMintAnnouncement(ev);
      if (parsed) announcements.push(parsed);
    }
    const seenR = new Set<string>();
    const recommendations: MintRecommendation[] = [];
    for (const ev of recommendationEvents) {
      if (seenR.size >= MAX_EVENTS) break;
      if (seenR.has(ev.id)) continue;
      seenR.add(ev.id);
      const parsed = parseMintRecommendation(ev);
      if (parsed) recommendations.push(parsed);
    }
    const followPubkeys = opts.followPubkeys
      ? new Set(opts.followPubkeys.map((p) => p.toLowerCase()))
      : undefined;
    return rankDiscoveredMints(announcements, recommendations, followPubkeys ? { followPubkeys } : {});
  } finally {
    try {
      pool.close(relays);
    } catch {
      /* pool cleanup is best-effort */
    }
  }
}

/**
 * Fetch the contact list (kind 3) of a pubkey and return the followed hex
 * pubkeys. Best-effort: [] on any failure.
 */
export async function fetchFollowPubkeys(
  pubkey: string,
  opts: { relays?: string[]; timeoutMs?: number } = {},
): Promise<string[]> {
  if (!/^[0-9a-f]{64}$/i.test(pubkey)) return [];
  const relays = (opts.relays ?? parseDiscoveryRelays(import.meta.env?.VITE_BAO_MINT_DISCOVERY_RELAYS))
    .filter(validRelay);
  if (relays.length === 0) return [];
  const pool = new SimplePool();
  try {
    const events = await pool.querySync(
      relays,
      { kinds: [3], authors: [pubkey.toLowerCase()], limit: 1 },
      { maxWait: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS },
    );
    const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
    if (!latest) return [];
    const follows = new Set<string>();
    for (const t of latest.tags) {
      if (t[0] !== 'p' || typeof t[1] !== 'string') continue;
      const pk = t[1].toLowerCase();
      if (/^[0-9a-f]{64}$/.test(pk)) follows.add(pk);
      if (follows.size >= 1_000) break;
    }
    return [...follows];
  } catch {
    return [];
  } finally {
    try {
      pool.close(relays);
    } catch {
      /* pool cleanup is best-effort */
    }
  }
}

// ─── Local review guard (once per mint + cooldown) ─────────────────────────

const REVIEW_STORE_PREFIX = 'bao-fund:mintReview:';
/** Minimum gap between two reviews by the same identity for one mint. */
export const REVIEW_COOLDOWN_MS = 5 * 60_000;
const MAX_REVIEW_STORE_ENTRIES = 50;

export interface PublishedReviewRecord {
  rating?: number;
  content: string;
  at: number;
}

function reviewStoreKey(pubkey: string): string {
  return `${REVIEW_STORE_PREFIX}${pubkey.toLowerCase()}`;
}

function loadReviewStore(pubkey: string): Record<string, PublishedReviewRecord> {
  try {
    const raw = localStorage.getItem(reviewStoreKey(pubkey));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, PublishedReviewRecord> = {};
    for (const [url, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const rec = value as Record<string, unknown>;
      if (typeof rec.at !== 'number' || !Number.isFinite(rec.at) || typeof rec.content !== 'string') continue;
      out[url] = { content: rec.content, at: rec.at, ...(typeof rec.rating === 'number' ? { rating: rec.rating } : {}) };
    }
    return out;
  } catch {
    return {};
  }
}

function saveReviewStore(pubkey: string, store: Record<string, PublishedReviewRecord>): void {
  try {
    const entries = Object.entries(store)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, MAX_REVIEW_STORE_ENTRIES);
    localStorage.setItem(reviewStoreKey(pubkey), JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* storage unavailable - the guard is best-effort */
  }
}

/** The last review this identity published for a mint (local echo/guard). */
export function getPublishedReview(pubkey: string, mintUrl: string): PublishedReviewRecord | null {
  if (!/^[0-9a-f]{64}$/i.test(pubkey)) return null;
  return loadReviewStore(pubkey)[mintUrl] ?? null;
}

/** Record a published review (once-per-mint guard + local echo). */
export function rememberPublishedReview(
  pubkey: string,
  mintUrl: string,
  review: { rating?: number; content: string },
  nowMs = Date.now(),
): PublishedReviewRecord {
  const record: PublishedReviewRecord = {
    content: review.content,
    at: nowMs,
    ...(review.rating !== undefined ? { rating: review.rating } : {}),
  };
  if (/^[0-9a-f]{64}$/i.test(pubkey)) {
    const store = loadReviewStore(pubkey);
    store[mintUrl] = record;
    saveReviewStore(pubkey, store);
  }
  return record;
}

/** Remaining cooldown before the same identity may publish again (ms). */
export function reviewCooldownRemainingMs(pubkey: string, mintUrl: string, nowMs = Date.now()): number {
  const record = getPublishedReview(pubkey, mintUrl);
  if (!record) return 0;
  // A future-dated record (clock skew, or a tampered/truncated local store)
  // must not brick the button for years. More than a minute ahead is
  // implausible, so such a record is ignored for the COOLDOWN (the echo in
  // the store is kept) - the relay remains the authority on rate limits.
  if (record.at > nowMs + 60_000) return 0;
  return Math.max(0, record.at + REVIEW_COOLDOWN_MS - nowMs);
}

// ─── Mint info + independent audit (2140 parity) ───────────────────────────

export interface MintInfoSummary {
  name?: string;
  description?: string;
  version?: string;
  motd?: string;
  nuts: number[];
  units: string[];
  methods: string[];
}

/** Fetch and summarize `/v1/info` for one mint (bounded, best-effort). */
export async function fetchMintInfo(url: string, timeoutMs = 6_000): Promise<MintInfoSummary | null> {
  if (!isAllowedMintUrl(url) || isBlockedMintUrl(url)) return null;
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/v1/info`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const raw = (await res.json()) as Record<string, unknown>;
    const nutsRaw = raw.nuts && typeof raw.nuts === 'object' ? (raw.nuts as Record<string, unknown>) : {};
    const nuts = Object.keys(nutsRaw).map(Number).filter((n) => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
    const methods = new Set<string>();
    const units = new Set<string>();
    for (const nut of Object.values(nutsRaw)) {
      const list = (nut as { methods?: unknown })?.methods;
      if (!Array.isArray(list)) continue;
      for (const m of list) {
        const method = (m as { method?: unknown })?.method;
        const unit = (m as { unit?: unknown })?.unit;
        if (typeof method === 'string') methods.add(method.toUpperCase());
        if (typeof unit === 'string') units.add(unit.toUpperCase());
      }
    }
    const str = (v: unknown, max: number): string | undefined =>
      typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;
    return {
      ...(str(raw.name, 80) ? { name: str(raw.name, 80) } : {}),
      ...(str(raw.description, 240) ? { description: str(raw.description, 240) } : {}),
      ...(str(raw.version, 40) ? { version: str(raw.version, 40) } : {}),
      ...(str(raw.motd, 240) ? { motd: str(raw.motd, 240) } : {}),
      nuts,
      units: [...units],
      methods: [...methods],
    };
  } catch {
    return null;
  }
}

export interface MintAuditSummary {
  successRate: number;
  successfulSwaps: number;
  totalSwaps: number;
  averageTimeMs: number | null;
}

/** Independent reliability observations from audit.8333.space (best-effort). */
export async function fetchMintAudit(url: string, timeoutMs = 6_000): Promise<MintAuditSummary | null> {
  try {
    const res = await fetch(`https://api.audit.8333.space/mints/url?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 404 || !res.ok) return null;
    const mint = (await res.json()) as Record<string, unknown>;
    const id = Number(mint.id);
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    const swapsRes = await fetch(`https://api.audit.8333.space/swaps/mint/${id}?skip=0&limit=100`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!swapsRes.ok) return null;
    const swapsRaw = (await swapsRes.json()) as unknown;
    if (!Array.isArray(swapsRaw)) return null;
    const swaps = swapsRaw.flatMap((s): Array<{ state: string; timeTaken: number }> => {
      if (!s || typeof s !== 'object') return [];
      const row = s as Record<string, unknown>;
      const timeTaken = Number(row.time_taken);
      return [{
        state: typeof row.state === 'string' ? row.state : '',
        timeTaken: Number.isFinite(timeTaken) && timeTaken >= 0 ? timeTaken : 0,
      }];
    });
    const successful = swaps.filter((s) => s.state === 'OK');
    const timed = successful.filter((s) => s.timeTaken > 0);
    return {
      successRate: swaps.length > 0 ? Math.round((successful.length / swaps.length) * 100) : 0,
      successfulSwaps: successful.length,
      totalSwaps: swaps.length,
      averageTimeMs: timed.length > 0 ? timed.reduce((a, b) => a + b.timeTaken, 0) / timed.length : null,
    };
  } catch {
    return null;
  }
}
