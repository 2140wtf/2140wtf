import { type Rng } from './crypto.js';
/** BAO-local CORD-02-A label for the call signer keypair (room NAME = its pk). */
export declare const DM_CALL_SIGNER_LABEL = "bao/dm-call-signer";
/** BAO-local CORD-02-A label for the pairwise media key. */
export declare const DM_CALL_MEDIA_LABEL = "bao/dm-call-media";
/** Caller-minted transcript nonce size (ADR §2): 16 random bytes. */
export declare const DM_CALL_NONCE_BYTES = 16;
/** Per-call X25519 ephemeral keypair; only `pubHex` may leave the device. */
export interface DmCallEphemeral {
    /** 32-byte X25519 secret — never place in a payload or log. */
    secret: Uint8Array;
    /** 32-byte X25519 public key, 64 lowercase hex (rides the wrapped offer/accept). */
    pubHex: string;
}
/** Caller-side mint: transcript nonce + the caller's ephemeral keypair. */
export interface DmCallOfferKeys {
    /** Caller-minted 16-byte nonce (32 lowercase hex) — the transcript binding. */
    callNonceHex: string;
    /** Caller's ephemeral keypair; `ephemeral.pubHex` rides the wrapped offer. */
    ephemeral: DmCallEphemeral;
}
/** The per-call derived secrets both sides agree on. */
export interface DmCallSecrets {
    /** Transcript binding hash (ADR §2), 32 raw bytes. Not a secret. */
    id32: Uint8Array;
    /** `id32` as 64 lowercase hex (state/diagnostics; never a secret). */
    id32Hex: string;
    /** 64-hex call-room NAME: the signer pk used as the broker `voice_room`. */
    roomName: string;
    /** NIP-98 grant signing secret for the broker (schnorr sk for `roomName`). */
    signerSecret: Uint8Array;
    /** 32-byte pairwise media key — input to `deriveSenderKey(mediaKey, sfuIdentity)`. */
    mediaKey: Uint8Array;
}
/** Mint the caller transcript nonce (16 random bytes, 32 lowercase hex). */
export declare function newDmCallNonce(rng?: Rng): string;
/** Mint a per-call ephemeral X25519 keypair. */
export declare function newDmCallEphemeral(rng?: Rng): DmCallEphemeral;
/**
 * Initiator mint (ADR §2): the 16-byte `callNonceHex` and the caller's
 * ephemeral keypair in one call. Put `ephemeral.pubHex` (and, phase 3, the
 * nonce) into the wrapped `call-offer`; keep `ephemeral.secret` local until
 * the accept's ephemeral pub arrives.
 */
export declare function newDmCallOffer(rng?: Rng): DmCallOfferKeys;
/**
 * Transcript binding (ADR §2): `id32 = sha256(utf8(minPk + ':' + maxPk + ':' +
 * callNonceHex))`, pubs sorted lexicographically (equal-length lowercase hex
 * order == bytewise order). Role-independent: both sides get the same id32.
 */
export declare function dmCallId32(pubAHex: string, pubBHex: string, callNonceHex: string): Uint8Array;
/**
 * Responder side (and initiator on accept): given OUR ephemeral secret and
 * the PEER's ephemeral pub from the wrapped offer/accept, derive the shared
 * per-call secrets. Both roles call this with mirrored arguments and get
 * byte-identical results.
 *
 * Throws `ProtocolError` on malformed hex/lengths and on low-order peer
 * points (noble rejects the all-zero X25519 shared secret) — fail closed,
 * never a partial derivation.
 */
export declare function deriveDmCallSecrets(input: {
    /** Our ephemeral X25519 secret (32 raw bytes). */
    secret: Uint8Array;
    /** Peer ephemeral X25519 public key (64 lowercase hex). */
    peerPubHex: string;
    /** Caller-minted nonce from the wrapped offer (32 lowercase hex). */
    callNonceHex: string;
}): DmCallSecrets;
