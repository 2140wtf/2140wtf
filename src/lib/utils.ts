import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Parse a kindFilter string into an array of kind numbers.
 * Supports:
 * - 'all' → undefined (no override)
 * - 'custom' → parse customKindText as comma/space-separated numbers
 * - Single kind number (e.g. '1') → [1]
 * - Comma-separated kind numbers (e.g. '1,30023,20') → [1, 30023, 20]
 */
export function parseKindFilter(kindFilter: string, customKindText?: string): number[] | undefined {
  if (kindFilter === 'all' || kindFilter === '') return undefined;
  if (kindFilter === 'custom') {
    if (!customKindText) return undefined;
    const parsed = customKindText.trim().split(/[\s,]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0);
    return parsed.length > 0 ? parsed : undefined;
  }
  // Comma-separated or single value
  const parsed = kindFilter.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return parsed.length > 0 ? parsed : undefined;
}

/**
 * Format a number in compact English notation.
 * Examples:
 *   1,200 → "1.2K"
 *   15,400 → "15.4K"
 *   1,200,000 → "1.2M"
 *   999 → "999"
 * 
 * Uses Intl.NumberFormat for locale-consistent formatting.
 */
export function formatCompactNumber(num: number): string {
  if (num < 1000) {
    return num.toString();
  }
  
  const formatter = new Intl.NumberFormat('en', {
    notation: 'compact',
    compactDisplay: 'short',
    maximumFractionDigits: 1,
  });
  
  return formatter.format(num);
}

/**
 * Pick the channel to show when none is selected: the stored last-visited id
 * when it still exists, else the "general" channel, else the first. Shared by
 * the ₿AO community page.
 */
export function pickDefaultChannel<T>(
  channels: readonly T[],
  storedId: string | undefined,
  idOf: (c: T) => string,
  nameOf: (c: T) => string,
): T | undefined {
  if (channels.length === 0) return undefined;
  if (storedId) {
    const stored = channels.find((c) => idOf(c) === storedId);
    if (stored) return stored;
  }
  const general = channels.find((c) => nameOf(c).trim().toLowerCase() === "general");
  return general ?? channels[0];
}
