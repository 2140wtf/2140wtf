import { describe, expect, it } from 'vitest';
import {
  MAINNET_CASHU_MARKER,
  isMainnetCashu,
  markMainnetCashu,
  stripMainnetMarker,
} from './mainnetMarker';

describe('mainnetMarker', () => {
  it('marks and detects a mainnet campaign', () => {
    const d = markMainnetCashu('Fund my agent');
    expect(isMainnetCashu(d)).toBe(true);
    expect(d).toContain('Fund my agent');
    expect(d).toContain(MAINNET_CASHU_MARKER);
  });

  it('is idempotent', () => {
    const once = markMainnetCashu('x');
    expect(markMainnetCashu(once)).toBe(once);
  });

  it('strips the marker for display', () => {
    const d = markMainnetCashu('Hello world');
    expect(stripMainnetMarker(d)).toBe('Hello world');
  });

  it('handles empty descriptions', () => {
    expect(isMainnetCashu(markMainnetCashu(''))).toBe(true);
    expect(isMainnetCashu(undefined)).toBe(false);
    expect(isMainnetCashu('plain campaign')).toBe(false);
  });
});
