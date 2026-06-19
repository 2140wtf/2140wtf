import { describe, expect, it } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import {
  ACTIVE_THEME_KIND,
  THEME_DEFINITION_KIND,
  buildActiveThemeTags,
  buildThemeDefinitionTags,
  parseActiveProfileTheme,
  parseThemeDefinition,
} from '@/lib/themeEvent';
import type { ThemeConfig } from '@/themes';

const baseConfig: ThemeConfig = {
  title: 'Test Theme',
  colors: {
    background: '228 20% 10%',
    text: '210 40% 98%',
    primary: '258 70% 60%',
  },
  font: { family: 'Inter' },
  background: {
    url: 'https://example.com/bg.png',
    mode: 'cover',
    mimeType: 'image/png',
  },
};

const advancedConfig: ThemeConfig = {
  ...baseConfig,
  tokens: {
    card: '230 20% 15%',
    border: '258 30% 30%',
  },
  radius: '1rem',
  backgroundOpacity: 0.35,
};

function eventWithTags(kind: number, tags: string[][]): NostrEvent {
  return {
    kind,
    id: '00'.repeat(32),
    pubkey: '11'.repeat(32),
    created_at: 1,
    tags,
    content: '',
    sig: 'ff'.repeat(64),
  };
}

/** Compare two arrays of tags regardless of order, optionally ignoring named tags. */
function expectTagsEqual(actual: string[][], expected: string[][], ignore?: string[]) {
  const filter = (tags: string[][]) =>
    ignore ? tags.filter((tag) => !ignore.includes(tag[0])) : tags;
  const sort = (tags: string[][]) =>
    filter([...tags]).map((tag) => JSON.stringify(tag)).sort();
  expect(sort(actual)).toEqual(sort(expected));
}

describe('buildThemeDefinitionTags / parseThemeDefinition', () => {
  it('round-trips a basic theme definition', () => {
    const tags = buildThemeDefinitionTags('test-theme', 'Test Theme', baseConfig, 'A test theme');
    const event = eventWithTags(THEME_DEFINITION_KIND, tags);
    const parsed = parseThemeDefinition(event);

    expect(parsed).not.toBeNull();
    expect(parsed!.identifier).toBe('test-theme');
    expect(parsed!.title).toBe('Test Theme');
    expect(parsed!.description).toBe('A test theme');

    const rebuilt = buildThemeDefinitionTags(parsed!.identifier, parsed!.title, {
      colors: parsed!.colors,
      font: parsed!.font,
      titleFont: parsed!.titleFont,
      background: parsed!.background,
    }, parsed!.description);
    expectTagsEqual(rebuilt, tags);
  });

  it('round-trips advanced tokens, radius, and background opacity', () => {
    const tags = buildThemeDefinitionTags('advanced', 'Advanced', advancedConfig);
    const event = eventWithTags(THEME_DEFINITION_KIND, tags);
    const parsed = parseThemeDefinition(event);

    expect(parsed).not.toBeNull();
    expect(parsed!.radius).toBe('1rem');
    expect(parsed!.backgroundOpacity).toBe(0.35);

    const rebuilt = buildThemeDefinitionTags(parsed!.identifier, parsed!.title, {
      colors: parsed!.colors,
      font: parsed!.font,
      titleFont: parsed!.titleFont,
      background: parsed!.background,
      tokens: parsed!.tokens,
      radius: parsed!.radius,
      backgroundOpacity: parsed!.backgroundOpacity,
    }, parsed!.description);
    expectTagsEqual(rebuilt, tags);
  });

  it('returns null for events missing required color tags', () => {
    const tags = [['d', 'incomplete'], ['title', 'Incomplete']];
    const event = eventWithTags(THEME_DEFINITION_KIND, tags);
    expect(parseThemeDefinition(event)).toBeNull();
  });

  it('falls back to legacy JSON content when color tags are absent', () => {
    const event: NostrEvent = {
      ...eventWithTags(THEME_DEFINITION_KIND, [['d', 'legacy'], ['title', 'Legacy']]),
      content: JSON.stringify(baseConfig.colors),
    };
    const parsed = parseThemeDefinition(event);
    expect(parsed).not.toBeNull();
    expect(parsed!.colors.text).toBe(baseConfig.colors.text);
  });
});

describe('buildActiveThemeTags / parseActiveProfileTheme', () => {
  it('round-trips an active profile theme', () => {
    const tags = buildActiveThemeTags(baseConfig);
    const event = eventWithTags(ACTIVE_THEME_KIND, tags);
    const parsed = parseActiveProfileTheme(event);

    expect(parsed).not.toBeNull();
    expect(parsed!.sourceRef).toBeUndefined();

    const rebuilt = buildActiveThemeTags({
      colors: parsed!.colors,
      font: parsed!.font,
      titleFont: parsed!.titleFont,
      background: parsed!.background,
    });
    expectTagsEqual(rebuilt, tags, ['title']);
  });

  it('round-trips advanced tokens and source reference', () => {
    const tags = buildActiveThemeTags(advancedConfig, 'author', 'source-id');
    const event = eventWithTags(ACTIVE_THEME_KIND, tags);
    const parsed = parseActiveProfileTheme(event);

    expect(parsed).not.toBeNull();
    expect(parsed!.radius).toBe('1rem');
    expect(parsed!.backgroundOpacity).toBe(0.35);
    expect(parsed!.sourceRef).toBe(`${THEME_DEFINITION_KIND}:author:source-id`);

    const rebuilt = buildActiveThemeTags({
      colors: parsed!.colors,
      font: parsed!.font,
      titleFont: parsed!.titleFont,
      background: parsed!.background,
      tokens: parsed!.tokens,
      radius: parsed!.radius,
      backgroundOpacity: parsed!.backgroundOpacity,
    }, 'author', 'source-id');
    expectTagsEqual(rebuilt, tags, ['title']);
  });
});
