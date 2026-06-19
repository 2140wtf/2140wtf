import type { NostrEvent } from '@nostrify/nostrify';
import { sanitizeUrl } from '@/lib/sanitizeUrl';
import { sanitizeCssString } from '@/lib/fontLoader';

export const THEME_KIND = 36767;

/** Default stationery background color (parchment). */
export const DEFAULT_STATIONERY_COLOR = '#F5E6D3';

/**
 * Visual stationery for a card or theme-derived surface — the wire format.
 *
 * User-chosen fields live directly on this object. Event-derived fields
 * (colors, layout, imageUrl, textColor, etc.) are read from the source
 * `event` at render time via `resolveStationery()`. Old data that predates
 * this change may carry those fields as flat fallbacks.
 */
export interface Stationery {
  /** Background color (hex). Always present. */
  color: string;
  /** Emoji character for backsplash or emblem. */
  emoji?: string;
  /** Emoji display mode: 'tile' (faint repeating pattern) or 'emblem' (single large centered glyph). */
  emojiMode?: 'tile' | 'emblem';

  /** CSS font-family string (e.g. "Caveat, cursive"). Set from the user's font choice. */
  fontFamily?: string;
  /** Frame style ID. */
  frame?: FrameStyle;
  /** When true, color-shift the frame emojis to match the stationery palette. */
  frameTint?: boolean;
  /** Source Nostr event (kind 36767 theme). */
  event?: NostrEvent;

  // --- Legacy flat fallbacks (from old data, not set by new code) ---
  /** @deprecated Read from event tags instead. */
  textColor?: string;
  /** @deprecated Read from event tags instead. */
  primaryColor?: string;
  /** @deprecated Read from event tags instead. */
  layout?: string;
  /** @deprecated Read from event tags instead. */
  imageUrl?: string;
  /** @deprecated Read from event tags instead. */
  imageMode?: 'cover' | 'tile';
}

/** All rendering attributes for a stationery, fully resolved from event + fallbacks. */
export interface ResolvedStationery {
  color: string;
  textColor?: string;
  primaryColor?: string;
  emoji?: string;
  emojiMode: 'tile' | 'emblem';
  colors?: string[];
  layout?: string;
  imageUrl?: string;
  imageMode: 'cover' | 'tile';
  fontFamily?: string;
  frame?: FrameStyle;
  frameTint?: boolean;
  event?: NostrEvent;
}

/** Resolve a Stationery into full rendering attributes by reading event tags. */
export function resolveStationery(s: Stationery): ResolvedStationery {
  // Sanitize event-sourced font family before CSS interpolation (see SECURITY_AUDIT M-6).
  // Applied at the parse layer so every consumer gets a safe value.
  const safeFontFamily = s.fontFamily ? sanitizeCssString(s.fontFamily) : undefined;

  const base: ResolvedStationery = {
    color: s.color,
    emoji: s.emoji,
    emojiMode: s.emojiMode ?? 'tile',
    fontFamily: safeFontFamily,
    frame: s.frame,
    frameTint: s.frameTint,
    imageMode: 'cover',
    event: s.event,
  };

  const event = s.event;

  if (event?.kind === THEME_KIND) {
    const colorTags = event.tags.filter(([n]) => n === 'c');
    for (const [, hex, marker] of colorTags) {
      if (marker === 'text') base.textColor = hex;
      if (marker === 'primary') base.primaryColor = hex;
    }

    const bgTag = event.tags.find(([n]) => n === 'bg');
    if (bgTag) {
      for (const slot of bgTag.slice(1)) {
        // Sanitize event-sourced URL before CSS `url(...)` interpolation (H-2).
        if (slot.startsWith('url ')) base.imageUrl = sanitizeUrl(slot.slice(4));
        else if (slot === 'mode tile') base.imageMode = 'tile';
        else if (slot === 'mode cover') base.imageMode = 'cover';
      }
    }
    if (!base.imageUrl) {
      base.imageUrl = sanitizeUrl(event.tags.find(([n]) => n === 'image')?.[1]);
    }
    return base;
  }

  // No event or unknown kind — use legacy flat fallbacks (old presets).
  // Legacy `imageUrl` may carry user-supplied URLs from pre-sanitization data,
  // so sanitize here as well for defense-in-depth.
  base.textColor = s.textColor;
  base.primaryColor = s.primaryColor;
  base.layout = s.layout;
  base.imageUrl = sanitizeUrl(s.imageUrl);
  base.imageMode = s.imageMode ?? 'cover';
  return base;
}

/**
 * Frame style presets — combinable with any stationery.
 * Each frame uses the same emoji-scatter system with different emoji sets
 * and default background colors.
 */
export type FrameStyle =
  | 'none'
  | 'flowers'
  | 'autumn'
  | 'ocean'
  | 'celestial'
  | 'hearts'
  | 'garden'
  | 'winter'
  | 'fruit'
  | 'sparkle';

export interface FramePreset {
  id: FrameStyle;
  name: string;
  /** Emoji set for the border scatter */
  emojis?: string[];
  /** Default background color (before tint) */
  bgColor?: string;
}

export const FRAME_PRESETS: FramePreset[] = [
  { id: 'none', name: 'None' },
  { id: 'flowers', name: 'Flowers', emojis: ['🌸', '🌺', '🌼', '🌷', '🌻', '🌹'], bgColor: '#3a7a3a' },
  { id: 'autumn', name: 'Autumn', emojis: ['🍂', '🍁', '🍃', '🌾', '🍄', '🌰'], bgColor: '#8b5e3c' },
  { id: 'ocean', name: 'Ocean', emojis: ['🐚', '🌊', '🐠', '🐙', '🦀', '🐬'], bgColor: '#1a5276' },
  { id: 'celestial', name: 'Celestial', emojis: ['🪐', '🌙', '⭐', '🌕', '☄️', '🔭'], bgColor: '#1a1a3e' },
  { id: 'hearts', name: 'Hearts', emojis: ['❤️', '💕', '💗', '💖', '💝', '💘'], bgColor: '#8b2252' },
  { id: 'garden', name: 'Garden', emojis: ['🦋', '🐝', '🌿', '🌱', '🐞', '🍀'], bgColor: '#2d5a27' },
  { id: 'winter', name: 'Winter', emojis: ['❄️', '⛄', '🌨️', '🏔️', '🎿', '🧣'], bgColor: '#4a6d8c' },
  { id: 'fruit', name: 'Fruit', emojis: ['🍊', '🍋', '🍓', '🍑', '🍒', '🫐'], bgColor: '#6b4226' },
  { id: 'sparkle', name: 'Sparkle', emojis: ['✨', '💎', '🔮', '🪩', '⚡', '🌈'], bgColor: '#4a2d6b' },
];

/**
 * Serializable stationery for localStorage persistence.
 * NostrEvent is a plain JSON object, so it serializes fine.
 */
export type SerializableStationery = Stationery;

/** Build a Stationery from a kind 36767 theme event. */
export function themeToStationery(event: NostrEvent): Stationery {
  const bg = event.tags.filter(([n]) => n === 'c').find(([, , marker]) => marker === 'background');
  return { color: bg?.[1] ?? DEFAULT_STATIONERY_COLOR, event };
}
