import { describe, expect, it } from 'vitest';
import { parseEvolutionContent, parseProfileContent } from './missions';

describe('parseEvolutionContent', () => {
  it('returns an empty array for empty content', () => {
    expect(parseEvolutionContent('')).toEqual([]);
    expect(parseEvolutionContent('   ')).toEqual([]);
  });

  it('returns an empty array for non-JSON content', () => {
    expect(parseEvolutionContent('Luna is an egg Pets.')).toEqual([]);
  });

  it('returns an empty array for non-object JSON', () => {
    expect(parseEvolutionContent('[]')).toEqual([]);
    expect(parseEvolutionContent('"string"')).toEqual([]);
    expect(parseEvolutionContent('123')).toEqual([]);
  });

  it('parses valid evolution missions', () => {
    const content = JSON.stringify({
      evolution: [
        { id: 'interactions', target: 7, count: 3 },
        { id: 'create_theme', target: 1, events: ['abc123'] },
      ],
    });
    expect(parseEvolutionContent(content)).toEqual([
      { id: 'interactions', target: 7, count: 3 },
      { id: 'create_theme', target: 1, events: ['abc123'] },
    ]);
  });

  it('drops malformed mission entries but keeps valid ones', () => {
    const content = JSON.stringify({
      evolution: [
        { id: 'interactions', target: 7, count: 3 },
        { id: 'missing_target' },
        { target: 5, count: 1 },
        { id: 'create_theme', target: 1, events: ['abc123'] },
        'not-an-object',
      ],
    });
    expect(parseEvolutionContent(content)).toEqual([
      { id: 'interactions', target: 7, count: 3 },
      { id: 'create_theme', target: 1, events: ['abc123'] },
    ]);
  });

  it('sanitizes invalid targets and counts', () => {
    const content = JSON.stringify({
      evolution: [
        { id: 'interactions', target: -3, count: -2 },
        { id: 'create_theme', target: 1.7, events: ['abc', 123, 'def'] },
      ],
    });
    expect(parseEvolutionContent(content)).toEqual([
      { id: 'interactions', target: 1, count: 0 },
      { id: 'create_theme', target: 1, events: ['abc', 'def'] },
    ]);
  });

  it('preserves unknown top-level keys in the raw object', () => {
    const content = JSON.stringify({
      unknownKey: 'kept',
      evolution: [{ id: 'interactions', target: 7, count: 0 }],
    });
    // parseEvolutionContent only returns the evolution array; unknown keys are ignored.
    expect(parseEvolutionContent(content)).toEqual([
      { id: 'interactions', target: 7, count: 0 },
    ]);
  });
});

describe('parseProfileContent', () => {
  it('returns an empty object for empty or invalid content', () => {
    expect(parseProfileContent('')).toEqual({});
    expect(parseProfileContent('not json')).toEqual({});
    expect(parseProfileContent('[]')).toEqual({});
  });

  it('ignores missions with missing date', () => {
    const content = JSON.stringify({
      missions: {
        daily: [{ id: 'interact_3', target: 3, count: 0 }],
        rerolls: 2,
      },
    });
    expect(parseProfileContent(content)).toEqual({});
  });

  it('parses valid profile missions content', () => {
    const content = JSON.stringify({
      missions: {
        date: '2026-06-18',
        daily: [{ id: 'interact_3', target: 3, count: 1 }],
        rerolls: 2,
      },
    });
    expect(parseProfileContent(content)).toEqual({
      missions: {
        date: '2026-06-18',
        daily: [{ id: 'interact_3', target: 3, count: 1 }],
        rerolls: 2,
      },
    });
  });
});
