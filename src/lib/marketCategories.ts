/**
 * Market-category policy shared by the catalogue picker and the create dialog.
 *
 * The API's `GET /v1/categories` is the authority for which slugs the markets
 * page can filter by. Two families must never be offered as creation choices
 * or picker chips:
 *
 *  - `bao-fund` / `agentic` — the ₿AO Fund milestone silo. Canonical
 *    bao.markets hides these rows from the grid (`isAgenticCategory`) and
 *    surfaces one project card per campaign on the Fund page instead.
 *  - `fundraiser` — the *query alias* the API uses for the angor/fund silo
 *    (`GET /v1/markets?category=fundraiser`). It is not a stored market
 *    category, so a chip for it can only ever return an empty grid.
 */
export const AGENTIC_MARKET_CATEGORIES = ['bao-fund', 'agentic'] as const;

/** Aliases that exist only in the query API, never on a market row. */
export const QUERY_ALIAS_MARKET_CATEGORIES = ['fundraiser'] as const;

/** True for categories in the ₿AO Fund / agentic silo. */
export function isAgenticMarketCategory(category: string | undefined): boolean {
  if (!category) return false;
  return (AGENTIC_MARKET_CATEGORIES as readonly string[]).includes(category);
}

/** True when a catalogue category may be shown in the picker or the creator. */
export function isSelectableMarketCategory(slug: string | undefined): boolean {
  if (!slug) return false;
  return !isAgenticMarketCategory(slug) &&
    !(QUERY_ALIAS_MARKET_CATEGORIES as readonly string[]).includes(slug);
}
