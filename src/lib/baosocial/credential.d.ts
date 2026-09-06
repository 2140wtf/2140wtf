import { hexToBytes, bytesToHex } from '@noble/hashes/utils.js';
import { type Clock, type Rng } from './crypto.js';
export { hexToBytes, bytesToHex };
/** Hex (big-endian unsigned) -> bigint. Tolerant: accepts optional 0x,
 *  odd-length hex, and leading zeros. Rejects empty / non-hex. */
export declare function hexToBigint(hex: string): bigint;
/** bigint -> minimal hex (no leading zeros; 0n -> '00'). */
export declare function bigintToHex(v: bigint): string;
/** bigint -> fixed-length hex (left-padded). */
export declare function bigintToHexPadded(v: bigint, bytes: number): string;
/** Hex bytes -> bigint. */
export declare function bytesToBigint(b: Uint8Array): bigint;
export interface RsaPublicKey {
    /** Modulus, hex (big-endian unsigned). */
    n: string;
    /** Public exponent, hex. */
    e: string;
}
export interface RsaPrivateKey {
    /** Modulus, hex. */
    n: string;
    /** Private exponent, hex. */
    d: string;
}
export interface RsaPub {
    n: bigint;
    e: bigint;
    /** Modulus length in bytes (ceil of bit length / 8). */
    k: number;
}
/** Minimum RSA modulus: 2048 bits (256 bytes). Anything smaller parses
 *  but MUST NOT verify — a 512-bit modulus is factorable in practice. */
export declare const MIN_RSA_MODULUS_BYTES = 256;
export declare function parseRsaPublicKey(key: RsaPublicKey): RsaPub;
export declare function parseRsaPrivateKey(key: RsaPrivateKey): {
    n: bigint;
    d: bigint;
    k: number;
};
/**
 * a^b mod m (square-and-multiply). NOT constant-time: work depends on the
 * exponent's Hamming weight, which for rsaBlindSign is the private d.
 * Accepted risk for a browser-safe clean-room BigInt implementation —
 * issuer oracles needing side-channel resistance should back rsaBlindSign
 * with a native RSA implementation (the interface is pluggable).
 */
export declare function modPow(a: bigint, b: bigint, m: bigint): bigint;
/** Modular inverse via extended Euclid. Throws when gcd(a, m) != 1. */
export declare function modInverse(a: bigint, m: bigint): bigint;
export declare const CREDENTIAL_DOMAIN = "bao/credential/v1";
/**
 * MGF1-SHA256: expand a seed to `outLen` bytes.
 */
export declare function mgf1Sha256(seed: Uint8Array, outLen: number): Uint8Array;
/**
 * Full-domain hash of a message to an integer in [0, n). Domain-separated
 * with 'bao/credential/v1'. MGF1-SHA256 expansion to the modulus length,
 * then reduced mod n (slight bias is irrelevant for FDH at these sizes;
 * keeping this dependency-free beats rejection sampling complexity).
 */
export declare function hashToInt(message: string, pub: RsaPub): bigint;
export interface BlindResult {
    /** Blinded message m·r^e mod n, hex padded to modulus length. */
    blinded: string;
    /** Blinding factor r, hex padded to modulus length. Keep secret. */
    unblinder: string;
}
/**
 * Blind a message for issuance: sample r uniformly in Z*_n, output
 * blinded = H(m)·r^e mod n. r MUST be fresh per credential and never
 * reused (reuse across signatures lets the issuer link them).
 */
export declare function rsaBlind(message: string, issuerPub: RsaPublicKey, rng?: Rng): BlindResult;
/**
 * Issuer side: sign a blinded value. blinded^d mod n.
 * The issuer learns NOTHING about the message beyond what the caller
 * reveals — pluggable policy (trade verification etc.) lives in the oracle.
 * NOTE: pure-BigInt modPow is not constant-time (see modPow) — issuers
 * with side-channel requirements should substitute a native signer.
 */
export declare function rsaBlindSign(blinded: string, issuerPriv: RsaPrivateKey): string;
/**
 * Unblind: signature = blindSignature · r^-1 mod n.
 */
export declare function rsaUnblind(blindSignature: string, unblinder: string, issuerPub: RsaPublicKey): string;
/**
 * Verify: signature^e mod n == H(message) mod n.
 */
