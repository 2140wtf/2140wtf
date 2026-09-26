/**
 * Attestation chain — spec §2 (key hierarchy), §10 (identity), rule 4.
 *
 * P2 key hierarchy:
 *
 *   Main key (extension / bunker / cold)      → signs ONE persona attestation
 *    └─ Device persona (local, per device)    → signs stream-key sub-attestations
 *        └─ Room stream key (per room/device) → authors ALL room traffic
 *
 * Design constraints (spec §2):
 *   - The main key may live behind a browser extension — certification goes
 *     through the minimal `MainSigner` interface; the nsec is NEVER required.
 *   - Sub-attestations are carried INSIDE the room (envelope payloads,
 *     encrypted to the room content key) — NEVER relay-published (rule 2:
 *     nothing persistent is addressed to a durable key; rule: there is no
 *     public-directory mode).
 *   - Revocation is scoped (one stream key / one persona / the whole tree)
 *     and folds latest-state-wins in (created_at, id) lexicographic order —
 *     arrival order never matters (rule 4). Revocation authority: the
 *     granting key or an ancestor of it in the chain. Equal created_at
 *     tie-break: event id (LOWEST id wins, matching NIP-01 replacement
 *     semantics).
 *
 * Wire form: attestations and revocations are signed Nostr events. They are
 * verified with standard id/signature semantics. Kind is the room-governance
 * state carrier kind (REDACTION_LIST, 31146) with purpose tags — the kind
 * number is load-bearing ONLY for signature verification; these events are
 * never sent to a relay.
 */
import { type NostrEvent, type EventTemplate, type Clock, bytesToHex, hexToBytes } from './crypto.js';
/** Kind used for attestation/revocation events. In-room carriage only —
 *  reuses the governance state carrier kind; never published to a relay. */
export declare const ATTESTATION_CARRIER_KIND = 31146;
/** Main key certifies a device persona (ONE per device, ever). */
export declare const PURPOSE_PERSONA = "bao-attest:persona";
/** Persona certifies a per-room stream key. */
export declare const PURPOSE_STREAM = "bao-attest:stream";
/** Revocation of a persona or stream attestation (scoped). */
export declare const PURPOSE_REVOKE = "bao-attest:revoke";
/**
 * Minimal main-key signer — a browser extension (NIP-07) satisfies this.
 * The nsec is NEVER required anywhere in the hierarchy (spec §2: extension
 * logins don't have it).
 */
export interface MainSigner {
    getPublicKey(): Promise<string> | string;
    signEvent(template: EventTemplate): Promise<NostrEvent> | NostrEvent;
}
/** A local keypair signer (personas, stream keys, tests). */
export interface LocalSigner {
    readonly publicKey: string;
    readonly secretKey: Uint8Array;
}
export declare function localSigner(secretKey: Uint8Array): LocalSigner;
export interface PersonaAttestation {
    event: NostrEvent;
    mainPub: string;
    personaPub: string;
    expiry: number;
}
export interface StreamAttestation {
    event: NostrEvent;
    personaPub: string;
    streamPub: string;
    roomId: string;
    expiry: number;
    /** Event id of the persona attestation this stream cert is bound to.
     *  REQUIRED — defeats persona re-rooting: an attacker main certifying
     *  the same personaPub produces a DIFFERENT persona event id, so a
     *  bound stream chain can never be re-rooted at the attacker's tree. */
    personaEventId: string;
}
export interface Revocation {
    event: NostrEvent;
    /** Pubkey of the signing authority (granter or ancestor). */
    authority: string;
    /** The attestation event id being revoked. */
    targetId: string;
    /** Scope: 'stream' revokes one stream attestation, 'persona' one persona
     *  attestation (and everything below it), 'tree' the whole tree rooted at
     *  the authority's main key. */
    scope: 'stream' | 'persona' | 'tree';
}
/** Default attestation lifetime: 30 days (re-published per epoch in-room). */
export declare const DEFAULT_ATTESTATION_TTL_SEC: number;
/**
 * Main key certifies a device persona. ONE signature per device, ever.
 * Works with an extension signer (async) or a local keypair (sync wrapper).
 */
export declare function certifyPersona(main: MainSigner, personaPub: string, opts?: {
    expiry?: number;
    clock?: Clock;
}): Promise<PersonaAttestation>;
/** Sync convenience for tests/agents holding the main keypair locally.
 *  Implemented directly — NOT via the async interface (a promise .then
 *  never resolves inside a synchronous call). */
