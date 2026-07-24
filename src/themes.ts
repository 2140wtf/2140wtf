import type { Theme } from '@/contexts/AppContext';
import { deriveTokensFromCore } from '@/lib/colorUtils';

/**
 * The 3 core colors that define a theme.
 * All other Tailwind tokens are derived automatically from these.
 */
export interface CoreThemeColors {
  /** Background color (HSL string, e.g. "228 20% 10%") */
  background: string;
  /** Text/foreground color */
  text: string;
  /** Primary accent color (buttons, links, focus rings) */
  primary: string;
}

// ─── Font Types ───────────────────────────────────────────────────────

/** A font reference: family name + optional URL (URL required on Nostr events, optional locally for bundled fonts). */
export interface ThemeFont {
  /** CSS font-family name, e.g. "Playfair Display" */
  family: string;
  /** Direct URL to a font file (.woff2, .ttf, .otf). Required on Nostr events, optional locally. */
  url?: string;
}

// ─── Background Types ─────────────────────────────────────────────────

/** Background image/video configuration. */
export interface ThemeBackground {
  /** URL to an image or video file */
  url: string;
  /** Display mode */
  mode?: 'cover' | 'tile';
  /** Dimensions as "widthxheight", e.g. "1920x1080" */
  dimensions?: string;
  /** MIME type, e.g. "image/jpeg" */
  mimeType?: string;
  /** Blurhash placeholder for progressive loading */
  blurhash?: string;
}

// ─── ThemeConfig ──────────────────────────────────────────────────────

/**
 * Complete theme configuration. Wraps CoreThemeColors with optional
 * font and background settings. This is the canonical type stored in
 * AppConfig.customTheme, EncryptedSettings, and theme events.
 */
export interface ThemeConfig {
  /** Theme name (stored locally AND on events) */
  title?: string;
  /** The 3 core colors */
  colors: CoreThemeColors;
  /** Optional custom font (applies globally to all text) */
  font?: ThemeFont;
  /** Optional title/header font (applies to profile display name) */
  titleFont?: ThemeFont;
  /** Optional background media */
  background?: ThemeBackground;
  /** Advanced token overrides (card, secondary, muted, accent, border, etc.) */
  tokens?: Partial<ThemeTokens>;
  /** Global border radius (CSS length, e.g. "0.75rem") */
  radius?: string;
  /** Background image opacity (0-1) */
  backgroundOpacity?: number;
}

/**
 * Configured light and dark themes. When set in AppConfig,
 * these override the builtin themes for "light" and "dark" modes.
 */
export interface ThemesConfig {
  /** Theme config applied when theme resolves to "light". */
  light: ThemeConfig;
  /** Theme config applied when theme resolves to "dark". */
  dark: ThemeConfig;
}

/**
 * Full set of CSS token values used internally by Tailwind.
 * These are derived from CoreThemeColors via deriveTokensFromCore().
 */
export interface ThemeTokens {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  destructiveForeground: string;
  border: string;
  input: string;
  ring: string;
}

/**
 * Builtin themes whose colors are defined at build time.
 * Self-hosters can customize these values before building.
 */
export const builtinThemes: Record<'light' | 'dark', CoreThemeColors> = {
  light: {
    background: '270 50% 97%',
    text: '270 25% 12%',
    primary: '270 65% 55%',
  },

  dark: {
    background: '228 20% 10%',
    text: '210 40% 98%',
    primary: '258 70% 60%',
  },
};

/** Metadata for a theme preset. */
export interface ThemePreset {
  /** Display label. */
  label: string;
  /** Emoji shown in compact theme pickers (dropdowns, cycle buttons). */
  emoji: string;
  /** Whether to show in compact pickers (sidebar dropdown, mobile drawer). All presets appear in settings. */
  featured?: boolean;
  /** The 3 core colors. */
  colors: CoreThemeColors;
  /** Optional custom font for this preset. */
  font?: ThemeFont;
  /** Optional title/header font for this preset. */
  titleFont?: ThemeFont;
  /** Optional background for this preset. */
  background?: ThemeBackground;
  /** Advanced token overrides for this preset. */
  tokens?: Partial<ThemeTokens>;
  /** Global border radius for this preset. */
  radius?: string;
  /** Background image opacity for this preset (0-1). */
  backgroundOpacity?: number;
}

/**
 * Custom theme presets. Clicking a preset sets theme to "custom"
 * and applies the preset's core color values to customTheme.
 */
