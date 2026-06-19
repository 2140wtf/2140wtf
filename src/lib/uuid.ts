/**
 * Generate a UUID v4-like string.
 *
 * Uses `crypto.randomUUID()` when available (secure contexts). Falls back to
 * `crypto.getRandomValues()` for environments where `randomUUID` is missing or
 * throws (non-secure HTTP, some test environments). As a last resort, uses
 * `Math.random()` so the caller can still produce an identifier.
 */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch {
      // Fall through to next option.
    }
  }

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    return Array.from(
      crypto.getRandomValues(new Uint8Array(16)),
      (b) => b.toString(16).padStart(2, '0'),
    ).join('');
  }

  // Last resort for very old or restricted environments.
  // This path uses Math.random() and is NOT suitable for key material.
  console.warn('generateUUID: crypto API unavailable; falling back to Math.random()');
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
