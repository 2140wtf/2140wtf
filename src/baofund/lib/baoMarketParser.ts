import type { NostrEvent } from "@nostrify/nostrify";
import { verifyEvent } from "nostr-tools";

export const BAO_MARKET_KIND = 38000;
export const BAO_MARKETS_TRADE_KIND = 38001;
export const BAO_MARKETS_DELEGATED_ORDER_KIND = 38005;

export interface BaoMarketOutcome {
  id: string;
  label: string;
  probability: number;
}

export interface BaoMarket {
  marketId: string;
  title: string;
  description: string;
  category: string;
  state: string;
  type: "binary" | "categorical" | "scalar";
  endTime: number;
  createdAt: number;
  outcomes: BaoMarketOutcome[];
  creatorPubkey: string;
  /** Winning outcome id when the API reports the market as resolved (API-sourced only). */
  resolution?: string | null;
  rawEvent: NostrEvent;
}

function sanitizeSingleLine(text: string, maxLength = 200): string {
  return text
    .replace(/[\r\n\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function parseOutcomes(raw: unknown[]): BaoMarketOutcome[] {
  const defaultProb = raw.length > 0 ? 1 / raw.length : 0.5;

  const outcomes = raw
    .map((o, idx): BaoMarketOutcome | null => {
      if (typeof o === "string") {
        const label = sanitizeSingleLine(o, 100);
        if (!label) return null;
        return { id: `outcome_${idx}`, label, probability: defaultProb };
      }
      if (o && typeof o === "object") {
        const obj = o as Record<string, unknown>;
        const label = sanitizeSingleLine(String(obj.label || ""), 100);
        if (!label) return null;
        const rawProb = Number(obj.probability);
        const prob = Number.isFinite(rawProb) ? Math.max(0, Math.min(1, rawProb)) : defaultProb;
        const id =
          typeof obj.id === "string" && obj.id.length > 0
            ? sanitizeSingleLine(obj.id, 50)
            : `outcome_${idx}`;
        return { id, label, probability: prob };
      }
      return null;
    })
    .filter((o): o is BaoMarketOutcome => o !== null);

  const seen = new Set<string>();
  return outcomes.filter((o) => {
    if (seen.has(o.id)) return false;
    seen.add(o.id);
    return true;
  });
}

/**
 * Parse a kind 38000 ₿AO MARKETS market definition event.
 *
 * Handles:
 * - JSON content with title/description/outcomes
 * - Fallback to the `data` tag for SMJ-style markets
 * - Category/state/type/end tags or content fields
 */
export function parseBaoMarket(event: NostrEvent): BaoMarket | null {
  if (event.kind !== BAO_MARKET_KIND) return null;

  try {
    if (!verifyEvent(event)) return null;
  } catch {
    return null;
  }

  const tags = event.tags ?? [];
  const getTag = (name: string): string | undefined =>
    tags.find((t) => t[0] === name)?.[1];
  const getTagAll = (name: string): string[] =>
    tags.filter((t) => t[0] === name).map((t) => t[1]);

  let content: Record<string, unknown> = {};
  try {
    if (event.content) {
      content = JSON.parse(event.content) as Record<string, unknown>;
    }
  } catch {
    const dataTag = tags.find((t) => t[0] === "data")?.[1];
    if (dataTag) {
      try {
        content = JSON.parse(dataTag) as Record<string, unknown>;
      } catch {
        return null;
      }
    } else {
      return null;
    }
  }

  const title =
    sanitizeSingleLine(
      String(content.title || getTag("title") || ""),
      200,
    ) || undefined;
  if (!title) {
    console.warn("[baoMarketParser] skipping market with no title", event.id);
    return null;
  }

  const description = sanitizeSingleLine(
    String(content.description || ""),
    5000,
  );

  let outcomes: BaoMarketOutcome[] = parseOutcomes(
    Array.isArray(content.outcomes) ? content.outcomes : [],
  );

  if (outcomes.length === 0) {
    const outcomeTags = getTagAll("outcome");
    outcomes = outcomeTags.map((label, idx) => ({
      id: `outcome_${idx}`,
      label: sanitizeSingleLine(label, 100),
      probability: outcomeTags.length > 0 ? 1 / outcomeTags.length : 0.5,
    }));
  }

  if (outcomes.length === 0) {
    outcomes = [
      { id: "yes", label: "YES", probability: 0.5 },
      { id: "no", label: "NO", probability: 0.5 },
    ];
  }

  const category = String(
    getTag("category") || getTag("c") || content.category || "world",
  ).toLowerCase();

  const state = String(
    getTag("state") || getTag("s") || content.state || "active",
  ).toLowerCase();

  const rawType = String(
    getTag("type") || getTag("w") || content.type || "",
  ).toLowerCase();

  let type: BaoMarket["type"] = "binary";
  if (rawType === "categorical" || rawType === "scalar") {
    type = rawType;
  } else if (outcomes.length > 2) {
    type = "categorical";
  }

  let endTime = 0;
  const rawEnd = getTag("end") || content.endTime;
  if (typeof rawEnd === "number") {
    endTime = rawEnd > 1e12 ? Math.floor(rawEnd / 1000) : rawEnd;
  } else if (typeof rawEnd === "string") {
    const parsed = parseInt(rawEnd, 10);
    if (!Number.isNaN(parsed)) endTime = parsed > 1e12 ? Math.floor(parsed / 1000) : parsed;
  } else if (typeof content.endDate === "number") {
    endTime = Math.floor(content.endDate / 1000);
  }

  return {
    marketId: getTag("d") || event.id,
    title,
    description,
    category,
    state,
    type,
    endTime,
    createdAt: event.created_at,
    outcomes,
    creatorPubkey: event.pubkey,
    rawEvent: event,
  };
}
