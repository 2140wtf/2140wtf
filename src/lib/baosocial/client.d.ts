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
export { type RelayConn, type JoinLinkParts, type JoinLinkOptions, type ConnFactory, agentDoRecipe, createJoinLink, parseJoinLink, type JoinRoomInfo, type JoinedRoom, type JoinOptions, joinRoom, joinFromLink, } from './join.js';
export { type SerializedSession, serializeJoinedRoom, restoreJoinedRoom, RoomSession, } from './session.js';
export { DEFAULT_FLUSH_MS, } from './post.js';
export { findTag, bytesToHex } from './crypto.js';
