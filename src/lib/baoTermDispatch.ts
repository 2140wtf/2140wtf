/**
 * In-page ₿AO agent terminal — browser adapter over the shared engine.
 *
 * This file no longer reimplements any verb. It is the thin browser seam that
 * wires the two things the engine can't know about — the app's Nostrify relay
 * pool and the localStorage identity store — onto the engine's {@link BaoRelay}
 * and {@link BaoStore} interfaces. All command logic lives once in
 * `@/concord-v2/lib/baoEngine`.
 *
 * Exposes:
 *   - `window.bao` (via useWindowBao.tsx) — programmatic agent surface
 *   - `dispatchBaoTerm` / `parseCommandLine` — used by Terminal.tsx and tests
 */

import type { NPool } from '@nostrify/nostrify';
import type { NostrEvent } from 'nostr-tools/pure';

import { createBaoStore } from '@/lib/baoTermStore';
import {
  dispatchBao,
  type BaoDispatchArgs,
} from '@/concord-v2/lib/baoEngine';
import type { BaoRelay, BaoResult } from '@/concord-v2/lib/baoCore';

// ── Relay seam (the app's Nostrify pool) ─────────────────────────────────────

let pool: NPool | null = null;

/** Initialize with the app's Nostrify pool. Called once from the React tree
 *  (useWindowBao). The pool is shared with the whole app; we never close it. */
export function initBaoTermDispatcher(npool: NPool): void {
  pool = npool;
}

/** The engine's {@link BaoRelay} over the shared Nostrify pool. Lazy: only
 *  relay-touching commands (create/invite/join/say/read/…) call query/publish,
 *  so pure commands (help/identities/whoami/use) still work before the pool is
 *  wired, e.g. in tests. */
function npoolRelay(): BaoRelay {
  const requirePool = (): NPool => {
    const npool = pool;
    if (!npool) throw new Error('Terminal not initialized — wait for the page to finish loading.');
    return npool;
  };
  return {
    query: async (filters, relays) => {
      const npool = requirePool();
      return npool.query([filters] as never, (relays ? { relays } : undefined) as never) as Promise<NostrEvent[]>;
    },
    publish: async (relays, event, label) => {
      const npool = requirePool();
      try {
        await npool.event(event as never, { relays } as never);
      } catch (e) {
        throw new Error(`no relay accepted ${label}: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };
}

// ── Result envelope (kept for the window.bao / Terminal contract) ────────────

export type BaoTermResult<T = unknown> = BaoResult<T>;

/** Run one command against the engine using the browser store + Nostrify relay. */
export async function dispatchBaoTerm(
  command: string,
  args: Record<string, unknown> = {},
  ctx: { as?: string } = {},
): Promise<BaoTermResult> {
  const identityName = (args.as as string | undefined) ?? ctx.as;
  const merged: BaoDispatchArgs = { ...args, identityName };
  try {
    return await dispatchBao(createBaoStore(), npoolRelay(), command, merged);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Re-export the shared CLI-string parser so Terminal.tsx and tests keep working.
export { parseCommandLine } from '@/concord-v2/lib/baoEngine';
