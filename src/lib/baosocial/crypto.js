/**
 * Crypto primitives — spec §8 (key schedule), §11 (padding, timestamp
 * discipline). NIP-44 v2 everywhere.
 *
 * Randomness and time are injectable everywhere they are used, so tests run
 * with seeded RNGs and deterministic clocks (§17 testability requirement).
 */
import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes, concatBytes } from '@noble/hashes/utils.js';
import * as nip44 from 'nostr-tools/nip44';
import { getPublicKey, finalizeEvent, verifyEvent as verifyEventImpl, generateSecretKey, verifiedSymbol } from 'nostr-tools/pure';
export { generateSecretKey, getPublicKey, finalizeEvent };
export { bytesToHex, hexToBytes, utf8ToBytes, concatBytes };
export const defaultRng = (bytes) => {
    const out = new Uint8Array(bytes);
    globalThis.crypto.getRandomValues(out);
    return out;
};
/** Deterministic RNG for tests/vectors: SHA-256 counter stream. */
export function seededRng(seedHex) {
    const seed = hexToBytes(seedHex);
    let counter = 0;
    return (bytes) => {
        const out = new Uint8Array(bytes);
        let written = 0;
        while (written < bytes) {
            const block = sha256(concatBytes(seed, utf8ToBytes(String(counter++))));
            const take = Math.min(block.length, bytes - written);
            out.set(block.subarray(0, take), written);
            written += take;
        }
        return out;
    };
}
/** Deterministic secret key from a label — tests/vectors only. */
export function testSecretKey(label) {
    const k = sha256(utf8ToBytes(`bao/chat/testkey/${label}`));
    k[0] = (k[0] & 0x7f) | 0x01;
    return k;
}
// ─── NIP-44 v2 with a raw 32-byte room conversation key ────────────────────
// nostr-tools v2 encrypt(plaintext, conversationKey, nonce?) accepts any
// 32-byte key — the room content key is used directly as the conversation
// key. v1 is dead: we never touch it (§11 pins v2).
export function encryptToRoomKey(plaintext, roomKey, rng = defaultRng) {
    if (roomKey.length !== 32)
        throw new Error('room key must be 32 bytes');
    return nip44.v2.encrypt(plaintext, roomKey, rng(32));
}
export function decryptWithRoomKey(payload, roomKey) {
    if (roomKey.length !== 32)
        throw new Error('room key must be 32 bytes');
    return nip44.v2.decrypt(payload, roomKey);
}
/** NIP-44 v2 DM encryption (welcomer wraps, join requests) — keypair DH. */
export function encryptDm(plaintext, senderSecret, recipientPub, rng = defaultRng) {
    return nip44.v2.encrypt(plaintext, nip44.v2.utils.getConversationKey(senderSecret, recipientPub), rng(32));
}
export function decryptDm(payload, recipientSecret, senderPub) {
    return nip44.v2.decrypt(payload, nip44.v2.utils.getConversationKey(recipientSecret, senderPub));
}
function hkdf32(ikm, info) {
    return hkdf(sha256, ikm, undefined, utf8ToBytes(info), 32);
}
/** Derive the full key set for epoch n from its chain key. */
export function deriveEpochKeys(chainKey, epoch) {
    if (chainKey.length !== 32)
        throw new Error('chain key must be 32 bytes');
    return {
        epoch,
        chainKey,
        encKey: hkdf32(chainKey, 'bao/segment'),
        labelKey: hkdf32(chainKey, 'bao/label'),
    };
}
/** Ratchet one step forward: k_{n+1} = HKDF(k_n, info="bao/epoch"). */
export function ratchetEpoch(prev) {
    return deriveEpochKeys(hkdf32(prev.chainKey, 'bao/epoch'), prev.epoch + 1);
}
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
export function deriveScrollWrapperKey(encKey) {
    if (encKey.length !== 32)
        throw new Error('content key must be 32 bytes');
    return hkdf32(encKey, 'bao/scrollwrap');
}
/** Opaque on-wire room scope for d-tags: HMAC(scroll-wrapper key, roomId). */
export function scrollScope(segKey, roomId) {
    return bytesToHex(hmacSha256(segKey, utf8ToBytes(roomId)));
}
export function deriveRoomRoleKey(master, role, roomId) {
    if (master.length !== 32)
        throw new Error('master key must be 32 bytes');
    return hkdf32(master, `bao/role/${role}/${roomId}`);
}
/** Full chain derivation from the room seed through epoch n. */
export function deriveChain(seed, throughEpoch) {
    if (seed.length !== 32)
        throw new Error('seed must be 32 bytes');
    let keys = deriveEpochKeys(seed, 0);
    for (let i = 0; i < throughEpoch; i++)
        keys = ratchetEpoch(keys);
    return keys;
}
/**
 * deriveIdentityKey — "New identity" privacy mode: derive a DEDICATED chat
 * keypair from the user's Nostr key. True pseudonymity: the chat npub is
 * unlinkable to the identity npub on the relay, yet reproducible from the
 * user's own key on any device. Domain-separated HKDF; 32B out.
 */
