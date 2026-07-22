import { describe, expect, it } from 'vitest';
import {
  buildThemeCss,
  buildThemeCssFromConfig,
  buildThemeCssFromCore,
  coreToTokens,
  resolveTheme,
  themePresets,
  type CoreThemeColors,
  type ThemeConfig,
} from '@/themes';

describe('buildThemeCss', () => {
  it('produces a :root block with the given tokens', () => {
    const css = buildThemeCss({
      background: '0 0% 100%',
      foreground: '0 0% 0%',
      card: '0 0% 100%',
      cardForeground: '0 0% 0%',
      popover: '0 0% 100%',
      popoverForeground: '0 0% 0%',
      primary: '240 100% 50%',
      primaryForeground: '0 0% 100%',
      secondary: '0 0% 96%',
      secondaryForeground: '0 0% 0%',
      muted: '0 0% 96%',
      mutedForeground: '0 0% 45%',
      accent: '240 100% 50%',
      accentForeground: '0 0% 100%',
      destructive: '0 84% 60%',
      destructiveForeground: '0 0% 100%',
      border: '0 0% 90%',
      input: '0 0% 90%',
      ring: '240 100% 50%',
    });

    expect(css).toMatch(/^:root \{/);
    expect(css).toContain('--background: 0 0% 100%;');
    expect(css).toContain('--primary: 240 100% 50%;');
    expect(css).toContain('--ring: 240 100% 50%;');
  });
});

describe('coreToTokens', () => {
  const colors: CoreThemeColors = {
    background: '228 20% 10%',
    text: '210 40% 98%',
    primary: '258 70% 60%',
  };

  it('derives tokens from core colors', () => {
    const tokens = coreToTokens(colors);
    expect(tokens.background).toBe(colors.background);
    expect(tokens.foreground).toBe(colors.text);
    expect(tokens.primary).toBe(colors.primary);
    expect(tokens.accent).toBe(colors.primary);
  });

  it('applies token overrides', () => {
    const tokens = coreToTokens(colors, { card: '0 0% 20%', border: '0 0% 30%' });
    expect(tokens.card).toBe('0 0% 20%');
    expect(tokens.border).toBe('0 0% 30%');
    expect(tokens.background).toBe(colors.background);
  });
});

describe('buildThemeCssFromConfig', () => {
  it('includes radius in the CSS output', () => {
    const config: ThemeConfig = {
      colors: {
        background: '228 20% 10%',
        text: '210 40% 98%',
        primary: '258 70% 60%',
      },
      radius: '1rem',
    };
    const css = buildThemeCssFromConfig(config);
    expect(css).toContain('--radius: 1rem;');
  });

  it('merges advanced token overrides into the CSS', () => {
    const config: ThemeConfig = {
      colors: {
        background: '228 20% 10%',
        text: '210 40% 98%',
        primary: '258 70% 60%',
      },
      tokens: { card: '0 0% 15%', border: '0 0% 25%' },
    };
    const css = buildThemeCssFromConfig(config);
    expect(css).toContain('--card: 0 0% 15%;');
    expect(css).toContain('--border: 0 0% 25%;');
  });
});

describe('buildThemeCssFromCore', () => {
  it('builds CSS from core colors without overrides', () => {
    const colors: CoreThemeColors = {
      background: '228 20% 10%',
      text: '210 40% 98%',
      primary: '258 70% 60%',
    };
    const css = buildThemeCssFromCore(colors);
    expect(css).toContain('--background: 228 20% 10%;');
    expect(css).toContain('--foreground: 210 40% 98%;');
    expect(css).toContain('--primary: 258 70% 60%;');
  });
});

describe('resolveTheme', () => {
  it('returns light or dark for system based on OS preference', () => {
    const originalMatchMedia = window.matchMedia;
    try {
      window.matchMedia = (query: string) => ({
        matches: query === '(prefers-color-scheme: dark)',
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      } as unknown as MediaQueryList);

      expect(resolveTheme('system')).toBe('dark');
      window.matchMedia = (query: string) => ({
        matches: query !== '(prefers-color-scheme: dark)',
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      } as unknown as MediaQueryList);
      expect(resolveTheme('system')).toBe('light');
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it('passes light, dark, and custom through unchanged', () => {
    expect(resolveTheme('light')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
    expect(resolveTheme('custom')).toBe('custom');
  });
});

describe('themePresets', () => {
  it('includes the redesigned preset set', () => {
    expect(Object.keys(themePresets).sort()).toEqual(['banana', 'hacker', 'pink', 'space', 'sunset', 'whitepaper']);
  });

  it('includes generated background assets for presets that have one', () => {
    expect(themePresets.space.background?.url).toBe('/themes/space.png');
    expect(themePresets.banana.background?.url).toBe('/themes/banana.png');
  });
});
