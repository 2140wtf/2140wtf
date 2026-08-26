import { getPublicKey } from './crypto.js';
/**
 * Both key domains a mention may target: the durable identity pubkey AND
 * the room's author key (roster/@handle resolution targets the latter).
 * Shared by CLI and MCP — one implementation, two surfaces, no drift.
 */
export function myMentionKeys(state, authorSecretKey) {
    // Accepts the session object OR the raw key — call sites differ (CLI/MCP
    // hold the session; tests pass raw keys). Normalizes here, one place.
    let key;
    if (typeof authorSecretKey === 'object' && 'joined' in authorSecretKey) {
        key = authorSecretKey.joined.authorSecretKey;
    }
    else {
        key = authorSecretKey;
    }
    const authorPub = typeof key === 'string' ? getPublicKey(hexToBytes(key)) : getPublicKey(key);
    return [state.pubkey.toLowerCase(), authorPub.toLowerCase()];
}
function hexToBytes(hex) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++)
        out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
}
export function roomEntryFromJoined(joined, relay, nowSec = Math.floor(Date.now() / 1000)) {
    return {
        roomId: joined.roomId,
        epoch: joined.epoch,
        encKey: bytesToHex(joined.encKey),
        routingId: joined.routingId,
        scribes: joined.scribes,
        governance: joined.governance,
        authorSecretKey: bytesToHex(joined.authorSecretKey),
        relay,
        joinedAt: nowSec,
        ...(joined.chainKey ? { chainKey: bytesToHex(joined.chainKey) } : {}),
        ...(joined.previousEncKey ? { previousEncKey: bytesToHex(joined.previousEncKey), previousEpoch: joined.previousEpoch } : {}),
    };
}
// Local hex helper — avoids importing node-coupled utils into a pure module.
function bytesToHex(bytes) {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
