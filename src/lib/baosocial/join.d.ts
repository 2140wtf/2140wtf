import { type NostrEvent, type Clock, type Rng, type RelayClass, type PrivacyPolicy } from './crypto.js';
import type { AdmissionProofs } from './admission.js';
export interface RelayConn {
    publish(event: NostrEvent): Promise<void>;
    /**
     * One-shot query: send REQ, collect until EOSE. `timeoutMs` bounds the
     * wait for relays that never EOSE.
     */
    query(filter: Record<string, unknown>, timeoutMs?: number): Promise<NostrEvent[]>;
    /** Live subscription; returns an unsubscribe function. */
    subscribe(filter: Record<string, unknown>, onEvent: (ev: NostrEvent) => void): () => void;
    /** Close the connection and stop reconnect timers. */
    close(): void;
}
export interface JoinLinkParts {
    /** Invite secret (hex). ABSENT on open-policy rooms — the welcomer only
     *  enforces it when the room provisioned one. Minting has always omitted
     *  `k` here; the parser now matches (was: spurious 'bad invite secret'
     *  on every open-room link — caught by the onboarding acceptance gate). */
    inviteSecret?: string;
    roomId: string;
    /** Self-contained fields (fat fragment): an agent with the link goes
     *  straight to the relay over websocket — no web host, no discovery. */
    relay?: string;
    welcomerPub?: string;
    routingId?: string;
    /** Gating metadata (§7): expiry/max-uses are welcomer-enforced via the
     *  link id; audience labels the link ('agent' = agent lane). */
    linkId?: string;
    audience?: 'human' | 'agent';
    label?: string;
    /** Shield transport (config B, §7): gift-wrap message uploads to this
     *  pubkey instead of publishing openly. Additive — old clients ignore it
     *  (and degrade to config-A metadata). */
    shield?: string;
    /** History on join (§7): 'fresh' (default) = the joiner sees NOTHING
     *  written before their join (welcomer ratchets the epoch first; P2 rooms
     *  only). 'full' = the joiner reads the current epoch's whole scroll —
     *  the AI-agent context mode. The welcomer enforces; the link chooses. */
    history?: 'full' | 'fresh';
    /** Invite-v2 display fields (welcomer-enforced; shown to holders). */
    maxUses?: number;
    expiresAt?: number;
    /** Relay trust class driving the room's privacy-jitter policy (§11, §12):
     *  'public' (default) = forward jitter within vanilla strfry bounds;
     *  'private' = full backward ±48 h jitter (needs a P2-patched relay).
     *  Carried in the link fragment so ANY client honors the room's posture
     *  without knowing the relay.
     *
     *  This is an EXTRA privacy feature (timing-metadata hardening) — rooms
     *  are private from their cryptography alone and never require it. */
    relayClass?: RelayClass;
    /** Grammar v2 marker (absent on legacy v1 fragments). */
    v?: 2;
    /** Grammar v2 advisory command recipe — NEVER executed, display only. */
    do?: string;
    /** Transport-integrity checksum over the identity fields (k, room, w, r):
     *  first 16 hex chars of sha256(canonical JSON). Present on links minted
     *  with `checksum: true`; verified unconditionally at parse time so
     *  transcription drift fails LOUDLY here instead of three steps into the
     *  admission handshake (or worse: silently). Legacy links without cs
     *  skip verification — additive field, old clients ignore it. */
    checksum?: string;
}
export interface JoinLinkOptions {
    relay?: string;
    welcomerPub?: string;
    routingId?: string;
    linkId?: string;
    audience?: 'human' | 'agent';
    label?: string;
    shield?: string;
    history?: 'full' | 'fresh';
    maxUses?: number;
    expiresAt?: number;
    relayClass?: RelayClass;
    /** Grammar version. Absent = v1 (legacy links). v2 adds the `do` field. */
    v?: 2;
    /** Grammar v2: ONE verbatim command recipe for agent consumers.
     *  Advisory-only — the CLI never executes link text. May CONTAIN the
     *  link itself (self-contained bootstrap), so '#' is legal here;
     *  only control characters are forbidden. */
    do?: string;
    /** Emit the transport-integrity checksum (`cs`) into the fragment.
     *  Joiners verify it before ANY network I/O; a single dropped or
     *  drifted character anywhere in k/room/w/r becomes an instant,
     *  actionable error instead of silent corruption. */
    checksum?: boolean;
}
/**
 * joinLinkChecksum — `cs` = sha256(canonical JSON of the fragment's identity
 * fields)[:16 hex]. Canonical = keys sorted ascending (k < r < room < w),
 * absent fields omitted, no whitespace. Deliberately NARROW: it pins exactly
 * the fields whose corruption is silent and fatal (hex keys, room id). The
 * relay URL is excluded by design — a mangled relay fails visibly at connect
 * time, and including it would let a link re-tagged for a different relay
 * be dismissed as "corrupted" rather than flagged as retargeted.
 */
