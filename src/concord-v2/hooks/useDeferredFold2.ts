import { useEffect, useRef, useState } from "react";

import { encode, readFolded, writeFolded } from "@/lib/foldedCache";

/**
 * Process-lifetime memory of the last live fold per key. Seeds `restored`
 * SYNCHRONOUSLY when a key comes back into view (e.g. cycling between
 * communities), so the panel repaints the correct, already-computed fold in the
 * same frame instead of blanking to `undefined` while the IndexedDB snapshot
 * reloads after paint — which reads as a flash of empty channels. Keyed by the
 * community-scoped fold key, so it can only ever return THIS key's own value
 * (no cross-community leak). Untyped by necessity (one cache across all fold
 * types); each caller only ever reads back the type it wrote for its key.
 */
const memCache = new Map<string, unknown>();

/**
 * Compute a heavy synchronous Concord fold (roster / metadata / banlist) WITHOUT
 * blocking the render-critical path, and persist/restore it across reloads.
 *
 * The folds (`foldRoster`/`foldMetadata`/`foldBanlist`) decrypt + Schnorr-verify
 * every control edition (up to 500) and were previously run inside a `useMemo`,
 * i.e. synchronously DURING render on every mount/refresh. On a community with a
 * large control history that synchronous burst starves the first paint — the
 * channel's loading skeleton sits while the main thread verifies the whole
 * control plane.
 *
 * This hook moves the fold OFF the render path: it schedules the `compute` thunk
 * after paint (microtask / next tick) so React can commit and the browser can
 * paint the cached UI first, then the fold runs and updates state. Combined with
 * the persisted snapshot (painted immediately on reload), the heavy work never
 * gates the first frame. The decode/verify itself is already memoized per
 * edition id (see `control.ts`), so subsequent recomputes are cheap.
 *
 * `key` namespaces the persisted snapshot (e.g. `roster:<cid>`). `compute`
 * returns the freshly-folded value (or `undefined` when inputs aren't ready).
 * `deps` is the dependency list that should trigger a recompute (the shared
 * control events, the community, any upstream fold). Returns the value to
 * render: the live fold when computed, else the persisted snapshot.
 */
export function useDeferredFold<T>(
  key: string | null,
  compute: () => T | undefined,
  deps: unknown[],
): T | undefined {
  const [live, setLive] = useState<T | undefined>(undefined);
  // Seed the initial snapshot from the in-memory cache so a fresh mount of a
  // key we've folded before this session (e.g. a cross-pattern remount back
  // into a community) paints its channels/title immediately, not blank.
  const [restored, setRestored] = useState<T | undefined>(() =>
    key ? (memCache.get(key) as T | undefined) : undefined,
  );
  const lastWritten = useRef<string | undefined>(undefined);
  // Keep the latest `compute` without making it a scheduling dependency.
  const computeRef = useRef(compute);
  computeRef.current = compute;

  // Reset synchronously (during render) the moment the key changes, so one
  // community's fold can NEVER render — or persist — under another community's
  // key. Without this, switching A → B keeps A's `live` fold on screen until
  // B's deferred recompute lands, and if B's compute returns undefined (its
  // control events haven't loaded) while B has no persisted snapshot, the hook
  // would fall back to A's stale `restored` — leaking A's roster/metadata/
  // banlist into B (and letting A's ban set moderate B's messages).
  //
  // Seed `restored` from the in-memory cache for the NEW key (not the old one)
  // so a key we've already folded this session repaints its own channels/title
  // in the same frame — no empty flash while its IndexedDB snapshot reloads.
  const [prevKey, setPrevKey] = useState(key);
  if (prevKey !== key) {
    setPrevKey(key);
    setLive(undefined);
    setRestored(key ? (memCache.get(key) as T | undefined) : undefined);
    lastWritten.current = undefined;
  }

  // Restore the persisted snapshot once per key so the UI paints from cache.
  useEffect(() => {
    if (!key) {
      setRestored(undefined);
      return;
    }
    let cancelled = false;
    void readFolded<T>(key).then((v) => {
      if (!cancelled && v !== undefined) setRestored(v);
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  // Recompute the live fold AFTER paint, not during render. `requestIdleCallback`
  // (falling back to a macrotask) lets React commit + the browser paint the
  // cached UI before the verify-heavy fold runs. `key` is included so a key
  // change always reschedules a compute even if the caller's deps happen to be
  // referentially stable across the switch.
  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      setLive(computeRef.current());
    };
    const handle =
      typeof requestIdleCallback === "function"
        ? requestIdleCallback(run, { timeout: 200 })
        : (setTimeout(run, 0) as unknown as number);
    return () => {
      cancelled = true;
      if (typeof cancelIdleCallback === "function") cancelIdleCallback(handle);
      else clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ...deps]);

  // Persist the live fold whenever its CONTENT changes (best-effort).
  useEffect(() => {
    if (!key || live === undefined) return;
    // Keep the in-memory cache hot so cycling back to this key repaints
    // synchronously (see the key-change seed above).
    memCache.set(key, live);
    const serialized = encode(live);
    if (serialized === lastWritten.current) return;
    lastWritten.current = serialized;
    void writeFolded(key, live);
  }, [key, live]);

  return live ?? restored;
}
