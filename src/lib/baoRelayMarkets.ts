/**
 * Relay-first bao.markets discovery.
 *
 * Kind-38000 market definition events are queried directly from
 * wss://relay.bao.network through the app's nostr pool, so market cards render
 * even when the bao.markets API is down. Live odds/charts still come from the
 * API (AMM state lives in the API database); the relay carries definitions.
 *
 * Validation mirrors the bao.markets ingestion bridge: the pool guarantees a
 * valid signature, but the STRUCTURE is checked here — required tags present,
 * at least two outcomes, and the `n` network tag matching the app network.
 * Malformed events are dropped silently: relay spam must never render.
 */

import type { NostrEvent } from "@nostrify/nostrify";

import { parseBaoMarket, type BaoMarket, BAO_MARKET_KIND } from "@/lib/baoMarketParser";

/** Relay that carries the canonical kind-38000 market definitions. */
export const BAO_MARKETS_RELAY = "wss://relay.bao.network";

/**
 * Network the app displays markets for. bao.markets currently runs in demo
 * (signet) mode; events tag this as `n`/`network` = "demo".
 */
export const BAO_MARKET_NETWORK: string =
  ((import.meta.env as Record<string, unknown>).VITE_BAO_MARKET_NETWORK as string | undefined) || "demo";

function getTag(event: NostrEvent, name: string): string | undefined {
  return event.tags.find((t) => t[0] === name)?.[1];
}

function getTagAll(event: NostrEvent, name: string): string[] {
  return event.tags.filter((t) => t[0] === name).map((t) => t[1]);
}

function parseJsonObject(raw: string | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function countOutcomes(...sources: unknown[]): number {
  for (const source of sources) {
    if (Array.isArray(source) && source.length >= 2) return source.length;
  }
  return 0;
}

/**
 * Structural validation for a kind-38000 market definition event, mirroring
 * the bao.markets ingestion bridge. Returns false for anything malformed —
 * callers drop those events silently.
 *
 * Required: `d` id, `c`/`category`, `n`/`network` matching the app network,
 * a numeric `end` tag, a title (tag, `data` tag JSON, or content JSON), and
 * at least two outcomes (`outcome` tags or a `data`/content outcomes array).
 */
export function isValidBaoRelayMarketEvent(
  event: NostrEvent,
  network: string = BAO_MARKET_NETWORK,
): boolean {
  if (event.kind !== BAO_MARKET_KIND) return false;

  const d = getTag(event, "d");
  if (!d || !d.trim()) return false;

  const eventNetwork = (getTag(event, "n") ?? getTag(event, "network"))?.trim().toLowerCase();
  if (!eventNetwork || eventNetwork !== network.trim().toLowerCase()) return false;

  const category = getTag(event, "c") ?? getTag(event, "category");
  if (!category || !category.trim()) return false;

  const end = getTag(event, "end");
  if (!end || !/^\d+$/.test(end.trim())) return false;

  const data = parseJsonObject(getTag(event, "data"));
  const content = parseJsonObject(event.content);

  const title =
    getTag(event, "title") ??
    (typeof data?.title === "string" ? data.title : undefined) ??
    (typeof content?.title === "string" ? content.title : undefined);
  if (!title || !title.trim()) return false;

  const outcomeTags = getTagAll(event, "outcome").filter((label) => label.trim().length > 0);
  const outcomeCount = Math.max(
    outcomeTags.length,
    countOutcomes(data?.outcomes, content?.outcomes),
  );
  if (outcomeCount < 2) return false;

  return true;
}

/**
 * Parse a relay-sourced kind-38000 event into the same BaoMarket shape the
 * market cards use. Returns null for malformed events (drop silently).
 */
export function parseBaoRelayMarket(
  event: NostrEvent,
  network: string = BAO_MARKET_NETWORK,
): BaoMarket | null {
  if (!isValidBaoRelayMarketEvent(event, network)) return null;
  return parseBaoMarket(event);
}

/**
 * Parse a batch of relay events: validate, drop malformed, dedupe by `d`-tag
 * keeping the newest event, and sort newest-first.
 */
export function parseBaoRelayMarkets(
  events: NostrEvent[],
  network: string = BAO_MARKET_NETWORK,
): BaoMarket[] {
  const byDTag = new Map<string, BaoMarket>();
  const seenEventIds = new Set<string>();

  for (const event of events) {
    if (seenEventIds.has(event.id)) continue;
    seenEventIds.add(event.id);

    const parsed = parseBaoRelayMarket(event, network);
    if (!parsed) continue;

    const existing = byDTag.get(parsed.marketId);
    if (!existing || parsed.createdAt > existing.createdAt) {
      byDTag.set(parsed.marketId, parsed);
    }
  }

  return Array.from(byDTag.values()).sort((a, b) => b.createdAt - a.createdAt);
}

/** A market as rendered by the prediction markets page. */
export interface RelayMergedMarket extends BaoMarket {
  /** True when this market came from the relay only (no API row). */
  viaRelay: boolean;
  /** False for relay-only markets: the relay carries no AMM state. */
  oddsAvailable: boolean;
}

/**
 * Merge API markets with relay-discovered markets for display. The API wins
 * on conflicts (it carries live odds/status); relay-only markets appear with
 * `viaRelay`/`oddsAvailable: false` so the UI can badge them and hide
 * misleading uniform placeholder probabilities.
 */
export function mergeApiAndRelayMarkets(
  apiMarkets: BaoMarket[],
  relayMarkets: BaoMarket[],
): RelayMergedMarket[] {
  const byId = new Map<string, RelayMergedMarket>();

  for (const market of apiMarkets) {
    byId.set(market.marketId, { ...market, viaRelay: false, oddsAvailable: true });
  }

  for (const market of relayMarkets) {
    const existing = byId.get(market.marketId);
    if (existing && !existing.viaRelay) continue; // API wins on conflicts.
    if (existing && existing.createdAt >= market.createdAt) continue;
    byId.set(market.marketId, { ...market, viaRelay: true, oddsAvailable: false });
  }

  return Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt);
}
