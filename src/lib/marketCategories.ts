/**
 * Market-category policy shared by the catalogue picker and the create dialog.
 *
 * The API's `GET /v1/categories` is the authority for which slugs the markets
 * page can filter by. Three families need different treatment:
 *
 *  - `bao-fund` / `agentic` — the ₿AO Fund milestone silo. Canonical
 *    bao.markets hides these rows from the grid (`isAgenticCategory`) and
 *    surfaces one project card per campaign on the Fund page instead. Never a
 *    chip, never a creation choice.
 *  - `fundraiser` — the server-side *union alias* behind the Angor silo
 *    (`?category=fundraiser` expands to
 *    `m.category IN ('fundraiser','angor','bao-fund')` in packages/api
 *    `pgGetMarkets`). The catalogue reports the Angor markets under this slug
 *    while the rows themselves carry `angor`, so the picker shows it as an
 *    Angor chip and filters on the row category — but creation must never file
 *    a market under it.
 */
export const AGENTIC_MARKET_CATEGORIES = ['bao-fund', 'agentic'] as const;

/** Aliases that exist only in the query API, never on a market row. */
export const QUERY_ALIAS_MARKET_CATEGORIES = ['fundraiser'] as const;

/**
 * Catalogue slug → the category stored on the rows it returns.
 *
 * A chip labelled with the catalogue slug would filter the loaded rows on
 * `fundraiser` and match nothing, because every Angor market carries
 * `category: 'angor'`. Translating the slug to the row category is what makes
 * the Angor chip select its 10 markets.
 */
export const CATALOGUE_SLUG_ROW_CATEGORY: Record<string, string> = {
  fundraiser: 'angor',
};

/** Row category a catalogue slug selects, for client-side filtering. */
export function marketRowCategory(catalogueSlug: string): string {
  return CATALOGUE_SLUG_ROW_CATEGORY[catalogueSlug] ?? catalogueSlug;
}

/** True for categories in the ₿AO Fund / agentic silo. */
export function isAgenticMarketCategory(category: string | undefined): boolean {
  if (!category) return false;
  return (AGENTIC_MARKET_CATEGORIES as readonly string[]).includes(category);
}

/** True when a catalogue slug may be shown as a picker chip (aliases allowed). */
export function isPickerMarketCategory(slug: string | undefined): boolean {
  if (!slug) return false;
  return !isAgenticMarketCategory(slug);
}

/** True when a catalogue slug may be offered as a creation choice. */
export function isSelectableMarketCategory(slug: string | undefined): boolean {
  if (!slug) return false;
  return isPickerMarketCategory(slug) &&
    !(QUERY_ALIAS_MARKET_CATEGORIES as readonly string[]).includes(slug);
}
