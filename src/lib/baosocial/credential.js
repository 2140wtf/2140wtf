/**
 * credential — P3 blind-signed admission credentials (spec §7 scheme note,
 * §17 P3).
 *
 * RSA blind signatures (Chaum), NOT Cashu BDHKE: a welcomer must be able to
 * third-party-verify a credential with only the issuer's public key, and
 * rule 8 forbids an API round-trip on the join path. The issuer is a
 * pluggable blind-signature ORACLE consulted off the chat correctness path
 * (forks substitute their own).
 *
 * Clean-room, pure BigInt — no new dependencies, no node-only globals
 * (BigInt + @noble/hashes only). Keys are hex strings (big-endian unsigned)
 * with tolerant parsing; key generation is NOT the library's job.
 *
 * One credential = one join: the welcomer-side NullifierCache is bounded
 * state (same TTL+grace pattern as the §5.2 ReplayCache), enforcing one
 * nullifier = one admission while the issuer never learns when/where a
 * credential is spent.
 *
 * Unlinkability (structural): the issuer only ever sees the blinded value
 * m·r^e mod n; the final signature is (m·r^e)^d · r^-1 = m^d mod n. With r
 * uniform in Z*_n and unknown to the issuer, the pair (blinded, signature)
 * is information-theoretically unlinkable.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes, concatBytes, hexToBytes, bytesToHex } from '@noble/hashes/utils.js';
import { systemClock, defaultRng, } from './crypto.js';
export { hexToBytes, bytesToHex };
// ─── BigInt <-> bytes helpers ──────────────────────────────────────────────
/** Hex (big-endian unsigned) -> bigint. Tolerant: accepts optional 0x,
 *  odd-length hex, and leading zeros. Rejects empty / non-hex. */
export function hexToBigint(hex) {
    let h = hex.trim().toLowerCase();
    if (h.startsWith('0x'))
        h = h.slice(2);
    if (h.length === 0)
        throw new Error('empty hex');
    if (!/^[0-9a-f]+$/.test(h))
        throw new Error(`invalid hex: '${hex.slice(0, 24)}…'`);
    return BigInt(`0x${h}`);
}
/** bigint -> minimal hex (no leading zeros; 0n -> '00'). */
export function bigintToHex(v) {
    if (v < 0n)
        throw new Error('negative value');
    const h = v.toString(16);
    return h.length % 2 === 0 ? h : `0${h}`;
}
/** bigint -> fixed-length hex (left-padded). */
export function bigintToHexPadded(v, bytes) {
    const h = bigintToHex(v);
    const want = bytes * 2;
    if (h.length > want)
        throw new Error(`value too large for ${bytes} bytes`);
    return h.padStart(want, '0');
}
/** Hex bytes -> bigint. */
export function bytesToBigint(b) {
    return hexToBigint(bytesToHex(b));
}
/** Minimum RSA modulus: 2048 bits (256 bytes). Anything smaller parses
 *  but MUST NOT verify — a 512-bit modulus is factorable in practice. */
export const MIN_RSA_MODULUS_BYTES = 256;
export function parseRsaPublicKey(key) {
    const n = hexToBigint(key.n);
    const e = hexToBigint(key.e);
    if (n <= 0n)
        throw new Error('modulus must be positive');
    if (n % 2n === 0n)
        throw new Error('modulus must be odd');
    if (e !== 3n && e !== 65537n)
        throw new Error('exponent must be 3 or 65537');
    if (e >= n)
        throw new Error('exponent must be < modulus');
    const k = Math.ceil(n.toString(2).length / 8);
    if (k < MIN_RSA_MODULUS_BYTES)
        throw new Error(`modulus too small (${k * 8} bits < 2048)`);
    return { n, e, k };
}
export function parseRsaPrivateKey(key) {
    const n = hexToBigint(key.n);
    const d = hexToBigint(key.d);
    if (n <= 0n)
        throw new Error('modulus must be positive');
    if (n % 2n === 0n)
        throw new Error('modulus must be odd');
    if (d <= 0n || d >= n)
        throw new Error('private exponent out of range');
    const k = Math.ceil(n.toString(2).length / 8);
    if (k < MIN_RSA_MODULUS_BYTES)
        throw new Error(`modulus too small (${k * 8} bits < 2048)`);
    return { n, d, k };
}
// ─── Modular arithmetic ────────────────────────────────────────────────────
/**
 * a^b mod m (square-and-multiply). NOT constant-time: work depends on the
 * exponent's Hamming weight, which for rsaBlindSign is the private d.
 * Accepted risk for a browser-safe clean-room BigInt implementation —
 * issuer oracles needing side-channel resistance should back rsaBlindSign
 * with a native RSA implementation (the interface is pluggable).
 */
