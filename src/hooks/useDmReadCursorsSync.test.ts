import { describe, it, expect } from 'vitest';

import { mergeCursors, cursorsEqual } from './useDmReadCursorsSync';

describe('DM cursor sync helpers', () => {
  describe('mergeCursors', () => {
    it('returns local cursors when remote is undefined', () => {
      const local = { a: 10 };
      expect(mergeCursors(local, undefined)).toBe(local);
    });

    it('merges remote cursors that are newer than local', () => {
      const local = { a: 10, b: 20 };
      const remote = { a: 15, c: 5 };
      expect(mergeCursors(local, remote)).toEqual({ a: 15, b: 20, c: 5 });
    });

    it('ignores remote cursors that are older than local', () => {
      const local = { a: 20 };
      const remote = { a: 10 };
      expect(mergeCursors(local, remote)).toBe(local);
    });
  });

  describe('cursorsEqual', () => {
    it('returns true for identical cursors', () => {
      expect(cursorsEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
    });

    it('returns false for different values', () => {
      expect(cursorsEqual({ a: 1 }, { a: 2 })).toBe(false);
    });

    it('returns false for different keys', () => {
      expect(cursorsEqual({ a: 1 }, { b: 1 })).toBe(false);
    });

    it('treats empty objects as equal', () => {
      expect(cursorsEqual({}, {})).toBe(true);
    });
  });
});
