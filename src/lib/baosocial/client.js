/**
 * Client — re-export layer.
 *
 * The protocol logic has been deepened into three focused modules:
 *   - join.ts:    burner dance, join flow, join links
 *   - session.ts: RoomSession, serialization, persistence
 *   - post.ts:    shared constants for reliable post
 *
 * This module re-exports everything so existing consumers (demo, agent CLI,
 * BAO Fund, 2140) continue to work without changes.
 */
export { agentDoRecipe, createJoinLink, parseJoinLink, joinLinkChecksum, fragmentDiagnostics, splitJoinLines, parseSplitJoinLines, partsToJoinLink, normalizeJoinInput, parseShortInviteRef, resolveJoinInput, sameRelayEndpoint, joinInputFromJson, joinRoom, joinFromLink, } from './join.js';
export { serializeJoinedRoom, restoreJoinedRoom, RoomSession, } from './session.js';
export { 
// ─── Post helpers ───────────────────────────────────────────────────────
DEFAULT_FLUSH_MS, } from './post.js';
// ─── Re-export convenience helpers (originally at bottom of client.ts) ───
export { findTag, bytesToHex } from './crypto.js';
