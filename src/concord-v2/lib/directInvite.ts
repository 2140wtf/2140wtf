/**
 * Concord V2 Direct Invites — CORD-05 §6.
 *
 * A Direct Invite drops the link machinery entirely: when the invitee is a
 * known npub, the §1 `CommunityInvite` bundle giftwraps straight to them as a
 * STANDARD NIP-59 giftwrap (ephemeral wrap author, the recipient in the `p`
 * tag, a kind-13 seal signed by the inviter's REAL key — not the reversed
 * stream wrap of CORD-01). No coordinate, no token, nothing to fetch:
 *
 *   wrap(1059, ephemeral author, ["p", recipient], ["k", "3313"])
 *     └ seal(13, signed by the inviter)
 *         └ rumor(3313, content = the CommunityInvite bundle as JSON)
 *
 * The outer `k` tag is what makes invites INDEXED: a recipient looks up
 * exactly their invites — `{"kinds":[1059], "#p":[me], "#k":["3313"]}` —
 * instead of decrypting everything ever p-tagged at them (NIP-17's cost). The
 * tag is unsigned relay-visible bytes, a hint and never authority: an invite
 * is whatever unwraps to a kind-3313 rumor.
 *
 * A Direct Invite is a key handoff, not a standing door: unrevocable once
 * landed (regretting one is what Rekeys are for), absent from the Registry,
 * and it never flips the Community Public — which is precisely what lets a
 * Private Community grow by personal handoff, one npub at a time.
 *
 * Sending needs the abstract signer only (`signEvent` + `nip44.encrypt`), so
 * nsec, extension, and bunker logins can all invite; unwrapping likewise peels
 * the layers with `nip44.decrypt` (nostr-tools' nip59 helpers need a raw key,
 * which NIP-07/NIP-46 signers never expose).
 */

import { getConversationKey, encrypt as nip44Encrypt } from "nostr-tools/nip44";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import type { EventTemplate, NostrEvent } from "nostr-tools/pure";

import { validateBundle, type InviteBundle } from "@/concord-v2/lib/invite";
import { KIND_DIRECT_INVITE, KIND_WRAP } from "@/concord-v2/lib/kinds";

/** The standard NIP-59 seal kind (classic giftwrap — not a CORD-01 seal). */
export const KIND_NIP59_SEAL = 13;

/** NIP-59: outer timestamps are tweaked into the past, up to two days. */
const MAX_BACKDATE_SECS = 2 * 24 * 60 * 60;

function tweakedPast(): number {
  return Math.floor(Date.now() / 1000) - Math.floor(Math.random() * MAX_BACKDATE_SECS);
}

/** The signer surface a Direct Invite send needs (every Concord-capable login). */
export interface DirectInviteSigner {
  signEvent(template: EventTemplate): Promise<NostrEvent>;
  nip44?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>;
    decrypt(pubkey: string, ciphertext: string): Promise<string>;
  };
}

/** The unsigned kind-3313 rumor: the bundle whole, claimed by the inviter. */
export interface DirectInviteRumor {
  kind: number;
  content: string;
  tags: string[][];
  created_at: number;
  pubkey: string;
}

// ── Sending ──────────────────────────────────────────────────────────────────

/** Build the kind-3313 rumor carrying the bundle as its content (CORD-05 §6). */
export function buildDirectInviteRumor(bundle: InviteBundle, inviterPubkey: string): DirectInviteRumor {
  return {
    kind: KIND_DIRECT_INVITE,
    content: JSON.stringify(bundle),
    tags: [],
    created_at: Math.floor(Date.now() / 1000),
    pubkey: inviterPubkey,
  };
}

/**
 * Seal the rumor with the inviter's REAL identity (the seal's verified npub is
 * what proves who invited them) — one signer round-trip, NIP-44-encrypted to
 * the recipient, timestamp tweaked into the past per NIP-59.
 */
export async function sealDirectInvite(
  rumor: DirectInviteRumor,
  recipientPubkey: string,
  signer: DirectInviteSigner,
): Promise<NostrEvent> {
  if (!signer.nip44) throw new Error("This signer can't send direct invites (NIP-44 unsupported).");
  return signer.signEvent({
    kind: KIND_NIP59_SEAL,
    content: await signer.nip44.encrypt(recipientPubkey, JSON.stringify(rumor)),
    tags: [],
    created_at: tweakedPast(),
  });
}

