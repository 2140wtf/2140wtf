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
import { type RelayClass } from './crypto.js';
import type { AgentAccessPolicy } from './access.js';
import type { AdmissionMenu } from './admission.js';
import { type JoinLinkOptions } from './join.js';
export type RoomPolicy = 'open' | 'cap-pow' | 'invite';
/** Retention in object form (the form daemons consume after parsing). */
export type Retention = {
    type: 'none';
} | {
    type: 'count';
    maxMessages: number;
} | {
    type: 'time';
    maxAgeSec: number;
} | {
    type: 'size';
    maxSegments: number;
};
/** A room as minted + persisted. Daemons read roomId/routingId/encKey/
 *  segKey/epoch/retention/flushDeadlineMs/policy/inviteSecret/
 *  governancePubkey/scribes; name/topic/createdAt are app metadata the
 *  daemons ignore. governanceSecretKey is creator custody — never send it
 *  over the wire, never expose it in listings. Unknown app fields survive
 *  writeRoomsFile round-trips untouched. */
export interface ChatRoomEntry {
    roomId: string;
    name?: string;
    topic?: string;
    routingId: string;
    encKey: string;
    segKey?: string;
    /** P2 (spec §8): the CURRENT epoch chain key (hex). When present, the
     *  welcomer daemon includes it in wraps (join-forward). Optional —
     *  P1 (static-key) rooms omit it. */
    chainKey?: string;
    epoch: number;
    inviteSecret: string;
    policy: RoomPolicy;
    /** Agent admission lane (§7): which agent identities may join via
     *  aud:'agent' links. 'none' excludes agents, 'all' accepts any agent,
     *  'selected' accepts only agentAllowlist / founder-attested pubkeys. */
    agentPolicy?: AgentAccessPolicy;
    agentAllowlist?: string[];
    /** Human-owner pubkeys whose NIP-OA attestations may admit agents. */
    agentOaOwners?: string[];
    /** Optional composable admission gate evaluated inside the welcomer. */
    admissionMenu?: AdmissionMenu;
    retention: Retention;
    flushDeadlineMs: number;
    governancePubkey: string;
    governanceSecretKey: string;
    scribes: string[];
    createdAt: number;
    /** Relay trust class driving the room's privacy-jitter posture (§11, §12):
     *  'public' (default) = forward jitter within vanilla strfry bounds; absent
     *  or 'public' keeps the universal posture, 'private' = full backward ±48 h
     *  jitter (requires a P2-patched dedicated relay). Daemons and join-link
     *  builders read this to stamp the link's `rc` fragment.
     *
     *  EXTRA privacy feature only — never a requirement for a room to be
     *  private; rooms are private from their cryptography alone. */
    privacy?: RelayClass;
}
export interface BuildRoomEntryOptions {
    policy?: RoomPolicy;
    /** Agent admission lane (§7): 'none' | 'selected' | 'all'. */
    agentPolicy?: AgentAccessPolicy;
    /** Room-provisioned agent allowlist — honored when agentPolicy is
     *  'selected' (plus founder attestations). */
    agentAllowlist?: string[];
    /** Optional human-owner roots for advanced NIP-OA agent admission. */
    agentOaOwners?: string[];
    /** Optional composable admission gate, including private-offer credentials. */
    admissionMenu?: AdmissionMenu;
    retention?: Retention;
    /** hex 32B operator master — when set, the entry's scribes list names the
     *  exact pubkeys the scribe daemon derives (HKDF(master,'scribe',roomId)). */
    scribeMaster?: string;
    flushDeadlineMs?: number;
    /** P2 (§8): mint the room with an epoch chain — the entry carries the
     *  current chain key so the welcomer wraps join-forward. Default true;
     *  set false for a legacy static-key room. */
    epochChain?: boolean;
    /** Relay trust class for the room (§11, §12): 'private' = full backward
     *  ±48 h jitter (P2-patched relay only); absent → 'public' posture. */
    /** Relay trust class for the room (§11, §12): 'private' = full backward
     *  ±48 h jitter (P2-patched relay only); absent → 'public' posture.
     *
     *  This is an EXTRA privacy feature — never a requirement for a room to be
     *  private; rooms are private from their cryptography alone. */
    privacy?: RelayClass;
}
export interface JoinLinkBuildOptions extends JoinLinkOptions {
    /** hex 32B operator master — derive welcomerPub EXACTLY as the welcomer
     *  daemon does (HKDF(master,'welcomer',roomId)) and embed it in the
     *  fat fragment so joiners need no discovery. */
    welcomerMaster?: string;
}
/** The pubkey the scribe daemon serves a room under:
 *  getPublicKey(HKDF(master, 'bao/role/scribe/' + roomId)). */
export declare function deriveScribePubkey(masterHex: string, roomId: string): string;
/** The pubkey the welcomer daemon serves a room under:
 *  getPublicKey(HKDF(master, 'bao/role/welcomer/' + roomId)). */
export declare function deriveWelcomerPubkey(masterHex: string, roomId: string): string;
export declare const DEFAULT_FLUSH_MS = 4000;
/**
 * Room-file fields owned by the DAEMONS: the welcomer writes epoch state
 * back on fresh-join ratchets (§8) and its config reload must not treat
 * those write-backs as operator intent. Consumers saving the rooms list
 * must preserve them verbatim (merge against disk). Single source of truth
 * for the welcomer reconcile, the demo server saveRooms, and any app that
 * mirrors that merge — these lists drifting apart is how epochs silently
 * roll back to mint-time.
 */
export declare const DAEMON_MANAGED_ROOM_FIELDS: readonly ["epoch", "chainKey", "encKey", "segKey"];
/** Serialize Retention to the rooms-file daemon string ('none' | 'count:N'
 *  | 'time:N' | 'size:N'). Writing an object would confuse daemons that
 *  already parse the string form. */
export declare function retentionSpec(retention: Retention): string;
/** Tolerant parse: accepts the daemon string form AND the object form, so
 *  one foreign or legacy entry can never crash a consumer. Mirrors the
 *  scribe daemon's parseRetention. */
export declare function parseRetention(spec: Retention | string | undefined): Retention;
/** Mint a room: all keys random; roomId is random hex, NEVER name-derived
 *  (a name-derived id would put the room name in every segment d-tag on the
 *  relay). SegKey derives from the content key via deriveScrollWrapperKey —
 *  the rooms-file form daemons actually consume. */
export declare function buildRoomEntry(name: string, topic?: string, opts?: BuildRoomEntryOptions): ChatRoomEntry;
/** The one fat fragment that serves humans AND agents: self-contained
 *  relay, welcomer pubkey (when the operator master is given), routing id,
 *  invite secret — no discovery, no web host dependency. */
export declare function buildJoinLink(host: string, entry: ChatRoomEntry, opts?: JoinLinkBuildOptions): string;
