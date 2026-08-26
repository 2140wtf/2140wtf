import { bytesToHex, hexToBytes, utf8ToBytes, concatBytes } from '@noble/hashes/utils.js';
import { getPublicKey, finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import type { EventTemplate, NostrEvent } from 'nostr-tools/pure';
export { generateSecretKey, getPublicKey, finalizeEvent };
export type { EventTemplate, NostrEvent };
export { bytesToHex, hexToBytes, utf8ToBytes, concatBytes };
/** Default CSPRNG. Tests pass a seeded one instead. */
export type Rng = (bytes: number) => Uint8Array;
export declare const defaultRng: Rng;
/** Deterministic RNG for tests/vectors: SHA-256 counter stream. */
export declare function seededRng(seedHex: string): Rng;
/** Deterministic secret key from a label — tests/vectors only. */
export declare function testSecretKey(label: string): Uint8Array;
export declare function encryptToRoomKey(plaintext: string, roomKey: Uint8Array, rng?: Rng): string;
export declare function decryptWithRoomKey(payload: string, roomKey: Uint8Array): string;
/** NIP-44 v2 DM encryption (welcomer wraps, join requests) — keypair DH. */
export declare function encryptDm(plaintext: string, senderSecret: Uint8Array, recipientPub: string, rng?: Rng): string;
export declare function decryptDm(payload: string, recipientSecret: Uint8Array, senderPub: string): string;
export interface EpochKeys {
    epoch: number;
    /** Chain key for this epoch — input to the next ratchet step. */
    chainKey: Uint8Array;
    /** NIP-44 content key for this epoch. */
    encKey: Uint8Array;
    /** HMAC key for rotating labels (Tier 2) / opaque derivations. */
    labelKey: Uint8Array;
}
/** Derive the full key set for epoch n from its chain key. */
export declare function deriveEpochKeys(chainKey: Uint8Array, epoch: number): EpochKeys;
/** Ratchet one step forward: k_{n+1} = HKDF(k_n, info="bao/epoch"). */
export declare function ratchetEpoch(prev: EpochKeys): EpochKeys;
/**
 * Per-room role keys for multi-room daemons: one operator master key
 * derives an isolated secret per (role, room) — HKDF(master,
 * "bao/role/<role>/<roomId>"). A leaked room role key never compromises
 * sibling rooms, and room provisioning carries no role secrets.
 */
/**
 * Scroll-wrapper key: HKDF(content_key, "bao/scrollwrap"). Segments are
 * padded containers encrypted with this key; members derive it from the
 * content key, operators derive it to provision blind scribes — scribes
 * get ONLY this, never the content key. The wrapper hides message
 * count/sizes from the relay; content secrecy stays per-message.
 */
export declare function deriveScrollWrapperKey(encKey: Uint8Array): Uint8Array;
/** Opaque on-wire room scope for d-tags: HMAC(scroll-wrapper key, roomId). */
export declare function scrollScope(segKey: Uint8Array, roomId: string): string;
export declare function deriveRoomRoleKey(master: Uint8Array, role: 'scribe' | 'welcomer' | 'welcomer-epoch' | 'directory', roomId: string): Uint8Array;
/** Full chain derivation from the room seed through epoch n. */
export declare function deriveChain(seed: Uint8Array, throughEpoch: number): EpochKeys;
/**
 * deriveIdentityKey — "New identity" privacy mode: derive a DEDICATED chat
 * keypair from the user's Nostr key. True pseudonymity: the chat npub is
 * unlinkable to the identity npub on the relay, yet reproducible from the
 * user's own key on any device. Domain-separated HKDF; 32B out.
 */
export declare function deriveIdentityKey(nostrSecretKey: Uint8Array): Uint8Array;
export declare function hmacSha256(key: Uint8Array, ...msgs: Uint8Array[]): Uint8Array;
/** Rotating g label (§11): HMAC(label_k, roomId). */
export declare function rotatingLabel(labelKey: Uint8Array, roomId: string): string;
export declare const PADDING_BUCKETS: readonly [256, 1024, 4096, 16384];
/**
 * Exactly 24 KB, spec §3.2. NOT 32 KB: NIP-44 v2 applies its own internal
 * padding (8 KB chunks above 32 KB), so a 32 KB bundle → ~66 KB wire event,
 * over strfry's 64 KB maxEventSize. 24 KB → base64 32768 → NIP-44-padded
 * 32768 → ~44.6 KB wire. Measured, not estimated.
 */
export declare const SEGMENT_CONTENT_SIZE = 24576;
/** Smallest bucket that fits `size`, or null when larger than the max bucket. */
export declare function paddingBucket(size: number): number | null;
/**
 * Length-tagged padding: 4-byte big-endian payload length, payload, zeros to
 * the bucket size. Deterministic and unambiguous.
 */
export declare function padToBucket(payload: Uint8Array, bucket: number): Uint8Array;
/** Pad a JSON string to a §11 bucket (BYTES). Trailing spaces are legal
 *  JSON whitespace, so decode paths need no unpadding. */
export declare function padJsonToBucket(json: string): string;
export declare function unpadBucket(padded: Uint8Array): Uint8Array;
export interface Clock {
    nowSec(): number;
}
export declare const systemClock: Clock;
/** Deterministic clock for tests. */
export declare function manualClock(startSec?: number): Clock & {
    advance(sec: number): void;
    set(sec: number): void;
};
/** Jitter direction: which side(s) of `now` the jittered created_at lands on. */
export type TimestampBias = 'forward' | 'backward' | 'centered';
/**
 * Privacy-jitter configuration for one relay/room (§11, §12).
 *
 * The wire format NEVER changes (created_at is still a unix-second integer) —
 * this type only decides how the client SPREADS it. The protocol is
 * relay-neutral: any policy is valid on any NIP-01 relay; which ones are
 * USABLE depends on the relay's own time-window acceptance.
 */
export interface PrivacyPolicy {
    /** forward  = [now, now+windowSec]
     *  backward = [now−windowSec, now]
     *  centered = [now−⌊windowSec/2⌋, now+⌈windowSec/2⌉] */
    bias: TimestampBias;
    /** Observer uncertainty in seconds (the full jitter window width). */
    windowSec: number;
}
/**
 * Trust class of the relay a room lives on (§12 relay requirements). The
 * protocol is neutral — it runs on ANY relay — but privacy posture adapts:
 * a public/untrusted relay enforces vanilla time windows, a private/
 * dedicated relay (our patched strfry build, P2) accepts the full jitter.
 */
export type RelayClass = 'public' | 'private';
/** Vanilla-safe default — works on any public NIP-01 relay (§11, current).
 *  Forward bias inside the acceptance window stock strfry enforces (past
 *  >~60 s and future >~15 min hard-rejected, bisected 2026-08-23). */
export declare const DEFAULT_PRIVACY_POLICY: PrivacyPolicy;
/**
 * Per-relay-class privacy presets (§12 + §11):
 *
 * These are EXTRA PRIVACY FEATURES for private rooms — an optional
 * timing-metadata hardening layer. A room is private because of its
 * cryptography (NIP-44 room key, burners, sealed payloads, invite
 * fragments); it NEVER depends on jittering. Any stock relay runs every
 * private room with the public/default posture.
 *
 *  public  — vanilla NIP-01 / untrusted public relay: FORWARD jitter within
 *            the stock acceptance window. Observer uncertainty = 600 s, zero
 *            rejected events. Works everywhere.
 *
 *  private — dedicated/patched strfry (the P2 full-window build): FULL
 *            backward jitter over ±48 h (172800 s) — "full jittering of
 *            messages": an observer of the relay cannot tell when anything
 *            happened within ±2 days. STOCK strfry REJECTS this (backdates
 *            >60 s); opt in only once the room's relay runs the patched
 *            image. Purely additive — flipping it on/off changes no
 *            functionality, only how spread-out send times are.
 */
export declare const RELAY_CLASS_POLICIES: Record<RelayClass, PrivacyPolicy>;
/** Normalize any accepted privacy input to a full PrivacyPolicy.
 *  - undefined                   → DEFAULT_PRIVACY_POLICY (public posture)
 *  - 'public' / 'private'        → RELAY_CLASS_POLICIES preset
 *  - a bare number               → forward bias with that window (back-compat)
 *  - a full PrivacyPolicy object → validated + returned
 */
export declare function privacyPolicyFor(policy: RelayClass | PrivacyPolicy | number | undefined): PrivacyPolicy;
/**
 * Privacy-jittered timestamp for ephemeral kinds (§11).
 *
 * FORWARD [now, now+windowSec] is the DEFAULT and fits any vanilla relay.
 * Empirically bisected on production strfry (2026-08-23, vps16gb): events are
 * rejected older than ~60 s AND newer than ~15 min — the pre-v0.2.0
 * backward-only ±48 h backdating was silently killed by every real relay.
 * Forward bias keeps full observer uncertainty (= windowSec) while passing
 * recency floors; conversation order comes from scroll position, never
 * timestamps.
 *
 * Pass a RelayClass ('public' | 'private') for a trust-class preset, a full
 * PrivacyPolicy for a custom window/bias (private relays running the P2
 * patched build restore the backward ±48 h full jitter), or a bare windowSec
 * number (back-compat, forward bias). Default = DEFAULT_PRIVACY_POLICY.
 */
export declare function privacyTimestamp(clock?: Clock, rng?: Rng, policy?: RelayClass | PrivacyPolicy | number): number;
/** Monotonic created_at for addressable kinds: max(now, previous + 1). */
export declare function monotonicTimestamp(previousCreatedAt: number | undefined, clock?: Clock): number;
export declare function signEvent(template: EventTemplate, secretKey: Uint8Array): NostrEvent;
/**
 * Signature + id verification that NEVER trusts nostr-tools' in-memory
 * verifiedSymbol cache. finalizeEvent stamps verifiedSymbol=true on the
 * object it returns, and nostr-tools' verifyEvent returns that cached value
 * WITHOUT checking the signature — so a spread of a signed event (or any
 * in-process object) would "verify" with zero checking. Symbols don't
 * survive JSON so wire paths are safe, but relay sims, test fixtures and
 * in-process forwards are silently broken. Deleting the stamp forces the
 * real id-hash + schnorr check every time (post-review security fix).
 */
export declare function verifyEvent(event: NostrEvent): boolean;
export declare function findTag(event: {
    tags: string[][];
}, name: string): string | undefined;