export function modPow(a, b, m) {
    if (m === 1n)
        return 0n;
    let base = ((a % m) + m) % m;
    let exp = b;
    let result = 1n;
    while (exp > 0n) {
        if (exp & 1n)
            result = (result * base) % m;
        base = (base * base) % m;
        exp >>= 1n;
    }
    return result;
}
/** Modular inverse via extended Euclid. Throws when gcd(a, m) != 1. */
export function modInverse(a, m) {
    let [oldR, r] = [((a % m) + m) % m, m];
    let [oldS, s] = [1n, 0n];
    while (r !== 0n) {
        const q = oldR / r;
        [oldR, r] = [r, oldR - q * r];
        [oldS, s] = [s, oldS - q * s];
    }
    if (oldR !== 1n)
        throw new Error('not invertible');
    return ((oldS % m) + m) % m;
}
// ─── RSA-FDH message hashing (domain-separated, MGF1-SHA256 expansion) ─────
export const CREDENTIAL_DOMAIN = 'bao/credential/v1';
/**
 * MGF1-SHA256: expand a seed to `outLen` bytes.
 */
export function mgf1Sha256(seed, outLen) {
    const out = new Uint8Array(outLen);
    let written = 0;
    for (let counter = 0; written < outLen; counter++) {
        const c = new Uint8Array(4);
        new DataView(c.buffer).setUint32(0, counter, false);
        const block = sha256(concatBytes(seed, c));
        const take = Math.min(block.length, outLen - written);
        out.set(block.subarray(0, take), written);
        written += take;
    }
    return out;
}
/**
 * Full-domain hash of a message to an integer in [0, n). Domain-separated
 * with 'bao/credential/v1'. MGF1-SHA256 expansion to the modulus length,
 * then reduced mod n (slight bias is irrelevant for FDH at these sizes;
 * keeping this dependency-free beats rejection sampling complexity).
 */
export function hashToInt(message, pub) {
    const digest = sha256(concatBytes(utf8ToBytes(CREDENTIAL_DOMAIN), utf8ToBytes(message)));
    const expanded = mgf1Sha256(digest, pub.k);
    return bytesToBigint(expanded) % pub.n;
}
/**
 * Blind a message for issuance: sample r uniformly in Z*_n, output
 * blinded = H(m)·r^e mod n. r MUST be fresh per credential and never
 * reused (reuse across signatures lets the issuer link them).
 */
export function rsaBlind(message, issuerPub, rng = defaultRng) {
    const pub = parseRsaPublicKey(issuerPub);
    const h = hashToInt(message, pub);
    let r = 0n;
    for (let attempt = 0; attempt < 1000; attempt++) {
        const candidate = bytesToBigint(rng(pub.k)) % pub.n;
        if (candidate > 1n && gcd(candidate, pub.n) === 1n) {
            r = candidate;
            break;
        }
    }
    if (r === 0n)
        throw new Error('failed to sample blinding factor');
    const blinded = (h * modPow(r, pub.e, pub.n)) % pub.n;
    return {
        blinded: bigintToHexPadded(blinded, pub.k),
        unblinder: bigintToHexPadded(r, pub.k),
    };
}
function gcd(a, b) {
    let [x, y] = [a < 0n ? -a : a, b < 0n ? -b : b];
    while (y !== 0n)
        [x, y] = [y, x % y];
    return x;
}
/**
 * Issuer side: sign a blinded value. blinded^d mod n.
 * The issuer learns NOTHING about the message beyond what the caller
 * reveals — pluggable policy (trade verification etc.) lives in the oracle.
 * NOTE: pure-BigInt modPow is not constant-time (see modPow) — issuers
 * with side-channel requirements should substitute a native signer.
 */