export function deriveIdentityKey(nostrSecretKey) {
    if (nostrSecretKey.length !== 32)
        throw new Error('identity derivation needs a 32-byte nostr secret key');
    return hkdf32(nostrSecretKey, 'bao/chat-identity/1');
}
export function hmacSha256(key, ...msgs) {
    return hmac(sha256, key, concatBytes(...msgs));
}
/**
 * Length-framed HMAC-SHA256 — each message is prefixed by its length as a
 * 4-byte big-endian integer before concatenation (CRYPTO-04).
 *
 * Why it exists: `hmacSha256`'s bare concatenation is ambiguous whenever a
 * message boundary matters — HMAC(k, "ab"‖"c") === HMAC(k, "a"‖"bc"). The
 * framing makes the tag a uniquely-decodable function of the message LIST.
 * Use it for NEW multi-part MAC constructions; do NOT change `hmacSha256`
 * itself (its single-argument wire semantics are pinned by the wrap-dtag
 * vectors and welcomer-core). Messages here may be at most 2^32-1 bytes
 * (the length prefix is 32-bit).
 */
export function hmacSha256Framed(key, ...msgs) {
    const framed = msgs.map((m) => {
        const out = new Uint8Array(4 + m.length);
        new DataView(out.buffer).setUint32(0, m.length, false);
        out.set(m, 4);
        return out;
    });
    return hmac(sha256, key, concatBytes(...framed));
}
/**
 * Constant-time byte comparison for SECRET material (CRYPTO-01/CRYPTO-02).
 *
 * JS string `===`/`!==` halts at the first differing byte, so comparing
 * hex-encoded secrets with `!==` is a timing oracle on the matching prefix
 * (CWE-208). This walks the FULL length and folds every differing byte into
 * a single accumulator, so the returned boolean reveals nothing about where
 * the mismatch is. Best-effort constant-time in JS (JIT-dependent), like
 * every JS constant-time primitive; noble's `equalBytes` is not exported by
 * the @noble/hashes version in use here, so we keep a dependency-free
 * equivalent. Non-secret equality should stay on `===`.
 */
export function constantTimeEqual(a, b) {
    if (a.length !== b.length)
        return false; // lengths are non-secret in all uses
    let diff = 0;
    for (let i = 0; i < a.length; i++)
        diff |= a[i] ^ b[i];
    return diff === 0;
}
/** Rotating g label (§11): HMAC(label_k, roomId). */
export function rotatingLabel(labelKey, roomId) {
    return bytesToHex(hmacSha256(labelKey, utf8ToBytes(roomId)));
}
// ─── Padding (spec §11): buckets 256 B / 1 KB / 4 KB / 16 KB ──────────────
export const PADDING_BUCKETS = [256, 1024, 4096, 16384];
/**
 * Exactly 24 KB, spec §3.2. NOT 32 KB: NIP-44 v2 applies its own internal
 * padding (8 KB chunks above 32 KB), so a 32 KB bundle → ~66 KB wire event,
 * over strfry's 64 KB maxEventSize. 24 KB → base64 32768 → NIP-44-padded
 * 32768 → ~44.6 KB wire. Measured, not estimated.
 */
export const SEGMENT_CONTENT_SIZE = 24576;
/** Smallest bucket that fits `size`, or null when larger than the max bucket. */
export function paddingBucket(size) {
    for (const b of PADDING_BUCKETS)
        if (size <= b)
            return b;
    return null;
}
/**
 * Length-tagged padding: 4-byte big-endian payload length, payload, zeros to
 * the bucket size. Deterministic and unambiguous.
 */
export function padToBucket(payload, bucket) {
    const total = payload.length + 4;
    if (total > bucket)
        throw new Error(`payload ${payload.length}B + header exceeds bucket ${bucket}B`);
    const out = new Uint8Array(bucket);
    new DataView(out.buffer).setUint32(0, payload.length, false);
    out.set(payload, 4);
    return out;
}
/** Pad a JSON string to a §11 bucket (BYTES). Trailing spaces are legal
 *  JSON whitespace, so decode paths need no unpadding. */