export const themePresets: Record<string, ThemePreset> = {
  pink: {
    label: 'Pink',
    emoji: '🌸',
    featured: true,
    colors: {
      background: '330 100% 96%',
      text: '330 30% 10%',
      primary: '330 90% 60%',
    },
    font: { family: 'Comfortaa' },
    background: {
      url: 'https://blossom.ditto.pub/2c9d4fe206f39b81655eab559998a89e1dca12f4db81c10fd8f472c69fe9c68a.jpeg',
      mode: 'cover',
      mimeType: 'image/jpeg',
    },
  },

  sunset: {
    label: 'Sunset',
    emoji: '🌅',
    featured: true,
    colors: {
      background: '20 40% 96%',
      text: '15 30% 12%',
      primary: '15 85% 55%',
    },
    font: { family: 'Lora' },
  },

  hacker: {
    label: 'Hacker',
    emoji: '>',
    featured: true,
    colors: {
      background: '0 0% 0%',
      text: '120 80% 55%',
      primary: '120 90% 45%',
    },
    font: { family: 'JetBrains Mono' },
    radius: '0',
  },

  space: {
    label: 'Space',
    emoji: '🚀',
    featured: true,
    colors: {
      background: '240 40% 5%',
      text: '220 30% 95%',
      primary: '260 80% 65%',
    },
    font: { family: 'Outfit' },
    background: {
      url: '/themes/space.png',
      mode: 'cover',
      mimeType: 'image/png',
      dimensions: '1920x1080',
    },
    backgroundOpacity: 0.2,
  },

  whitepaper: {
    label: 'Whitepaper',
    emoji: '📰',
    featured: true,
    colors: {
      background: '45 20% 96%',
      text: '40 40% 10%',
      primary: '40 10% 15%',
    },
    font: { family: 'Lora' },
    titleFont: { family: 'Playfair Display' },
    radius: '0',
    tokens: {
      card: '45 15% 94%',
      cardForeground: '40 40% 10%',
      popover: '45 15% 94%',
      popoverForeground: '40 40% 10%',
      muted: '40 15% 90%',
      mutedForeground: '40 15% 40%',
      border: '40 20% 80%',
      input: '40 20% 85%',
      ring: '40 10% 15%',
    },
  },

  banana: {
    label: 'Banana',
    emoji: '🍌',
    featured: true,
    colors: {
      background: '45 90% 75%',
      text: '30 40% 15%',
      primary: '25 60% 25%',
    },
    font: { family: 'Comic Relief' },
    background: {
      url: '/themes/banana.png',
      mode: 'cover',
      mimeType: 'image/png',
      dimensions: '1920x1080',
    },
    backgroundOpacity: 0.25,
  },
};

/** The default whitepaper preset, used as the app-wide default theme. */
export const whitepaperPreset: ThemePreset = themePresets.whitepaper;

/** The default sunset preset, used as the app-wide default theme. */
export const sunsetPreset: ThemePreset = themePresets.sunset;

/** Converts a camelCase key to a CSS custom property name, e.g. primaryForeground → --primary-foreground */
export function toThemeVar(key: string): string {
  return `--${key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`;
}

/** Builds a CSS :root block string from a ThemeTokens object */
export function buildThemeCss(tokens: ThemeTokens): string {
  const vars = (Object.entries(tokens) as [string, string][])
    .map(([k, v]) => `${toThemeVar(k)}: ${v};`)
    .join(' ');
  return `:root { ${vars} }`;
}

/** Derive full ThemeTokens from CoreThemeColors, optionally overriding derived tokens. */
export function coreToTokens(colors: CoreThemeColors, tokens?: Partial<ThemeTokens>): ThemeTokens {
  const derived = deriveTokensFromCore(colors.background, colors.text, colors.primary);
  return tokens ? { ...derived, ...tokens } : derived;
}

/** Build CSS from CoreThemeColors (convenience) */
export function buildThemeCssFromCore(colors: CoreThemeColors, tokens?: Partial<ThemeTokens>): string {
  return buildThemeCss(coreToTokens(colors, tokens));
}

/**
 * Build a React `style` object of CSS custom properties from core theme
 * colors (₿AO chat: tints a profile preview card with the author's Ditto
 * theme). Keys are `--…` custom-property names.
 */
export function buildThemeVarStyle(colors: CoreThemeColors): Record<string, string> {
  const tokens = coreToTokens(colors);
  const style: Record<string, string> = {};
  for (const key of Object.keys(tokens) as Array<keyof ThemeTokens>) {
    style[toThemeVar(key)] = tokens[key];
  }
  return style;
}

/** Build CSS from a full ThemeConfig, including advanced tokens and radius. */
export function buildThemeCssFromConfig(config: ThemeConfig): string {
  const tokens = coreToTokens(config.colors, config.tokens);
  let css = buildThemeCss(tokens);
  if (config.radius) {
    css = css.replace(/\}\s*$/, ` --radius: ${config.radius}; }`);
  }
  return css;
}

/**
 * Resolves a theme preference to the concrete builtin theme name.
 * - "system" → "light" or "dark" based on OS preference.
 * - "custom" → returns "custom" (caller must supply colors from config.customTheme).
 * - "light" / "dark" → returned as-is.
 */
export function resolveTheme(theme: Theme): 'light' | 'dark' | 'custom' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}

/**
 * Resolves the effective ThemeConfig for a "light" or "dark" mode.
 * Uses configured themes from AppConfig if available, otherwise falls back
 * to the builtin themes (colors only, no font/background).
 */
export function resolveThemeConfig(mode: 'light' | 'dark', themes?: ThemesConfig): ThemeConfig {
  return themes?.[mode] ?? { colors: builtinThemes[mode] };
}