export function rsaBlindSign(blinded, issuerPriv) {
    const { n, d, k } = parseRsaPrivateKey(issuerPriv);
    const b = hexToBigint(blinded);
    if (b <= 0n || b >= n)
        throw new Error('blinded value out of range');
    return bigintToHexPadded(modPow(b, d, n), k);
}
/**
 * Unblind: signature = blindSignature · r^-1 mod n.
 */
export function rsaUnblind(blindSignature, unblinder, issuerPub) {
    const pub = parseRsaPublicKey(issuerPub);
    const s = hexToBigint(blindSignature);
    const r = hexToBigint(unblinder);
    if (s <= 0n || s >= pub.n)
        throw new Error('blind signature out of range');
    const rInv = modInverse(r, pub.n);
    return bigintToHexPadded((s * rInv) % pub.n, pub.k);
}
/**
 * Verify: signature^e mod n == H(message) mod n.
 */
export function rsaVerify(message, signature, issuerPub) {
    try {
        const pub = parseRsaPublicKey(issuerPub);
        const s = hexToBigint(signature);
        if (s <= 0n || s >= pub.n)
            return false;
        const h = hashToInt(message, pub);
        return modPow(s, pub.e, pub.n) === h;
    }
    catch {
        return false;
    }
}
/** Canonical JSON — field order fixed, no whitespace. This exact string is
 *  the signed message; any change is a wire-format break. */
export function canonicalCredentialMessage(c) {
    const fields = [
        ['expiry', c.expiry],
        ['issuer_n', normalizeHex(c.issuerPub.n)],
        ['issuer_e', normalizeHex(c.issuerPub.e)],
        ['nullifier', c.nullifier],
        ['roomId', c.roomId],
    ];
    if (c.tier !== undefined)
        fields.push(['tier', c.tier]);
    fields.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const inner = fields.map(([k, v]) => `${JSON.stringify(k)}:${typeof v === 'number' ? String(v) : JSON.stringify(v)}`).join(',');
    return `{${inner}}`;
}
function normalizeHex(hex) {
    // canonical: minimal lowercase hex without 0x
    return bigintToHex(hexToBigint(hex));
}
export function parseCredential(json) {
    const c = json;
    if (typeof c !== 'object' || c === null)
        throw new Error('credential must be an object');
    if (typeof c.issuerPub !== 'object' || c.issuerPub === null)
        throw new Error('missing issuerPub');
    parseRsaPublicKey(c.issuerPub); // validates
    if (typeof c.roomId !== 'string' || c.roomId.length === 0)
        throw new Error('invalid roomId');
    if (c.roomId !== 'any' && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(c.roomId))
        throw new Error('invalid roomId');
    if (typeof c.nullifier !== 'string' || !/^[0-9a-f]{64}$/.test(c.nullifier))
        throw new Error('nullifier must be 32 bytes hex');
    if (!Number.isSafeInteger(c.expiry) || c.expiry < 0)
        throw new Error('invalid expiry');
    if (c.tier !== undefined && (typeof c.tier !== 'string' || !/^[a-z0-9-]{1,32}$/.test(c.tier)))
        throw new Error('invalid tier');
    return c;
}
/** Local in-process issuer — tests, demos, and forks' reference impl. */
export class LocalCredentialIssuer {
    constructor(pubkey, priv) {
        this.pubkey = pubkey;
        this.priv = priv;
    }
    blindSign(blinded) {
        return rsaBlindSign(blinded, this.priv);
    }
}
/**
 * Start a credential request: pick a fresh nullifier, build the canonical
 * credential message, blind it for the issuer.
 */
export function createCredentialRequest(roomId, issuerPub, opts, rng = defaultRng) {
    const credential = {
        issuerPub,
        roomId,
        nullifier: bytesToHex(rng(32)),
        expiry: opts.expiry,
        ...(opts.tier !== undefined ? { tier: opts.tier } : {}),
    };
    parseCredential(credential);
    const { blinded, unblinder } = rsaBlind(canonicalCredentialMessage(credential), issuerPub, rng);
    return { credential, blinded, unblinder };
}
/**
 * Finalize after the issuer answers: unblind and sanity-verify the
 * resulting credential signature before trusting it.
 */
