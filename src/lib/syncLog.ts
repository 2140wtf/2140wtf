/**
 * Dev-only timestamped trace of the Concord/community sync pipeline: gate
 * phases, community-list seeding, stream-key registration, NIP-42 challenges
 * and socket bounces, plane sweeps (per relay, with cursors and counts), and
 * control folds. For hunting "why is my community empty / slow to populate".
 *
 * Toggle at runtime with `localStorage.debugSync = '1'` (or `'0'` to silence);
 * defaults on in dev builds. Timestamps are seconds since page load so a
 * pasted log reads as a timeline.
 */

const t0 = Date.now();

function enabled(): boolean {
  try {
    const v = localStorage.getItem("debugSync");
    if (v === "1" || v === "true") return true;
    if (v === "0" || v === "false") return false;
  } catch {
    /* localStorage may be unavailable */
  }
  return import.meta.env?.DEV ?? false;
}

/** One timeline line: `[sync +12.34s] tag — message {data}`. */
export function logSync(tag: string, message: string, data?: unknown): void {
  if (!enabled()) return;
  const t = ((Date.now() - t0) / 1000).toFixed(2);
  if (data === undefined) {
    console.log(`%c[sync +${t}s]%c ${tag} — ${message}`, "color:#c586ff;font-weight:bold", "color:inherit");
  } else {
    console.log(
      `%c[sync +${t}s]%c ${tag} — ${message}`,
      "color:#c586ff;font-weight:bold",
      "color:inherit",
      data,
    );
  }
}

/** Milliseconds elapsed since `start` (a `Date.now()` sample), for log lines. */
export function sinceMs(start: number): string {
  return `${Date.now() - start}ms`;
}