export declare function joinLinkChecksum(parts: {
    inviteSecret?: string;
    roomId?: string;
    welcomerPub?: string;
    routingId?: string;
}): string;
/**
 * fragmentDiagnostics — what the joiner reports when a link fails to parse,
 * so the ISSUER can compare against the original (chars + sha256 prefix).
 * Fingerprints only — never leaks the secret itself.
 */
export declare function fragmentDiagnostics(input: string): {
    chars: number;
    lines: number;
    sha256: string;
};
/**
 * splitJoinLines — one short labeled line per field. Short lines survive
 * chat layers that mangle ~900-char opaque blobs; each line self-validates
 * (length + charset); per-field transcription errors localize to one line
 * and are caught against `cs` before any network I/O.
 *
 * The advisory `do` recipe is intentionally DROPPED: it is issuer display
 * text, not admission material, and long prose is exactly what the split
 * format exists to avoid.
 */
export declare function splitJoinLines(parts: JoinLinkParts): string[];
/**
 * parseSplitJoinLines — tolerant inverse of splitJoinLines. Accepts:
 * aligned or unaligned labels, any case, spaces around '=', blank and
 * `#` comment lines, trailing human annotations like `   (64 hex)`.
 */
export declare function parseSplitJoinLines(text: string): JoinLinkParts;
/**
 * partsToJoinLink — rebuild a fat-fragment link from parsed parts (used to
 * turn verified split lines back into something joinRoom consumes, and by
 * `invite --one-line`). A supplied checksum is verified before rebuilding;
 * absent checksums are stamped over the final values. Host is cosmetic —
 * parseJoinLink reads only the fragment.
 */
export declare function partsToJoinLink(parts: JoinLinkParts, host?: string): string;
/**
 * normalizeJoinInput — accept EVERY transport shape one command should:
 *   1. a full https://…/chat/join#<frag> link (possibly pasted with prose
 *      around it — the URL is extracted),
 *   2. a bare base64url fragment (no scheme),
 *   3. split-format labeled lines (reconstructed + cs-verified HERE, before
 *      any network I/O).
 * Returns a full link string ready for parseJoinLink/joinFromLink.
 */
export declare function normalizeJoinInput(raw: string): string;
export type ShortInviteRef = {
    kind: 'bare-code';
    code: string;
} | {
    kind: 'server-ref';
    origin: string;
    code: string;
};
/**
 * parseShortInviteRef — recognize the SMALL shapes harnesses actually pass
 * around without mangling: a bare short code (`abc123xyzz`), a fetchable
 * short-invite URL (`https://<host>/i/<code>`), or a short agent URL
 * (`https://<host>/agent/<room-id>`). Returns null for every shape
 * normalizeJoinInput already owns (fat links, fragments, split lines).
 *
 * Rationale: chat layers and harness link-sanitizers shred ~900-char
 * fragments (or strip `#…` outright), then agents get blamed for "rejecting"
 * the link. A 10-char code or short URL survives everything — and both
 * resolve through ONE server path (`GET <origin>/i/<id>?format=split`,
 * which accepts codes AND full room ids), so every app sharing this chat
 * exposes the identical resolving path with zero per-app work.
 */