/**
 * Wrap a signed seal for the recipient under a single-use ephemeral key. The
 * wrap carries what no Concord stream event may — identifying outer tags: the
 * recipient `p` and the indexing `k` (plus optional NIP-40 expiration matching
 * the bundle's `expires_at`, so relays can prune a stale handoff).
 */
export function wrapDirectInvite(
  seal: NostrEvent,
  recipientPubkey: string,
  opts?: { expiresAtMs?: number },
): NostrEvent {
  const ephemeralSk = generateSecretKey();
  const convKey = getConversationKey(ephemeralSk, recipientPubkey);
  const tags: string[][] = [
    ["p", recipientPubkey],
    ["k", String(KIND_DIRECT_INVITE)],
  ];
  if (opts?.expiresAtMs) tags.push(["expiration", String(Math.floor(opts.expiresAtMs / 1000))]);
  return finalizeEvent(
    {
      kind: KIND_WRAP,
      content: nip44Encrypt(JSON.stringify(seal), convKey),
      tags,
      created_at: tweakedPast(),
    },
    ephemeralSk,
  );
}

// ── Receiving ────────────────────────────────────────────────────────────────

/** An unwrapped giftwrap: the inner rumor plus its seal-verified sender. */
export interface UnwrappedInvite {
  rumor: DirectInviteRumor;
  /** The seal's author — the verified sender (the inviter). */
  sender: string;
}

/**
 * Unwrap a kind-1059 giftwrap addressed to the current user. Returns the inner
 * rumor + the verified sender, or undefined if it isn't a well-formed wrap this
 * signer can open. Never throws — a foreign/garbage wrap yields undefined so a
 * scan loop can skip it.
 *
 * The sender is the SEAL's author (kind 13), and the rumor must claim the same
 * pubkey — the standard NIP-59 anti-spoofing check (a wrap can't lie about who
 * sealed it without the seal author's key).
 */
export async function unwrapDirectInvite(
  giftWrap: NostrEvent,
  signer: Pick<DirectInviteSigner, "nip44">,
): Promise<UnwrappedInvite | undefined> {
  if (giftWrap.kind !== KIND_WRAP || !signer.nip44) return undefined;
  try {
    // Layer 1: decrypt the wrap with the ephemeral wrap author's pubkey → seal.
    const seal = JSON.parse(await signer.nip44.decrypt(giftWrap.pubkey, giftWrap.content)) as NostrEvent;
    if (seal.kind !== KIND_NIP59_SEAL) return undefined;

    // Layer 2: decrypt the seal with the seal author's pubkey → rumor.
    const rumor = JSON.parse(await signer.nip44.decrypt(seal.pubkey, seal.content)) as DirectInviteRumor;

    // Anti-spoofing: the rumor's claimed author must equal the seal's author.
    if (rumor.pubkey !== seal.pubkey) return undefined;

    return { rumor, sender: seal.pubkey };
  } catch {
    return undefined;
  }
}

/**
 * Parse + validate an unwrapped rumor as a Direct Invite bundle. The outer `k`
 * tag was only ever a hint — the rumor's kind is the authority here — and the
 * bundle validates exactly as a fetched one (bounds, self-certifying owner).
 * Expiry is deliberately NOT enforced here: a parked invite still renders past
 * `expires_at`; accepting refuses. Returns undefined for anything malformed.
 */
export function parseDirectInviteRumor(kind: number, content: string): InviteBundle | undefined {
  if (kind !== KIND_DIRECT_INVITE) return undefined;
  try {
    const bundle = JSON.parse(content) as InviteBundle;
    if (typeof bundle.community_id !== "string" || typeof bundle.name !== "string") return undefined;
    return validateBundle(bundle);
  } catch {
    return undefined;
  }
}

/** Whether a bundle's shelf life has run out (`expires_at` is unix ms). */
export function directInviteExpired(bundle: InviteBundle, nowMs = Date.now()): boolean {
  return typeof bundle.expires_at === "number" && nowMs > bundle.expires_at;
}
