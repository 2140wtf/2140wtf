/**
 * ₿AO Engine Core — the transport- and storage-agnostic heart of the command
 * engine shared by the headless CLI and the in-page agent terminal.
 *
 * Everything here depends only on two seams:
 *   - {@link BaoRelay}  — how to query/publish Nostr events (Node SimplePool
 *                         or the browser's Nostrify pool).
 *   - {@link BaoStore}  — where identities live (the CLI's ~/.concord-live/
 *                         files or the browser's localStorage).
 *
 * The verb implementations live in baoEngine.ts and never touch a transport
 * directly — so there is exactly ONE implementation of create/invite/join/say/
 * read/admin/ban/… shared by `bao-agent` (CLI), `window.bao` (in-page terminal)
 * and the `/` palette. Neither the CLI nor the terminal reimplements them.
 */

import type { NostrEvent } from "nostr-tools/pure";
import * as nip19 from "nostr-tools/nip19";

// ── The canonical identity ───────────────────────────────────────────────────

/** A community as a client holds it — persisted, transport-agnostic. */
export interface BaoCommunity {
  id: string; // hex
  owner: string; // hex pubkey
  owner_salt: string; // hex
  community_root: string; // hex
  root_epoch: number;
  /** Retained prior root epochs, newest first. The current root is excluded. */
  held_roots?: Array<{ epoch: number; key: string }>;
  /** Local membership start in milliseconds. */
  joined_at?: number;
  /** Pubkey whose accepted Refounding minted the current root epoch. */
  refounder?: string;
  name: string;
  relays: string[];
  general_channel_id?: string;
  /** Admin pubkeys that can mint invites. Owner is always admin. */
  admins?: string[];
}

export interface BaoInvite {
  token: string; // hex
  link_sk: string; // hex
  link_pk: string; // hex
  url: string;
  created_at: number;
  max_uses?: number;
  label?: string;
}

/** The one identity shape every surface persists. Mirrors the CLI's State. */
export interface BaoIdentity {
  /**
   * Hex private key — NEVER log. For key-based identities (create/join) this is
   * the signing key. For a signer-based login (browser extension / remote
   * signer) the app cannot expose a hex key; instead `pubkey` is set and `sk`
   * may be empty — such an identity can run read-only/identity commands but not
   * key-signed community publishes without a real key.
   */
  sk: string;
  /** Public key (hex). Always present; equals getPublicKey(sk) when `sk` is set. */
  pubkey?: string;
  role: "owner" | "member";
  /** Local selector (the CLI's --as name). */
  identity_name: string;
  community: BaoCommunity;
  private_channels: { id: string; key: string; epoch: number; name: string }[];
  invites: BaoInvite[];
  registry_version: number;
  /** Written at create/join; newer-stamped identities are refused. */
  protocol_version?: number;
}

// ── The two seams ────────────────────────────────────────────────────────────

/** How a surface talks to the relays. `relays` may be undefined to use the
 *  caller's default set. */
export interface BaoRelay {
  /** Query events. `filters` are a single RELAY filter (kinds, authors, tags). */
  query(filters: Record<string, unknown>, relays?: string[]): Promise<NostrEvent[]>;
  /** Publish one event; throw if NO relay accepted it. `label` is for logs. */
  publish(relays: string[], event: NostrEvent, label: string): Promise<void>;
}

/** Where identities are kept. */
export interface BaoStore {
  get(name: string): BaoIdentity | undefined;
  list(): string[];
  save(identity: BaoIdentity): void;
  remove(name: string): void;
  getActive(): string | null;
  setActive(name: string): void;
}

// ── Shared helpers (transport-agnostic) ──────────────────────────────────────

/** Identity-name validation shared by every store (collision-safe, path-safe). */
export function validateIdentityName(name: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) {
    throw new Error("Identity name must be 1–64 ASCII letters, digits, dots, underscores, or dashes, starting with a letter or digit.");
  }
  return name;
}

/** The protocol version this binary speaks. A stored identity stamped by a
 *  NEWER version is refused (never half-run an older binary). */
export const BAO_PROTOCOL_VERSION = 1;

/** Resolve the identity a verb operates on: explicit `as` name, else the
 *  store's active identity. */
export function resolveIdentity(store: BaoStore, as?: string): BaoIdentity {
  const name = as ?? store.getActive() ?? undefined;
  if (!name) throw new Error("No active identity. Create or join one first, or pass --as <name>.");
  const identity = store.get(name);
  if (!identity) throw new Error(`No identity "${name}". Run 'identities' to see saved names.`);
  return identity;
}

/** Resolve a member argument to lowercase hex (accepts npub1…/nprofile1… or hex). */
export function toHexPubkey(target: string): string {
  if (/^[0-9a-f]{64}$/i.test(target)) return target.toLowerCase();
  try {
    const d = nip19.decode(target);
    if (d.type !== "npub" && d.type !== "nprofile") throw new Error();
    return d.type === "npub" ? d.data : d.data.pubkey;
  } catch {
    throw new Error(`"${target}" isn't a valid npub or hex pubkey`);
  }
}

/** The ₿AO command result envelope used by every surface. */
export type BaoResult<T = unknown> = { ok: true; result: T } | { ok: false; error: string };

export function ok<T>(result: T): BaoResult<T> {
  return { ok: true, result };
}
export function err(error: string): BaoResult {
  return { ok: false, error };
}

/** Default home relays for a freshly created community (agent default). */
export const HOME_RELAYS_DEFAULT = ["wss://relay.ditto.pub", "wss://jskitty.com/nostr", "wss://relay.primal.net"];