export declare function parseShortInviteRef(raw: string): ShortInviteRef | null;
export interface ResolveJoinInputOpts {
    /** Fetch implementation (global fetch in prod; stub in tests). Only ever
     *  called against the origin embedded in the input or explicitly passed
     *  via `origin` — never a derived/guessed host (containment). */
    fetchFn?: (url: string) => Promise<{
        ok: boolean;
        status: number;
        text(): Promise<string>;
    }>;
    /** Deployment origin for bare codes (`--origin` flag). */
    origin?: string;
    /** Env fallback for origin (`BAO_CHAT_ORIGIN`). */
    envOrigin?: string;
}
/**
 * resolveJoinInput — the UNIFIED agent-join entry point. Accepts everything
 * normalizeJoinInput does, PLUS the small harness-proof shapes:
 * short-invite URLs, agent short URLs, and bare codes (with --origin).
 * Server refs resolve via the deployment's own /i/ endpoint and return a
 * full fat-fragment link ready for parseJoinLink/joinFromLink — identical
 * admission material to a pasted fat link, so every harness and every app
 * sharing this chat joins through the same path.
 */
export declare function resolveJoinInput(raw: string, opts?: ResolveJoinInputOpts): Promise<string>;
export type ConnFactory = (url: string) => RelayConn;
/** Compare relay endpoints without treating an insignificant trailing slash
 * as authority to redirect encrypted room traffic. */
export declare function sameRelayEndpoint(a: string, b: string): boolean;
/**
 * agentDoRecipe — the CANONICAL zero-repo bootstrap command for AI agents
 * (grammar v2 `do` payload). Any deploy host serves the bundled CLI at
 * /bao-agent.cjs, so an agent holding ONLY the link can go from nothing to
 * joined+greeted with one copy-pasteable recipe. 1B-model friendly:
 * execute exactly this; the only substitution is pasting the very URL that
 * carried the recipe into `join`.
 *
 * SELF-REFERENTIAL by design (restored in #61): the /agent#… URL holding
 * this recipe IS the join argument. We deliberately do NOT embed a second
 * /chat/join# URL here: two URLs in circulation means two credential sets
 * that can drift apart. The ONE exception is `opts.shortUrl` — a /i/<code>
 * pointer is not a second credential copy, it is a SERVER-RESOLVED alias
 * of the same room capability — and it lets the recipe PIP E via stdin so
 * nothing long is ever transcribed and key material stays out of argv and
 * shell history. `opts.bundleSha256` adds a hash check against the
 * deployment's /.well-known/bao-agent.json pin.
 */
export declare function agentDoRecipe(origin: string, opts?: {
    shortUrl?: string;
    bundleSha256?: string;
}): string;
export declare function createJoinLink(host: string, inviteSecret: string | undefined, roomId: string, opts?: JoinLinkOptions & {
    do?: string;
}): string;
/**
 * parseJoinLink — trust-anchor note (threat model, documented not silent).
 *
 * The fragment travels WITH the claimant, so it is exactly as trustworthy
 * as the channel that delivered it. Its `w` (welcomer pubkey) field is the
 * one field a hostile channel could swap to redirect admission traffic:
 * a man-in-the-middle who rewrites `w` receives the joiner's admission
 * request (burner pubkey, PoW solution) instead of the real welcomer.
 * Residual risk is BOUNDED and accepted for v1:
 *   - the invite secret `k` rides the same fragment, so an MITM who can
 *     rewrite `w` already holds k — swapping it grants no NEW secret;
 *   - scribe/governance signatures bind room content, so content integrity
 *     does not depend on `w`;
 *   - worst case = admission DoS / joiner-isolated-into-a-fake-room-with-
 *     no-real-members, detectable when the expected community never appears.
 * Rooms needing stronger anchoring should pin governance/welcomer keys
 * OUT of band (verified channel) rather than trusting link-carried keys.
 */
export declare function parseJoinLink(link: string): JoinLinkParts;
/**
 * joinInputFromJson — machine-to-machine handoff shape (same host or file
 * transfer): either `{ "link": "https://…#…" }`, a raw fragment string, or
 * a field map using the same labels as the split format. Zero long opaque
 * strings through chat layers.
 */
