/**
 * Provision core — browser-safe room provisioning primitives (protocol §8).
 *
 * Pure library logic with NO node:fs/node:crypto/node:path imports — safe
 * for browser bundles. Consumed by:
 *   - client.ts (DEFAULT_FLUSH_MS, re-exported)
 *   - agent CLI (buildJoinLink)
 *   - BAO Fund / bao.markets wrapper (buildRoomEntry, retention parsing)
 *
 * File I/O lives in provision-fs.ts.
 */
import { bytesToHex, hexToBytes, generateSecretKey, deriveChain, deriveRoomRoleKey, deriveScrollWrapperKey, getPublicKey, } from './crypto.js';
import { createJoinLink } from './join.js';
// ─── Key derivation (must match the daemons exactly) ─────────────────────
/** The pubkey the scribe daemon serves a room under:
 *  getPublicKey(HKDF(master, 'bao/role/scribe/' + roomId)). */
export function deriveScribePubkey(masterHex, roomId) {
    return getPublicKey(deriveRoomRoleKey(hexToBytes(masterHex), 'scribe', roomId));
}
/** The pubkey the welcomer daemon serves a room under:
 *  getPublicKey(HKDF(master, 'bao/role/welcomer/' + roomId)). */
export function deriveWelcomerPubkey(masterHex, roomId) {
    return getPublicKey(deriveRoomRoleKey(hexToBytes(masterHex), 'welcomer', roomId));
}
// ─── Retention (daemon-compatible serialization + tolerant parse) ────────
const DEFAULT_RETENTION = { type: 'time', maxAgeSec: 100 * 24 * 3600 }; // spec §7
export const DEFAULT_FLUSH_MS = 4000;
/**
 * Room-file fields owned by the DAEMONS: the welcomer writes epoch state
 * back on fresh-join ratchets (§8) and its config reload must not treat
 * those write-backs as operator intent. Consumers saving the rooms list
 * must preserve them verbatim (merge against disk). Single source of truth
 * for the welcomer reconcile, the demo server saveRooms, and any app that
 * mirrors that merge — these lists drifting apart is how epochs silently
 * roll back to mint-time.
 */
export const DAEMON_MANAGED_ROOM_FIELDS = ['epoch', 'chainKey', 'encKey', 'segKey'];
/** Serialize Retention to the rooms-file daemon string ('none' | 'count:N'
 *  | 'time:N' | 'size:N'). Writing an object would confuse daemons that
 *  already parse the string form. */
export function retentionSpec(retention) {
    if (retention.type === 'none')
        return 'none';
    if (retention.type === 'count')
        return `count:${retention.maxMessages}`;
    if (retention.type === 'time')
        return `time:${retention.maxAgeSec}`;
    return `size:${retention.maxSegments}`;
}
/** Tolerant parse: accepts the daemon string form AND the object form, so
 *  one foreign or legacy entry can never crash a consumer. Mirrors the
 *  scribe daemon's parseRetention. */
export function parseRetention(spec) {
    if (!spec || spec === 'none' || (typeof spec === 'object' && spec.type === 'none'))
        return { type: 'none' };
    if (typeof spec === 'object') {
        const s = spec;
        if (s.type === 'count')
            return { type: 'count', maxMessages: Number(s.maxMessages) };
        if (s.type === 'time')
            return { type: 'time', maxAgeSec: Number(s.maxAgeSec) };
        if (s.type === 'size')
            return { type: 'size', maxSegments: Number(s.maxSegments) };
        throw new Error(`unknown retention spec: ${JSON.stringify(spec)}`);
    }
    const [type, arg] = spec.split(':');
    if (type === 'count')
        return { type: 'count', maxMessages: Number(arg) };
    if (type === 'time')
        return { type: 'time', maxAgeSec: Number(arg) };
    if (type === 'size')
        return { type: 'size', maxSegments: Number(arg) };
    throw new Error(`unknown retention spec: ${spec}`);
}
// ─── Minting ──────────────────────────────────────────────────────────────
/** Mint a room: all keys random; roomId is random hex, NEVER name-derived
 *  (a name-derived id would put the room name in every segment d-tag on the
 *  relay). SegKey derives from the content key via deriveScrollWrapperKey —
 *  the rooms-file form daemons actually consume. */
export function buildRoomEntry(name, topic = '', opts = {}) {
    const roomId = bytesToHex(generateSecretKey()).slice(0, 16);
    const contentSeed = generateSecretKey();
    const governanceKey = generateSecretKey();
    const epoch0 = deriveChain(contentSeed, 0);
    const encKeyBytes = epoch0.encKey;
    const scribeKey = deriveScrollWrapperKey(encKeyBytes);
    const scribes = opts.scribeMaster && /^[0-9a-f]{64}$/.test(opts.scribeMaster)
        ? [deriveScribePubkey(opts.scribeMaster, roomId)]
        : [];
    return {
        roomId,
        name: name.slice(0, 40),
        topic: topic.slice(0, 120),
        routingId: bytesToHex(generateSecretKey()),
        encKey: bytesToHex(encKeyBytes),
        segKey: bytesToHex(scribeKey),
        ...(opts.epochChain !== false ? { chainKey: bytesToHex(epoch0.chainKey) } : {}),
        epoch: 0,
        inviteSecret: bytesToHex(generateSecretKey()),
        policy: opts.policy ?? 'open',
        ...(opts.agentPolicy ? { agentPolicy: opts.agentPolicy, agentAllowlist: opts.agentAllowlist ?? [] } : {}),
        retention: opts.retention ?? DEFAULT_RETENTION,
        flushDeadlineMs: opts.flushDeadlineMs ?? DEFAULT_FLUSH_MS,
        governancePubkey: getPublicKey(governanceKey),
        governanceSecretKey: bytesToHex(governanceKey),
        scribes,
        createdAt: Math.floor(Date.now() / 1000),
        ...(opts.privacy ? { privacy: opts.privacy } : {}),
    };
}
// ─── The fat join link ────────────────────────────────────────────────────
/** The one fat fragment that serves humans AND agents: self-contained
 *  relay, welcomer pubkey (when the operator master is given), routing id,
 *  invite secret — no discovery, no web host dependency. */
export function buildJoinLink(host, entry, opts = {}) {
    const welcomerPub = opts.welcomerMaster && /^[0-9a-f]{64}$/.test(opts.welcomerMaster)
        ? deriveWelcomerPubkey(opts.welcomerMaster, entry.roomId)
        : opts.welcomerPub;
    return createJoinLink(host, entry.inviteSecret, entry.roomId, {
        ...(opts.relay ? { relay: opts.relay } : {}),
        ...(welcomerPub ? { welcomerPub } : {}),
        routingId: opts.routingId ?? entry.routingId,
        ...(opts.linkId ? { linkId: opts.linkId } : {}),
        ...(opts.audience ? { audience: opts.audience } : {}),
        ...(opts.label ? { label: opts.label } : {}),
        // Config-B transport pubkey + invite-v2 display fields must ride the
        // fat fragment too — dropping them here silently downgraded shielded
        // rooms to config A and hid maxUses/expiry from holders (post-review).
        ...(opts.shield ? { shield: opts.shield } : {}),
        ...(opts.maxUses !== undefined ? { maxUses: opts.maxUses } : {}),
        ...(opts.expiresAt !== undefined ? { expiresAt: opts.expiresAt } : {}),
        // Relay-class privacy: explicit opts win, else the ROOM's provisioned
        // privacy — so a room minted 'private' produces 'private' links.
        ...((opts.relayClass ?? entry.privacy) ? { relayClass: opts.relayClass ?? entry.privacy } : {}),
    });
}
