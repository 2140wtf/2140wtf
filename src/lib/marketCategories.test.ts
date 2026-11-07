import { describe, expect, it } from 'vitest';

import {
  isAgenticMarketCategory,
  isPickerMarketCategory,
  isSelectableMarketCategory,
  marketRowCategory,
} from './marketCategories';

/** The four slugs GET /v1/categories serves today (plus the silo forms). */
const LIVE_CATALOGUE = ['fundraiser', 'crypto', 'btc-price', 'politics-us'];

describe('marketRowCategory', () => {
  it('translates the fundraiser union alias to the angor rows it returns', () => {
    // ?category=fundraiser expands to m.category IN ('fundraiser','angor','bao-fund');
    // the rows themselves carry 'angor'.
    expect(marketRowCategory('fundraiser')).toBe('angor');
  });

  it('leaves real row categories untouched', () => {
    for (const slug of ['angor', 'crypto', 'btc-price', 'politics-us', 'bao-fund']) {
      expect(marketRowCategory(slug)).toBe(slug);
    }
  });
});

describe('picker vs creator policy', () => {
  it('offers every live catalogue slug as a chip', () => {
    for (const slug of LIVE_CATALOGUE) {
      expect(isPickerMarketCategory(slug)).toBe(true);
    }
  });

  it('hides the BAO Fund / agentic silo from both', () => {
    for (const slug of ['bao-fund', 'agentic']) {
      expect(isAgenticMarketCategory(slug)).toBe(true);
      expect(isPickerMarketCategory(slug)).toBe(false);
      expect(isSelectableMarketCategory(slug)).toBe(false);
    }
  });

  it('never lets creation file a market under the union alias', () => {
    expect(isSelectableMarketCategory('fundraiser')).toBe(false);
    expect(isSelectableMarketCategory('angor')).toBe(true);
    expect(isSelectableMarketCategory(undefined)).toBe(false);
  });

  it('selects angor rows once the chip is translated', () => {
    const rows = [
      { category: 'angor' },
      { category: 'crypto' },
      { category: 'bao-fund' },
    ];
    const chip = marketRowCategory('fundraiser');
    expect(rows.filter((r) => r.category === chip)).toEqual([{ category: 'angor' }]);
  });
});
