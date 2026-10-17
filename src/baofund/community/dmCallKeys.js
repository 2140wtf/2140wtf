/**
 * dmCallKeys — per-call key agreement for 1:1 DM voice calls
 * (ADR-dm-calls.md § Proposed shape 2, phase 2).
 *
 * The DM lane (`src/dm.ts`) carries the wrapped `call-offer`/`call-accept`
 * payloads; this module turns the ephemeral X25519 keys exchanged inside them
 * into the call's working secrets:
 *
 *   1. each side mints a per-call ephemeral X25519 keypair — the public half
 *      rides the wrapped offer/accept, the secret never leaves the device.
 *      The NIP-17 seal is signed by the real identity key, so the DH inputs
 *      are authenticated for free (no re-authentication needed);
 *   2. both sides compute the X25519 shared secret and bind the transcript:
 *      `id32 = sha256(utf8(minPk + ':' + maxPk + ':' + callNonceHex))` over
 *      the two ephemeral pubs (lexicographic hex order) and the caller-minted
 *      16-byte nonce — kills cross-pair and replay key reuse;
 *   3. the CORD-02-A HKDF shape (the repo's one labeled-KDF authority, see
 *      `adapters/concordKeys`) with BAO-local labels derives
 *      `bao/dm-call-signer` → the 64-hex call-room NAME (the signer schnorr
 *      pk, used verbatim as the broker `voice_room` / LiveKit room) and
 *      `bao/dm-call-media` → the 32-byte pairwise media key. Media sender
 *      keys come from the existing `deriveSenderKey(mediaKey, sfuIdentity)`
 *      so DM call media matches the room voice stack exactly.
 *
 * Deliberately out of scope here (ADR phase plan): carrying the pubs in the
 * wrapped payloads is phase-3 client work, and the broker/SFU wiring (mint the
 * SFU token on accept, SFU watchdog) is phase 4. This module adds no wire
 * format and never routes through `keySchedule` (wallet/identity KDF).
 *
 * All randomness goes through the injected `Rng` seam (default `defaultRng`)
 * so tests and vectors are deterministic. Every input is validated
 * fail-closed: malformed hex, wrong lengths, and low-order peer points
 * (all-zero X25519 shared secret) throw — never a partial result.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, hexToBytes, utf8ToBytes, defaultRng } from './crypto.js';
import { concordGroupKey, concordRawKey } from './adapters/concordKeys.js';
import { ProtocolError } from './protocolError.js';
/** BAO-local CORD-02-A label for the call signer keypair (room NAME = its pk). */
export const DM_CALL_SIGNER_LABEL = 'bao/dm-call-signer';
/** BAO-local CORD-02-A label for the pairwise media key. */
export const DM_CALL_MEDIA_LABEL = 'bao/dm-call-media';
/** Caller-minted transcript nonce size (ADR §2): 16 random bytes. */
export const DM_CALL_NONCE_BYTES = 16;
const PUB_HEX_RE = /^[0-9a-f]{64}$/;
const NONCE_HEX_RE = /^[0-9a-f]{32}$/;
function assertPubHex(field, value) {
    if (typeof value !== 'string' || !PUB_HEX_RE.test(value)) {
        throw new ProtocolError('malformed', `${field} must be 64 lowercase hex chars`);
    }
    return value;
}
function assertNonceHex(field, value) {
    if (typeof value !== 'string' || !NONCE_HEX_RE.test(value)) {
        throw new ProtocolError('malformed', `${field} must be 32 lowercase hex chars`);
    }
    return value;
}
function assertEphemeralSecret(field, value) {
    if (!(value instanceof Uint8Array) || value.length !== 32) {
        throw new ProtocolError('malformed', `${field} must be 32 raw bytes`);
    }
    return value;
}
/** Draw exactly `bytes` from the RNG seam; a short/oversize draw is a bug, not entropy. */
function draw(rng, bytes) {
    const out = rng(bytes);
    if (!(out instanceof Uint8Array) || out.length !== bytes) {
        throw new ProtocolError('malformed', `rng must return exactly ${bytes} bytes`);
    }
    return new Uint8Array(out); // defensive copy: callers never alias rng buffers
}
/** Mint the caller transcript nonce (16 random bytes, 32 lowercase hex). */
export function newDmCallNonce(rng = defaultRng) {
    return bytesToHex(draw(rng, DM_CALL_NONCE_BYTES));
}
/** Mint a per-call ephemeral X25519 keypair. */
export function newDmCallEphemeral(rng = defaultRng) {
    const secret = draw(rng, 32);
    return { secret, pubHex: bytesToHex(x25519.getPublicKey(secret)) };
}
/**
 * Initiator mint (ADR §2): the 16-byte `callNonceHex` and the caller's
 * ephemeral keypair in one call. Put `ephemeral.pubHex` (and, phase 3, the
 * nonce) into the wrapped `call-offer`; keep `ephemeral.secret` local until
 * the accept's ephemeral pub arrives.
 */
export function newDmCallOffer(rng = defaultRng) {
    return { callNonceHex: newDmCallNonce(rng), ephemeral: newDmCallEphemeral(rng) };
}
/**
 * Transcript binding (ADR §2): `id32 = sha256(utf8(minPk + ':' + maxPk + ':' +
 * callNonceHex))`, pubs sorted lexicographically (equal-length lowercase hex
 * order == bytewise order). Role-independent: both sides get the same id32.
 */
export function dmCallId32(pubAHex, pubBHex, callNonceHex) {
    const a = assertPubHex('pubAHex', pubAHex);
    const b = assertPubHex('pubBHex', pubBHex);
    const nonce = assertNonceHex('callNonceHex', callNonceHex);
    const [minPk, maxPk] = a <= b ? [a, b] : [b, a];
    return sha256(utf8ToBytes(`${minPk}:${maxPk}:${nonce}`));
}
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
export function deriveDmCallSecrets(input) {
    const secret = assertEphemeralSecret('secret', input.secret);
    const peerPubHex = assertPubHex('peerPubHex', input.peerPubHex);
    const callNonceHex = assertNonceHex('callNonceHex', input.callNonceHex);
    const ourPubHex = bytesToHex(x25519.getPublicKey(secret));
    const id32 = dmCallId32(ourPubHex, peerPubHex, callNonceHex);
    let shared;
    try {
        shared = x25519.getSharedSecret(secret, hexToBytes(peerPubHex));
    }
    catch {
        // noble throws on the all-zero shared secret (low-order / identity pub).
        throw new ProtocolError('malformed', 'peer ephemeral public key is invalid (low-order point)');
    }
    // CORD-02-A shapes with BAO-local labels (ADR §2). The cast is intentional:
    // the construction is the frozen A.6 one, the label is BAO-local and carries
    // no epoch field (not in the A.6 epoch table), and no CORD claim is made.
    const signer = concordGroupKey({ label: DM_CALL_SIGNER_LABEL, secret: shared, id: id32 });
    const mediaKey = concordRawKey(DM_CALL_MEDIA_LABEL, shared, id32);
    return { id32, id32Hex: bytesToHex(id32), roomName: signer.pk, signerSecret: signer.sk, mediaKey };
}
