import { describe, expect, it } from 'vitest';
import { normalizeFeedTabLayout } from './useFeedTabLayout';

describe('normalizeFeedTabLayout', () => {
  const available = ['follows', 'app', 'all', 'bitcoin'];

  it('uses the requested Follows-first default order', () => {
    expect(normalizeFeedTabLayout(null, available)).toEqual({ order: available, hidden: [] });
  });

  it('keeps user ordering, drops stale tabs, and adds newly available tabs', () => {
    expect(normalizeFeedTabLayout({
      order: ['bitcoin', 'removed', 'follows'],
      hidden: ['app', 'removed'],
    }, available)).toEqual({
      order: ['bitcoin', 'follows', 'app', 'all'],
      hidden: ['app'],
    });
  });

  it('refuses a layout that hides every feed', () => {
    expect(normalizeFeedTabLayout({ order: available, hidden: available }, available).hidden).toEqual([]);
  });
});
