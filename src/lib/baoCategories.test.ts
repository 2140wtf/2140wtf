import { describe, expect, it } from 'vitest';

import { BAO_CATEGORIES, baoCategoryId, campaignChipId } from './baoCategories';

describe('campaignChipId', () => {
  it('maps the chosen subcategory to its chip', () => {
    expect(campaignChipId({ category: 'bao-fund', subcategory: 'research' })).toBe('research');
    expect(campaignChipId({ category: 'bao-fund', subcategory: 'mining' })).toBe('mining');
  });

  it('falls back to a legacy category that already held the chip id', () => {
    expect(campaignChipId({ category: 'tools', subcategory: null })).toBe('tools');
    expect(campaignChipId({ category: 'daos' })).toBe('baos');
  });

  it('puts silo-only rows on Other instead of a chip that cannot match', () => {
    expect(campaignChipId({ category: 'bao-fund', subcategory: null })).toBe('other');
    expect(campaignChipId({})).toBe('other');
  });

  it('normalises values no chip knows', () => {
    expect(campaignChipId({ subcategory: 'attestation' })).toBe('other');
    expect(campaignChipId({ subcategory: '  content  ' })).toBe('other');
  });

  it('only ever returns ids the Fund page renders as chips', () => {
    const chipIds = new Set<string>(BAO_CATEGORIES.map((c) => c.id));
    for (const value of ['research', 'tools', 'bao-fund', 'attestation', 'daos', '']) {
      expect(chipIds.has(campaignChipId({ category: 'bao-fund', subcategory: value }))).toBe(true);
    }
    expect(baoCategoryId('bao-fund')).toBe('other');
  });
});
