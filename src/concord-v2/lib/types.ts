/**
 * Concord V2 core types — the runtime model the hooks and UI operate on.
 *
 * Ids and keys are raw 32-byte values in memory (lowercase hex on the wire).
 * A Community's identity (`community_id`) is a self-certifying commitment to
 * its owner; its access (`community_root`) is a separate 32-byte secret so
 * access can rotate while identity stays fixed (CORD-02 §1–2).
 */

import type { GroupKey } from "@/concord-v2/lib/derive";

/**
 * Protocol recommendation for a community's relay set (CORD-02 §6). Kept in
 * line with the app's default relay set so a creator can host a community on
 * the same broad set their feed uses; members who care about metadata
 * privacy are advised (in the create UI) to pare the set down to a single
 * private relay instead.
 */
export const MAX_COMMUNITY_RELAYS = 15;

/** Community/channel/role name cap: 64 bytes of UTF-8 (CORD-02 §6). */
export const NAME_MAX_BYTES = 64;
/** Community description cap: 10,000 bytes of UTF-8 (CORD-02 §6). */
export const DESCRIPTION_MAX_BYTES = 10_000;
/** Hostile-bundle bound: reject an invite carrying more channels than this (CORD-05 §1). */
export const MAX_BUNDLE_CHANNELS = 256;
/** The Community List caps at 50 memberships (CORD-02 §8). */
export const MAX_LIST_MEMBERSHIPS = 50;

/** Canonical relay URL for dedupe + display: lowercase scheme/host, no
 * trailing slash. `wss://relay.damus.io/` and `wss://relay.damus.io` are the
 * same relay; treating them as distinct strings seeded duplicate entries
 * (and double connections) into community relay sets. */
export function canonicalRelayUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.protocol}//${u.host}${path}${u.search}`;
  } catch {
    return url.replace(/\/+$/, "");
  }
}

/** Dedupe (order-preserving, by canonical URL) + truncate a relay set to the
 * recommended cap. Emits the canonical form so displays don't mix
 * trailing-slash variants of the same relay. */
export function capRelays(relays: string[], cap = MAX_COMMUNITY_RELAYS): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of relays) {
    if (out.length >= cap) break;
    if (typeof r !== "string" || !r) continue;
    const canonical = canonicalRelayUrl(r);
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    out.push(canonical);
  }
  return out;
}

/** Byte length of a string as UTF-8. */
export function utf8Len(s: string): number {
  return new TextEncoder().encode(s).length;
}

/**
 * An encrypted-blob pointer (icon / banner): the media host stores ciphertext,
 * the per-image key + nonce ride inside member-sealed metadata, and `hash` is
 * the SHA-256 of the plaintext so a swapped blob fails closed (CORD-02 §6).
 */
export interface ImagePointer {
  url: string;
  /** Hex AES-256-GCM key. */
  key: string;
  /** Hex AES-GCM nonce/IV. */
  nonce: string;
  /** Hex SHA-256 of the plaintext. */
  hash: string;
}

/** Runtime check that a value is a plausible {@link ImagePointer}. */
export function isImagePointer(v: unknown): v is ImagePointer {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.url === "string" &&
    typeof o.key === "string" &&
    typeof o.nonce === "string" &&
    typeof o.hash === "string"
  );
}

/** Community metadata — the vsk=0 Control Plane entity's content (CORD-02 §6). */
export interface CommunityMetadata {
  name: string;
  description?: string;
  /** The Community's evolving relay set (the fold is the authority). */
  relays: string[];
  icon?: ImagePointer;
  banner?: ImagePointer;
  /** Client-extensible opaque fields; editors MUST round-trip what they don't understand. */
  custom?: Record<string, unknown>;
  /** Unknown top-level fields, preserved for round-tripping. */
  [k: string]: unknown;
}

/** Channel metadata — the vsk=2 Control Plane entity's content (CORD-03 §2). */
export interface ChannelMetadata {
  name: string;
  private: boolean;
  /** Terminal: the id is never reused; clients drop the Channel from display. */
  deleted?: boolean;
  custom?: Record<string, unknown>;
  [k: string]: unknown;
}

/** A private Channel's independent key material, as delivered by an invite. */
export interface PrivateChannelKey {
  /** Channel id (32 bytes). */
  id: Uint8Array;
  /** Independent random key (32 bytes) — cryptographically unrelated to the root. */
  key: Uint8Array;
  epoch: bigint;
  /** Join-time preview name; the ChannelMetadata fold is the authority. */
  name: string;
}

/** A held root-key epoch (the current one plus retained priors for history). */
export interface HeldRoot {
  epoch: bigint;
  key: Uint8Array;
}

/**
 * A Concord V2 community as the client holds it — rehydrated from the
 * Community List entry (join material) with the deployment's app relays
 * unioned in. Channel DEFINITIONS live on the Control Plane; this carries only
 * identity, access keys, and the private-channel keys the member holds.
 */
export interface CommunityV2 {
  id: Uint8Array;
  idHex: string;
  /** The proven owner (x-only hex) — verified against the id commitment. */
  owner: string;
  ownerSalt: Uint8Array;
  /** The current community_root at `rootEpoch`. */
  root: Uint8Array;
  rootEpoch: bigint;
  /** Every held root epoch (current + retained priors), newest first. */
  heldRoots: HeldRoot[];
  /** Private-channel keys held (public channels derive from the root). */
  privateChannels: PrivateChannelKey[];
  relays: string[];
  /** Join-time preview name; the metadata fold is the authority. */
  name: string;
  /** The npub whose Refounding minted the current epoch (snapshot authority). */
  refounder?: string;
}

/**
 * A Channel's call coordinates (CORD-07 §1), derived from the same
 * (secret, epoch) that addresses its Chat Plane — so they rotate exactly when
 * the Channel's key does. Every Channel is callable.
 */
export interface VoiceKeys {
  /** The SFU room keypair: `pk` IS the room name, `sk` signs token grants. */
  room: GroupKey;
  /** The raw 32-byte media root; every per-sender frame key derives from it. */
  mediaKey: Uint8Array;
}

/** One channel as the UI consumes it: folded definition + derived stream keys. */
export interface ChannelV2 {
  id: Uint8Array;
  idHex: string;
  name: string;
  isPrivate: boolean;
  /** The current epoch's call coordinates — every Channel is callable (CORD-07 §1). */
  voice: VoiceKeys;
  /** Stream keys across every held epoch, newest first (reads span rekeys). */
  streams: Array<{ epoch: bigint; group: GroupKey }>;
  /** The current write coordinate. */
  current: { epoch: bigint; group: GroupKey };
}
