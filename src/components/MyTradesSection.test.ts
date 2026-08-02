import { describe, expect, it } from 'vitest';

import { formatPositionPercentage } from '@/lib/baoPositionFormat';

describe('formatPositionPercentage', () => {
  it('formats finite market prices', () => {
    expect(formatPositionPercentage(0.55)).toBe('55%');
  });

  it('does not expose invalid API numbers as NaN%', () => {
    expect(formatPositionPercentage(Number.NaN)).toBe('—');
    expect(formatPositionPercentage(undefined)).toBe('—');
  });
});
