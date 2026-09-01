import { type NostrEvent, type Clock, type Rng, type RelayClass, type PrivacyPolicy } from './crypto.js';
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
    inviteSecret: string;
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
}
export type ConnFactory = (url: string) => RelayConn;
/**
 * agentDoRecipe — the CANONICAL zero-repo bootstrap command for AI agents
 * (grammar v2 `do` payload). Any deploy host serves the bundled CLI at
 * /bao-agent.cjs, so an agent holding ONLY the link can go from nothing to
 * joined+greeted with one copy-pasteable recipe. 1B-model friendly:
 * execute exactly this; the only substitution is pasting the very URL that
 * carried the recipe into `join`.
 *
 * SELF-REFERENTIAL by design: the /agent#… URL holding this recipe IS the
 * join argument. We deliberately do NOT embed a second /chat/join# URL
 * here: two URLs in circulation means two credential sets that can drift
 * apart (rotated invite secrets, stale rooms.json entries), and agents
 * following the embedded copy hit 'missing welcomer/routing fields' with
 * no way to recover. One URL, one credential set — the one the agent
 * already has.
 */
export declare function agentDoRecipe(origin: string): string;
export declare function createJoinLink(host: string, inviteSecret: string, roomId: string, opts?: JoinLinkOptions & {
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
 * absorbLink — normalise a join link that survived a hostile transport:
 * quotes/angle-bracket wrapping, trailing punctuation, markdown escapes,
 * whitespace inside the fragment (line-wrapped pastes), merged '#…'
 * anchors. Transport repair only — never touches the credential bytes.
 * Runs inside parseJoinLink before the strict fail-closed parse.
 */
export declare function absorbLink(raw: string): string;

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
}): Promise<{
    conn: RelayConn;
    session: import('./session.js').RoomSession;
    joined: JoinedRoom;
}>;