export declare function rsaVerify(message: string, signature: string, issuerPub: RsaPublicKey): boolean;
/** Room binding: a specific roomId, or 'any' (issuer-blessed wildcard). */
export type RoomBinding = string;
export interface Credential {
    /** Issuer public key (hex n/e) the credential verifies against. */
    issuerPub: RsaPublicKey;
    /** Room this credential admits to, or 'any'. */
    roomId: RoomBinding;
    /** 32 random bytes, hex — one credential = one join. */
    nullifier: string;
    /** Unix seconds; credential is invalid at/after this time. */
    expiry: number;
    /** Optional standing tier (scribe rate budget / invite rights).
     *  SELF-ASSERTED at request time — the issuer blind-signs the message,
     *  so it cannot vet the tier. Deployments gate tiers by using one issuer
     *  key PER TIER and pinning expectedIssuerPub accordingly (welcomer side). */
    tier?: string;
}
/** Canonical JSON — field order fixed, no whitespace. This exact string is
 *  the signed message; any change is a wire-format break. */
export declare function canonicalCredentialMessage(c: Credential): string;
export declare function parseCredential(json: unknown): Credential;
export interface CredentialIssuer {
    /** Issuer public key. */
    readonly pubkey: RsaPublicKey;
    /** Blind-sign a blinded message. The oracle's admission policy (trade
     *  verification, payment, …) lives behind this call — the protocol only
     *  requires the returned blind signature. */
    blindSign(blinded: string): string | Promise<string>;
}
/** Local in-process issuer — tests, demos, and forks' reference impl. */
export declare class LocalCredentialIssuer implements CredentialIssuer {
    readonly pubkey: RsaPublicKey;
    private readonly priv;
    constructor(pubkey: RsaPublicKey, priv: RsaPrivateKey);
    blindSign(blinded: string): string;
}
export interface CredentialRequest {
    credential: Credential;
    /** Blinded message sent to the issuer. */
    blinded: string;
    /** Blinding factor — keep local, needed to unblind. */
    unblinder: string;
}
/**
 * Start a credential request: pick a fresh nullifier, build the canonical
 * credential message, blind it for the issuer.
 */
export declare function createCredentialRequest(roomId: RoomBinding, issuerPub: RsaPublicKey, opts: {
    expiry: number;
    tier?: string;
}, rng?: Rng): CredentialRequest;
/**
 * Finalize after the issuer answers: unblind and sanity-verify the
 * resulting credential signature before trusting it.
 */
export declare function finalizeCredential(blindSignature: string, unblinder: string, request: CredentialRequest): {
    credential: Credential;
    signature: string;
};
export type CredentialRejection = 'malformed' | 'bad-signature' | 'expired' | 'wrong-room' | 'wrong-issuer';
export type CredentialVerdict = {
    ok: true;
} | {
    ok: false;
    reason: CredentialRejection;
};
/**
 * Verify a presented credential: signature over the canonical message,
 * expiry against `now`, room binding, and (when given) expected issuer.
 * Callers (welcomers) MUST pass BOTH `roomId` and `expectedIssuerPub` —
 * without issuer pinning ANY self-signed keypair verifies, and without a
 * room binding an 'any'-room credential roams. Omitting them is only
 * sensible in tests and tooling.
 */
export declare function verifyCredential(credential: Credential, signature: string, opts?: {
    now?: number;
    roomId?: string;
    expectedIssuerPub?: RsaPublicKey;
}): CredentialVerdict;
/**
 * One credential = one join. Same TTL+grace discipline as the §5.2
 * ReplayCache: entries live for the credential TTL plus a grace window so
 * a spent nullifier cannot be re-presented while it could still be valid.
 */
export declare class NullifierCache {
    private readonly clock;
    private readonly seen;
    constructor(clock?: Clock, limit?: number);
    /**
     * Returns true when the nullifier was NEW (admission may proceed);
     * false on replay. `ttlWithGraceSec` bounds the entry lifetime — callers
     * pass (credential TTL remaining + grace), mirroring ReplayCache usage.
     */
    checkAndInsert(nullifier: string, ttlWithGraceSec: number): boolean;
    has(nullifier: string): boolean;
    private sweep;
    get size(): number;
}