export declare function joinInputFromJson(value: unknown): string;
export interface JoinRoomInfo {
    roomId: string;
    /** One or more welcomer pubkeys (redundant welcomers, §5.2). */
    welcomerPub: string | string[];
    routingId: string;
    /** Room admission policy (from room metadata). 'cap-pow' triggers the
     *  two-phase challenge dance automatically. */
    policy?: 'open' | 'cap-pow';
    /** For cap-pow rooms with a pre-issued challenge (out-of-band). */
    challenge?: {
        salt: string;
        difficulty: number;
        expiry: number;
        sig: string;
        burner: string;
        roomId: string;
        keyEpoch: number;
    };
}
export interface JoinedRoom {
    roomId: string;
    epoch: number;
    encKey: Uint8Array;
    routingId: string;
    scribes: string[];
    /** Room governance pubkey — redaction lists from any other author are
     *  rejected (fail-closed, spec §3). */
    governance: string;
    /** P1: uncertified per-room throwaway author key (§2). P2: the room
     *  stream key, certified by the device persona (attestation.ts). */
    authorSecretKey: Uint8Array;
    /** Shield transport pubkey (config B) — uploads are gift-wrapped. */
    shieldPub?: string;
    /** P2 (§8): the current epoch chain key when the welcomer wrapped it
     *  (join-forward). Ratchet input for future epochs; the client can never
     *  derive PAST epochs from it (preimage resistance). */
    chainKey?: Uint8Array;
    /** P2 grace (§3.1): the previous epoch's encKey/epoch, kept across one
     *  ratchet step so in-flight envelopes from just before the roll still
     *  decrypt (acceptance window 1, envelope.ts P2_EPOCH_WINDOW). */
    previousEncKey?: Uint8Array;
    previousEpoch?: number;
    /** Retired stream keys (spec §2: clients retain retired stream keys
     * while deletion power over their own old messages matters — kind-5
     *  ownership). Never used for new posts. */
    retiredAuthorSecretKeys: Uint8Array[];
    /** The room's relay-class privacy policy (§11, §12). Decides how this
     *  session jitters ephemeral timestamps (posts + joins + shield wraps).
     *  Derived from the join link's `rc` fragment unless the caller
     *  overrode it in JoinOptions.privacy. Persisted with the session so a
     *  restored session keeps jittering the same way. */
    privacy: PrivacyPolicy;
}
export interface JoinOptions {
    clock?: Clock;
    rng?: Rng;
    pollIntervalMs?: number;
    joinTimeoutMs?: number;
    /** Relay trust class / privacy-jitter policy for THIS session (§11, §12):
     *  'public' (default) = vanilla-safe forward 600s jitter; 'private' = full
     *  backward ±48 h jitter (needs a P2-patched relay); a full PrivacyPolicy
     *  for a custom window/bias. Overrides the link's `rc` field when set. */
    privacy?: RelayClass | PrivacyPolicy;
    /** Agent identity to claim on the join request (rides INSIDE the
     *  NIP-44-encrypted request, never on the wire §7). Welcomers with an
     *  agent admission policy gate on it; the relay never sees it. */
    agentPub?: string;
    /** Agent SECRET key — when provided alongside agentPub, the join request
     *  carries a join proof (schnorr over room+burner) so the welcomer can
     *  verify the joiner actually controls the claimed agent identity. */
    agentSecretKey?: Uint8Array;
    /** NIP-OA owner attestation tag (["auth", owner, conditions, sig]) for
     *  the claimed agent identity — the external-agent admission lane. */
    agentAuth?: string[];
    /** Offer/membership admission evidence carried only inside the encrypted
     * join request. BAO Fund uses a room-bound blind credential issued after
     * verified investment/donation; copying the invite alone is insufficient. */
    proofs?: AdmissionProofs;
    /** How often the ephemeral join request is republished until a welcomer
     *  answers (spec §5.2 jittered retries). Default 2500ms. */
    republishIntervalMs?: number;
    /** Millisecond clock — injectable so tests with a manual clock don't
     *  time out against the real wall clock (post-review testability fix). */
    nowMs?: () => number;
    sleep?: (ms: number) => Promise<void>;
}
/**
 * Full §6 burner join. The burner keypair never escapes this function —
 * it is generated, used, and discarded here.
 */
export declare function joinRoom(conn: RelayConn, link: string, roomInfo: Omit<JoinRoomInfo, 'roomId'>, opts?: JoinOptions): Promise<JoinedRoom>;
/**
 * One-call join from a fat-fragment link (relay + welcomer + routing all in
 * the link): parse → connect → burner join → fresh session connection. The
 * 5-second agent path; no web host, no discovery calls.
 */
export declare function joinFromLink(link: string, opts?: JoinOptions & {
    joinTimeoutMs?: number;
    connFactory?: ConnFactory;
    relay?: string;
}): Promise<{
    conn: RelayConn;
    session: import('./session.js').RoomSession;
    joined: JoinedRoom;
}>;
