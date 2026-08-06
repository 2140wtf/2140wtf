/**
 * Node adapters for the shared ₿AO engine — the CLI's seam.
 *
 * Wraps the two Node-only pieces the engine can't know about onto its
 * {@link BaoRelay} and {@link BaoStore} interfaces:
 *   - {@link createNodeRelay} — nostr-tools SimplePool (the CLI's relay client)
 *   - {@link createNodeStore}  — the ~/.concord-live/ filesystem identity store
 *
 * The engine (src/concord-v2/lib/baoEngine) implements every verb once; this
 * module is the thin Node side of that one engine. The on-disk shape is the
 * CLI's `State`; it differs from the engine's {@link BaoIdentity} only by the
 * `identity_name` selector (which is the filename), so the mapping is a lossless
 * add/drop of that one field.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { SimplePool } from "nostr-tools/pool";
import { hexToBytes } from "@noble/hashes/utils.js";
import type { NostrEvent } from "nostr-tools/pure";

import { loadState, saveState, statePath, validateIdentityName, type State } from "./chat-core";
import type { BaoIdentity, BaoRelay, BaoStore } from "@/concord-v2/lib/baoCore";

// ── Node relay (SimplePool, per-community pools for isolation) ───────────────

/**
 * A SimplePool per community, so one connection/authenticated session is never
 * shared across communities on a relay (the CLI correlation-leak fix). Keyed by
 * the community idHex; the engine passes it via {@link NodeRelayOpts}.
 */
const pools = new Map<string, SimplePool>();
export function poolFor(communityId: string): SimplePool {
  let p = pools.get(communityId);
  if (!p) {
    p = new SimplePool();
    pools.set(communityId, p);
  }
  return p;
}
export function closeAllPools(): void {
  for (const p of pools.values()) p.close([...new Set<string>()]);
  pools.clear();
}

/** The relay seam. `communityId` lets it pick (and thus isolate) a per-community
 *  pool. When `authSk` (the member's hex secret key) is provided, the pool
 *  answers NIP-42 AUTH challenges signed by that key, so the relay sees one
 *  authenticated session per community rather than a shared anonymous one. */
export interface NodeRelayOpts {
  communityId?: string;
  authSk?: string;
}

export function createNodeRelay(opts: NodeRelayOpts = {}): BaoRelay {
  const pool = () => (opts.communityId ? poolFor(opts.communityId) : new SimplePool());

  // NIP-42: when a relay challenges the connection, respond with a signed
  // kind-22242 event. Set once on the (per-community, cached) pool.
  if (opts.authSk && opts.communityId) {
    const sk = hexToBytes(opts.authSk);
    pool().authHandler = async (url, challenge) => {
      const { finalizeEvent } = await import("nostr-tools/pure");
      return finalizeEvent(
        {
          kind: 22242,
          content: "",
          tags: [
            ["relay", url],
            ["challenge", challenge],
          ],
          created_at: Math.floor(Date.now() / 1000),
        },
        sk,
      ) as NostrEvent;
    };
  }

  return {
    query: async (filters, relays) =>
      pool().querySync(relays ?? [], filters as never, { maxWait: 8000 }) as Promise<NostrEvent[]>,
    publish: async (relays, event, label) => {
      const results = await Promise.allSettled(pool().publish(relays, event));
      const rejected = results.filter((r) => r.status === "rejected");
      if (rejected.length === results.length) {
        const reasons = rejected.map((r) => (r.status === "rejected" ? String(r.reason) : "")).join("; ");
        throw new Error(`no relay accepted ${label}: ${reasons}`);
      }
      const size = JSON.stringify(event).length;
      console.error(`  ✓ ${label}: kind ${event.kind} ${event.id.slice(0, 12)}… (${size} B) → ${results.length - rejected.length}/${results.length} relays`);
    },
  };
}

// ── Node store (filesystem, mirroring the CLI's ~/.concord-live) ────────────

const STATE_DIR = join(homedir(), ".concord-live");
const ACTIVE_FILE = join(STATE_DIR, ".active");

function toBaoIdentity(name: string, state: State): BaoIdentity {
  return { ...state, identity_name: name };
}

function toState(identity: BaoIdentity): State {
  const { identity_name: _drop, ...state } = identity;
  return state as State;
}

export function createNodeStore(): BaoStore {
  return {
    get: (name) => {
      const validated = validateIdentityName(name);
      if (!existsSync(statePath(validated))) return undefined;
      return toBaoIdentity(validated, loadState(validated));
    },
    list: () => {
      if (!existsSync(STATE_DIR)) return [];
      return readdirSync(STATE_DIR)
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.slice(0, -5))
        .filter((n) => /^[A-Za-z0-9._-]+$/.test(n));
    },
    save: (identity) => {
      const name = validateIdentityName(identity.identity_name);
      saveState(name, toState(identity));
    },
    remove: (name) => {
      const validated = validateIdentityName(name);
      const p = statePath(validated);
      if (existsSync(p)) unlinkSync(p);
    },
    getActive: () => {
      try {
        return readFileActive();
      } catch {
        return undefined;
      }
    },
    setActive: (name) => {
      if (!name) {
        const { unlinkSync: ul } = { unlinkSync };
        try {
          ul(ACTIVE_FILE);
        } catch {
          /* no active file — fine */
        }
        return;
      }
      writeFileActive(validateIdentityName(name));
    },
  };
}

function readFileActive(): string | undefined {
  try {
    return readFileSync(ACTIVE_FILE, "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}
function writeFileActive(name: string): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(ACTIVE_FILE, name, { mode: 0o600 });
}