export function padJsonToBucket(json) {
    const bytes = utf8ToBytes(json).length;
    const bucket = paddingBucket(bytes);
    if (bucket === null)
        throw new Error(`content ${bytes}B exceeds max padding bucket`);
    return json + ' '.repeat(bucket - bytes);
}
export function unpadBucket(padded) {
    if (padded.length < 4)
        throw new Error('padded blob too short');
    const len = new DataView(padded.buffer, padded.byteOffset).getUint32(0, false);
    if (len + 4 > padded.length)
        throw new Error('invalid pad length header');
    return padded.subarray(4, 4 + len);
}
export const systemClock = { nowSec: () => Math.floor(Date.now() / 1000) };
/** Deterministic clock for tests. */
export function manualClock(startSec = 1_700_000_000) {
    let t = startSec;
    return {
        nowSec: () => t,
        advance: (sec) => { t += sec; },
        set: (sec) => { t = sec; },
    };
}
/** Vanilla-safe default — works on any public NIP-01 relay (§11, current).
 *  Forward bias inside the acceptance window stock strfry enforces (past
 *  >~60 s and future >~15 min hard-rejected, bisected 2026-08-23). */
export const DEFAULT_PRIVACY_POLICY = { bias: 'forward', windowSec: 600 };
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
export const RELAY_CLASS_POLICIES = {
    public: { bias: 'forward', windowSec: 600 },
    private: { bias: 'backward', windowSec: 172_800 },
};
/** Normalize any accepted privacy input to a full PrivacyPolicy.
 *  - undefined                   → DEFAULT_PRIVACY_POLICY (public posture)
 *  - 'public' / 'private'        → RELAY_CLASS_POLICIES preset
 *  - a bare number               → forward bias with that window (back-compat)
 *  - a full PrivacyPolicy object → validated + returned
 */
export function privacyPolicyFor(policy) {
    if (policy === undefined || policy === null)
        return DEFAULT_PRIVACY_POLICY;
    if (typeof policy === 'number')
        return { bias: 'forward', windowSec: Math.max(0, Math.floor(policy)) };
    if (policy === 'public' || policy === 'private')
        return RELAY_CLASS_POLICIES[policy];
    const p = policy;
    if (p.bias !== 'forward' && p.bias !== 'backward' && p.bias !== 'centered') {
        throw new Error(`bad privacy policy bias: ${String(p.bias)}`);
    }
    if (typeof p.windowSec !== 'number' || !Number.isFinite(p.windowSec) || p.windowSec < 0) {
        throw new Error(`bad privacy policy windowSec: ${String(p.windowSec)}`);
    }
    return { bias: p.bias, windowSec: Math.floor(p.windowSec) };
}
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
export function privacyTimestamp(clock = systemClock, rng = defaultRng, policy = DEFAULT_PRIVACY_POLICY) {
    const p = privacyPolicyFor(policy);
    const r = rng(4);
    const jitter = new DataView(r.buffer).getUint32(0, false) % (p.windowSec + 1);
    const now = clock.nowSec();
    if (p.bias === 'backward')
        return now - jitter;
    if (p.bias === 'centered')
        return now - Math.floor(p.windowSec / 2) + jitter;
    return now + jitter; // forward (default)
}
/** Monotonic created_at for addressable kinds: max(now, previous + 1). */
export function monotonicTimestamp(previousCreatedAt, clock = systemClock) {
    // Far-future pinning (clock skew / restored snapshot) makes relays reject
    // every event — surface it loudly instead of looping silently.
    if (previousCreatedAt !== undefined && previousCreatedAt > clock.nowSec() + 900) {
        console.warn(`[bao/chat] monotonicTimestamp pinned far-future value ${previousCreatedAt} (now ${clock.nowSec()}) — relays will reject; check clock/snapshot`);
    }
    const now = clock.nowSec();
    return previousCreatedAt === undefined ? now : Math.max(now, previousCreatedAt + 1);
}
// ─── Event helpers ──────────────────────────────────────────────────────────
export function signEvent(template, secretKey) {
    return finalizeEvent(template, secretKey);
}
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
export function verifyEvent(event) {
    delete event[verifiedSymbol];
    return verifyEventImpl(event);
}
export function findTag(event, name) {
    return event.tags.find((t) => t[0] === name)?.[1];
}