export function finalizeCredential(blindSignature, unblinder, request) {
    const signature = rsaUnblind(blindSignature, unblinder, request.credential.issuerPub);
    if (!rsaVerify(canonicalCredentialMessage(request.credential), signature, request.credential.issuerPub)) {
        throw new Error('issuer returned an invalid blind signature');
    }
    return { credential: request.credential, signature };
}
/**
 * Verify a presented credential: signature over the canonical message,
 * expiry against `now`, room binding, and (when given) expected issuer.
 * Callers (welcomers) MUST pass BOTH `roomId` and `expectedIssuerPub` —
 * without issuer pinning ANY self-signed keypair verifies, and without a
 * room binding an 'any'-room credential roams. Omitting them is only
 * sensible in tests and tooling.
 */
export function verifyCredential(credential, signature, opts = {}) {
    try {
        parseCredential(credential);
    }
    catch {
        return { ok: false, reason: 'malformed' };
    }
    if (opts.expectedIssuerPub) {
        if (normalizeHex(credential.issuerPub.n) !== normalizeHex(opts.expectedIssuerPub.n) ||
            normalizeHex(credential.issuerPub.e) !== normalizeHex(opts.expectedIssuerPub.e)) {
            return { ok: false, reason: 'wrong-issuer' };
        }
    }
    if (opts.roomId && credential.roomId !== 'any' && credential.roomId !== opts.roomId) {
        return { ok: false, reason: 'wrong-room' };
    }
    const now = opts.now ?? systemClock.nowSec();
    if (credential.expiry <= now)
        return { ok: false, reason: 'expired' };
    if (!rsaVerify(canonicalCredentialMessage(credential), signature, credential.issuerPub)) {
        return { ok: false, reason: 'bad-signature' };
    }
    return { ok: true };
}
// ─── Nullifier cache (welcomer-side bounded state, §7) ────────────────────
/**
 * One credential = one join. Same TTL+grace discipline as the §5.2
 * ReplayCache: entries live for the credential TTL plus a grace window so
 * a spent nullifier cannot be re-presented while it could still be valid.
 */
export class NullifierCache {
    constructor(clock = systemClock, limit = 8192) {
        this.clock = clock;
        /** Hard growth cap (round 26, parity with ReplayCache/TtlKeySet): a
         * flood of validly-issued, validly-solved credentials would otherwise
         * grow the Map for the whole TTL+grace window. Expired entries are
         * swept first; over the cap, OLDEST survivors are evicted per key —
         * never a bulk wipe (that would drop ALL nullifier protection). */
        this.limit = limit;
        this.seen = new Map(); // nullifier -> cache expiry
    }
    /**
     * Returns true when the nullifier was NEW (admission may proceed);
     * false on replay. `ttlWithGraceSec` bounds the entry lifetime — callers
     * pass (credential TTL remaining + grace), mirroring ReplayCache usage.
     */
    checkAndInsert(nullifier, ttlWithGraceSec) {
        if (!/^[0-9a-f]{64}$/.test(nullifier))
            throw new Error('nullifier must be 32 bytes hex');
        this.sweep();
        if (this.seen.has(nullifier))
            return false;
        this.seen.set(nullifier, this.clock.nowSec() + ttlWithGraceSec);
        this.evictOldestIfOverLimit();
        return true;
    }
    evictOldestIfOverLimit() {
        if (this.seen.size <= this.limit)
            return;
        const oldest = [...this.seen.entries()].sort((a, b) => a[1] - b[1]);
        for (let i = 0; i < oldest.length && this.seen.size > this.limit; i++)
            this.seen.delete(oldest[i][0]);
    }
    has(nullifier) {
        this.sweep();
        return this.seen.has(nullifier);
    }
    sweep() {
        const now = this.clock.nowSec();
        for (const [k, exp] of this.seen)
            if (exp <= now)
                this.seen.delete(k);
    }
    get size() {
        this.sweep();
        return this.seen.size;
    }
}