export declare function certifyPersonaLocal(mainSecretKey: Uint8Array, personaPub: string, opts?: {
    expiry?: number;
    clock?: Clock;
}): PersonaAttestation;
/** Persona certifies a per-room stream key (local signature — personas are
 *  always local keys, so this is synchronous). `personaEventId` binds the
 *  cert to ONE persona attestation event (anti-re-rooting, spec rule 4):
 *  pass the event id of the persona attestation you hold. */
export declare function certifyStreamKey(personaSecretKey: Uint8Array, streamPub: string, roomId: string, opts: {
    personaEventId: string;
    expiry?: number;
    clock?: Clock;
}): StreamAttestation;
/**
 * Revoke an attestation. Authority: the granting key or an ancestor —
 * enforcement happens in foldAttestations (a revocation signed by an
 * unrelated key is ignored there).
 */
export declare function revokeAttestation(authoritySecretKey: Uint8Array, targetId: string, scope: Revocation['scope'], opts?: {
    clock?: Clock;
}): Revocation;
export declare function parseAttestationEvent(event: NostrEvent): PersonaAttestation | StreamAttestation;
export declare function parseRevocationEvent(event: NostrEvent): Revocation;
/**
 * A full chain for one stream key: the persona attestation (main →
 * persona), the stream attestation (persona → stream), plus any
 * revocations. All events are folded PURELY — arrival order never matters.
 */
export interface AttestationChain {
    persona: PersonaAttestation;
    stream: StreamAttestation;
}
export type ChainVerdict = {
    valid: true;
    chain: AttestationChain;
} | {
    valid: false;
    reason: string;
};
/**
 * Verify a stream ← persona ← main chain against a set of revocations.
 *
 * Authority rule (spec rule 4): a revocation is honored only when signed by
 *   - 'stream' scope: the stream's granting persona, the persona's granting
 *     main key, or the stream key itself (self-revocation).
 *   - 'persona' scope: the persona's granting main key or the persona
 *     itself. Revoking a persona cascades to ALL its stream keys.
 *   - 'tree' scope: the main key only. Revokes everything rooted at it.
 *
 * Latest-state-wins (rule 4): a grant is revoked iff an authoritative
 * revocation targeting it is NEWER than the grant in (created_at, id)
 * order (ties favor the revocation — it sorts later when ids differ, and
 * an identical event cannot be both). An older revocation is superseded
 * by the later grant (re-grant-after-revoke: latest wins). Arrival order
 * never matters — the fold is a pure function of the event set.
 *
 * Time checks (expiry) are evaluated at `nowSec` — pass a fixed value in
 * tests/vector verification for determinism.
 */
export declare function foldChain(persona: PersonaAttestation, stream: StreamAttestation, revocations: Revocation[], opts?: {
    nowSec?: number;
}): ChainVerdict;
/**
 * Verify a room-bound chain end-to-end: signatures already checked at
 * parse; here we bind the stream attestation to the expected room.
 */
export declare function verifyChain(persona: PersonaAttestation, stream: StreamAttestation, roomId: string, revocations?: Revocation[], opts?: {
    nowSec?: number;
}): ChainVerdict;
/**
 * Select the current chain state from an unordered event soup (rule 4,
 * pure function of the event set): given MULTIPLE candidate persona and
 * stream attestations for the same (personaPub, streamPub, roomId), the
 * latest stream attestation + latest persona attestation for its persona
 * win, then foldChain decides — re-grant-after-revoke falls out of the
 * per-grant latest-state-wins comparison inside foldChain.
 */
export declare function foldAttestationSets(personas: PersonaAttestation[], streams: StreamAttestation[], revocations: Revocation[], opts: {
    roomId: string;
    personaPub: string;
    streamPub: string;
    nowSec?: number;
}): ChainVerdict;
/** Envelope payload types for the hierarchy (spec §2: sub-attestations are
 *  re-published every epoch inside the room ciphertext). */
export interface AttestationPayload {
    type: 'attestation';
    chain: {
        persona: NostrEvent;
        stream: NostrEvent;
    };
}
export interface RevocationPayload {
    type: 'attestation-revoke';
    revocation: NostrEvent;
}
export declare function attestationPayload(chain: AttestationChain): AttestationPayload;
export declare function revocationPayload(rev: Revocation): RevocationPayload;
/** Tolerant parse of an in-room attestation payload. Returns null for
 *  foreign payloads (rooms carry app-level content of any shape). */
export declare function parseAttestationPayload(payload: unknown): {
    chain: AttestationChain;
    revocationEvents?: never;
} | null;
/** Tolerant parse of an in-room revocation payload. */
export declare function parseRevocationPayload(payload: unknown): Revocation | null;
export { bytesToHex, hexToBytes };
