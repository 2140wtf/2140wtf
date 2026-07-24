/**
 * Cross-component coordinator for chat audio (voice note) playback.
 *
 * Each `AudioMessage` mounts its own independent `<audio>` element with no
 * shared state, so there was previously no way to (a) stop one voice note when
 * another starts, or (b) continue to the *next* voice note when one finishes.
 *
 * This module is a tiny process-wide registry that keeps track of every mounted
 * audio player. It provides two behaviours:
 *
 *  - single-playback: starting one player pauses all others, and
 *  - auto-advance: when a player finishes, the next player in document order
 *    starts playing automatically (so a thread of voice notes plays through).
 *
 * "Next in document order" is resolved via `compareDocumentPosition`, so it
 * naturally follows the on-screen order of messages regardless of React tree
 * shape, and gracefully ignores players that have since unmounted.
 */

interface AudioEntry {
  /** The underlying media element (may be null while unmounted). */
  readonly el: HTMLAudioElement | null;
  /** Start playback of this entry (resolves the src + calls play()). */
  play: () => void;
}

const entries = new Set<AudioEntry>();

/** Register a player. Returns an unregister function for cleanup. */
export function registerAudioPlayer(entry: AudioEntry): () => void {
  entries.add(entry);
  return () => {
    entries.delete(entry);
  };
}

/**
 * Pause every registered player except `except`. Called when a player starts so
 * only one voice note plays at a time.
 */
export function pauseOthers(except: HTMLAudioElement): void {
  for (const entry of entries) {
    if (entry.el && entry.el !== except && !entry.el.paused) {
      entry.el.pause();
    }
  }
}

/**
 * Start the next player after `current` in document order, if any. Called when a
 * voice note finishes so the thread keeps playing. Skips the current element and
 * any that precede it; picks the closest following one.
 */
export function playNextAfter(current: HTMLAudioElement): void {
  let next: AudioEntry | undefined;
  for (const entry of entries) {
    if (!entry.el || entry.el === current) continue;
    // DOCUMENT_POSITION_FOLLOWING: entry.el comes after `current`.
    const following =
      (current.compareDocumentPosition(entry.el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    if (!following) continue;
    if (
      !next ||
      !next.el ||
      (entry.el.compareDocumentPosition(next.el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    ) {
      // `entry` follows `current` and precedes the current best `next`.
      next = entry;
    }
  }
  next?.play();
}
