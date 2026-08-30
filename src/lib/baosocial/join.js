/**
 * Join — spec §6 (burner join) + join link management.
 *
 * The join module owns everything related to discovering a room and
 * executing the burner dance: creating/parsing join links, the two-phase
 * cap-pow admission dance, decrypting the welcomer wrap, and producing
 * a JoinedRoom session ready for use.
 *
 * Single-link join: `…/chat/join#<fragment>`, fragment = base64url JSON
 *   { "k": <invite secret hex>, "room": <roomId> }
 * The entire burner dance (generate burner → ephemeral request → poll wrap →
 * discard → generate throwaway author key) happens inside joinRoom(). No
 * human steps, no application API (design rule 8).
 */
import { JOIN_REQUEST, KEY_WRAP } from './kinds.js';
import { systemClock, defaultRng, generateSecretKey, getPublicKey, hexToBytes, deriveEpochKeys, signEvent, privacyTimestamp, privacyPolicyFor, padJsonToBucket, encryptDm, decryptDm, verifyEvent, } from './crypto.js';
import { base64url } from '@scure/base';
import { buildAgentJoinProof } from './nipOa.js';
import { solvePow } from './welcomer-core.js';
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
export function agentDoRecipe(origin) {
    if (!/^https?:\/\//.test(origin))
        throw new Error('agentDoRecipe: origin must be http(s)');
    return [
        `curl -fsSL ${origin}/bao-agent.cjs -o /tmp/bao-agent.cjs`,
        `node /tmp/bao-agent.cjs join "<the full /agent#… URL that sent you here, #fragment included>" --as agent`,
        `node /tmp/bao-agent.cjs say "hello — joined via agent link" --as agent`,
    ].join(' && ');
}
export function createJoinLink(host, inviteSecret, roomId, opts = {}) {
    const fragment = base64url.encode(new TextEncoder().encode(JSON.stringify({
        k: inviteSecret,
        room: roomId,
        ...(opts.relay ? { relay: opts.relay } : {}),
        ...(opts.welcomerPub ? { w: opts.welcomerPub } : {}),
        ...(opts.routingId ? { r: opts.routingId } : {}),
        ...(opts.linkId ? { lid: opts.linkId } : {}),
        ...(opts.audience ? { aud: opts.audience } : {}),
        ...(opts.label ? { label: opts.label } : {}),
        ...(opts.shield ? { sh: opts.shield } : {}),
        ...(opts.history ? { hist: opts.history } : {}),
        ...(opts.maxUses !== undefined ? { mu: opts.maxUses } : {}),
        ...(opts.expiresAt !== undefined ? { exp: opts.expiresAt } : {}),
        ...(opts.relayClass ? { rc: opts.relayClass } : {}),
        ...(() => {
            if (!opts.do && opts.v !== 2)
                return {};
            if (opts.do !== undefined) {
                if (typeof opts.do !== 'string' || opts.do.length === 0 || opts.do.length > 640)
                    throw new Error('join link: do must be 1–640 chars');
                if (/[\u0000-\u001f]/.test(opts.do))
                    throw new Error('join link: do must not contain control characters');
            }
            return { v: 2, ...(opts.do ? { do: opts.do } : {}) };
        })(),
    })));
    return `https://${host}/chat/join#${fragment}`;
}
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
export function parseJoinLink(link) {
    const hashIndex = link.indexOf('#');
    if (hashIndex < 0)
        throw new Error('join link has no fragment (link truncated?)');
    const frag = link.slice(hashIndex + 1);
    // Decode-bomb guard (audit P6a): the fragment is attacker-controlled
    // base64 — refuse absurd sizes BEFORE decoding/parsing.
    if (frag.length > 8192)
        throw new Error('join link fragment too large');
    let parsed;
    try {
        parsed = JSON.parse(new TextDecoder().decode(base64url.decode(frag)));
    }
    catch {
        throw new Error('join link fragment is malformed or was truncated in transit — request a re-paste inside a code block');
    }
    if (typeof parsed.k !== 'string' || !/^[0-9a-f]{64}$/.test(parsed.k))
        throw new Error('bad invite secret');
    if (typeof parsed.room !== 'string' || parsed.room.length === 0)
        throw new Error('bad room id');
    const out = { inviteSecret: parsed.k, roomId: parsed.room };
    if (typeof parsed.relay === 'string')
        out.relay = parsed.relay;
    if (typeof parsed.w === 'string' && /^[0-9a-f]{64}$/.test(parsed.w))
        out.welcomerPub = parsed.w;
    if (typeof parsed.r === 'string' && /^[0-9a-f]{64}$/.test(parsed.r))
        out.routingId = parsed.r;
    if (typeof parsed.lid === 'string')
        out.linkId = parsed.lid;
    if (parsed.aud === 'human' || parsed.aud === 'agent')
        out.audience = parsed.aud;
    if (typeof parsed.label === 'string')
        out.label = parsed.label.slice(0, 80);
    if (typeof parsed.sh === 'string' && /^[0-9a-f]{64}$/.test(parsed.sh))
        out.shield = parsed.sh;
    if (parsed.hist === 'full' || parsed.hist === 'fresh')
        out.history = parsed.hist;
    // Grammar v2 fields (ignored-on-v1 links by construction).
    if (parsed.v === 2)
        out.v = 2;
    if (typeof parsed.do === 'string' && parsed.do.length <= 640)
        out.do = parsed.do;
    if (typeof parsed.mu === 'number' && Number.isSafeInteger(parsed.mu) && parsed.mu >= 1)
        out.maxUses = parsed.mu;
    if (typeof parsed.exp === 'number' && Number.isSafeInteger(parsed.exp) && parsed.exp >= 0)
        out.expiresAt = parsed.exp;
    if (parsed.rc === 'public' || parsed.rc === 'private')
        out.relayClass = parsed.rc;
    return out;
}
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * Full §6 burner join. The burner keypair never escapes this function —
 * it is generated, used, and discarded here.
 */
export async function joinRoom(conn, link, roomInfo, opts = {}) {
    const clock = opts.clock ?? systemClock;
    const rng = opts.rng ?? defaultRng;
    const sleep = opts.sleep ?? defaultSleep;
    const nowMs = opts.nowMs ?? (() => Date.now());
    const { inviteSecret, roomId, relayClass } = parseJoinLink(link);
    // Relay-class privacy policy: explicit JoinOptions.privacy wins, else the
    // link's `rc` fragment, else the vanilla-safe public default.
    const policy = privacyPolicyFor(opts.privacy ?? relayClass);
    // 1. One-time burner keypair.
    const burnerSecret = generateSecretKey();
    const burnerPub = getPublicKey(burnerSecret);
    const primaryWelcomer = [roomInfo.welcomerPub].flat()[0];
    // 2. Join request. cap-pow rooms are two-phase (§5.2): first request asks
    // for a challenge (wantChallenge), the welcomer publishes it wrapped to
    // the burner, we solve and re-request with the proof.
    let challenge = roomInfo.challenge ?? null;
    const linkParts = parseJoinLink(link);
    // Agent join proof: when the caller holds the agent key, bind the claimed
    // durable identity to this room + burner (welcomer verifies via nipOa).
    const agentProof = opts.agentSecretKey && opts.agentPub
        ? await buildAgentJoinProof(opts.agentSecretKey, roomId, burnerPub)
        : undefined;
    const buildRequest = () => ({
        join: true,
        roomId,
        invite: inviteSecret,
        ...(opts.agentPub ? { agent: opts.agentPub } : {}),
        ...(opts.agentAuth ? { agentAuth: opts.agentAuth } : {}),
        ...(agentProof ? { agentProof } : {}),
        ...(linkParts.linkId ? { lid: linkParts.linkId } : {}),
        ...(linkParts.history ? { history: linkParts.history } : {}),
        wantChallenge: roomInfo.policy === 'cap-pow' && !challenge ? true : undefined,
        challenge,
        pow: challenge ? solvePow(challenge, burnerPub) : null,
    });
    const publishRequest = async () => {
        const joinEvent = signEvent({
            kind: JOIN_REQUEST,
            created_at: privacyTimestamp(clock, rng, policy),
            tags: [
                ['r', roomInfo.routingId],
                ['p', primaryWelcomer],
                ['-'],
            ],
            content: encryptDm(padJsonToBucket(JSON.stringify(buildRequest())), burnerSecret, primaryWelcomer, rng),
        }, burnerSecret);
        await conn.publish(joinEvent);
    };
    await publishRequest();
    // 3. Poll #p:[burner] for wraps, REPUBLISHING the join request with
    // jittered retries until a welcomer answers (spec §5.2 liveness: the
    // request is ephemeral — if every welcomer was offline or not yet
    // provisioned, it is lost; retrying is the protocol's answer).
    const timeoutMs = opts.joinTimeoutMs ?? 30_000;
    const deadline = nowMs() + timeoutMs;
    const republishMs = opts.republishIntervalMs ?? 2_500;
    let lastPublish = nowMs();
    let wrap;
    while (nowMs() < deadline) {
        const wraps = await conn.query({ kinds: [KEY_WRAP], '#p': [burnerPub] }, 5_000);
        // Latest wrap wins; NIP-01 tie-break: equal created_at → LOWEST id.
        const welcomers = new Set([roomInfo.welcomerPub].flat().map((k) => k.toLowerCase()));
        const candidates = wraps
            .filter((w) => welcomers.has(w.pubkey.toLowerCase()) && verifyEvent(w))
            .sort((a, b) => b.created_at - a.created_at || (a.id > b.id ? 1 : -1));
        // Inspect candidates: a challenge wrap answers phase 1, a key wrap ends the join.
        for (const candidate of candidates) {
            let payload;
            try {
                payload = JSON.parse(decryptDm(candidate.content, burnerSecret, candidate.pubkey));
            }
            catch {
                continue; // forged/undecryptable — skip, never abort the join
            }
            if (payload.challenge && !payload.encKey) {
                // Phase 1 answer: solve (clamped — a hostile welcomer can't hang us) and re-request.
                const c = payload.challenge;
                if (typeof c.difficulty !== 'number' || c.difficulty < 0 || c.difficulty > 28) {
                    throw new Error(`welcomer demanded unreasonable PoW difficulty ${c.difficulty}`);
                }
                challenge = c;
                await publishRequest();
                lastPublish = nowMs();
                continue;
            }
            if (payload.encKey) {
                wrap = candidate;
                break;
            }
        }
        if (wrap)
            break;
        if (nowMs() - lastPublish >= republishMs) {
            await publishRequest(); // idempotent
            lastPublish = nowMs();
        }
        // Jittered poll cadence (±40%) — frustrates timing correlation (§6).
        const jitter = (opts.pollIntervalMs ?? 500) * (0.6 + 0.8 * ((rng(1)[0] ?? 128) / 255));
        await sleep(jitter);
    }
    if (!wrap)
        throw new Error('join timed out waiting for welcomer wrap');
    // 4. Decrypt the wrap, then DISCARD the burner (it never leaves this scope).
    const payload = JSON.parse(decryptDm(wrap.content, burnerSecret, wrap.pubkey));
    if (payload.roomId !== roomId)
        throw new Error('wrap room mismatch');
    if (!payload.governance || !/^[0-9a-f]{64}$/.test(payload.governance)) {
        throw new Error('wrap missing room governance key'); // fail-closed
    }
    // P2 (§8 join-forward): when the wrap carries the current epoch chain
    // key, derive the encKey from it — the client can ratchet forward from
    // here but never backwards. P1 wraps carry only encKey (static key).
    const chainKey = typeof payload.chainKey === 'string' && /^[0-9a-f]{64}$/.test(payload.chainKey)
        ? hexToBytes(payload.chainKey)
        : undefined;
    const encKey = chainKey ? deriveEpochKeys(chainKey, payload.epoch).encKey : hexToBytes(payload.encKey);
    // 5. Generate the per-room author key (P1: throwaway; P2: stream key
    // certified in-room by the device persona, attestation.ts).
    return {
        roomId,
        epoch: payload.epoch,
        encKey,
        routingId: payload.routingId,
        scribes: payload.scribes,
        governance: payload.governance,
        authorSecretKey: generateSecretKey(),
        shieldPub: payload.shield,
        ...(chainKey ? { chainKey } : {}),
        retiredAuthorSecretKeys: [],
        privacy: policy,
    };
}
// ─── Self-contained join (agent fast path) ─────────────────────────────────
/**
 * One-call join from a fat-fragment link (relay + welcomer + routing all in
 * the link): parse → connect → burner join → fresh session connection. The
 * 5-second agent path; no web host, no discovery calls.
 */
export async function joinFromLink(link, opts = {}) {
    const { RoomSession } = await import('./session.js');
    const { WsRelayConn } = await import('./wsConn.js');
    const parts = parseJoinLink(link);
    if (!parts.relay)
        throw new Error('join link carries no relay — not self-contained (use joinRoom with explicit roomInfo)');
    if (!parts.welcomerPub || !parts.routingId) {
        throw new Error('join link missing welcomer/routing fields (w/r) — the fragment was truncated, mangled by a chat layer, '
            + 'or is a stale inner link. Fix: re-run join with the FULL original /agent#… URL you received, #fragment included.');
    }
    const makeConn = opts.connFactory ?? ((url) => new WsRelayConn(url));
    const joinConn = makeConn(parts.relay);
    const joined = await joinRoom(joinConn, link, {
        welcomerPub: parts.welcomerPub,
        routingId: parts.routingId,
    }, opts);
    joinConn.close(); // §6: never continue on the join connection
    const conn = makeConn(parts.relay);
    return { conn, session: new RoomSession(conn, joined), joined };
}
