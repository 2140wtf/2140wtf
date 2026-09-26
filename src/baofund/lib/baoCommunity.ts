/**
 * baoCommunity - ₿AO Fund's thin wrapper over @bao/community (rule 8).
 *
 * The protocol is neutral and lives in the community repo; this file owns
 * ONLY fund-specific glue:
 *   - room list persistence (localStorage)
 *   - the fund's payload convention ({ text })
 *   - API provisioning (POST /v1/chat/provision - the operator mints into
 *     the daemons' rooms file; the fund never touches chat correctness)
 *   - campaign link resolution (card → API → provision fallback)
 *
 * Legacy chatService (kind-1/13 + passphrase-derived keys) is retired: this
 * wrapper is the ONLY chat path.
 */
import {
  joinFromLink,
  type JoinedRoom,
  type RelayConn,
  type RoomSession,
} from '@/baofund/community/client.js';
import { validateRoomInvite } from './roomInvite';
import { WebRelayConn } from '@/baofund/community/websocket.js';
import { roomLinkPrivacy } from '@/baofund/community/agents.js';
import type { AdmissionProofs } from '@/baofund/community/admission.js';
import { fundFetch, type FundHttpSigner } from './fundHttp';

// ─── Room list persistence (localStorage) ─────────────────────────────────

export interface FundRoomMeta {
  /** The fat join link - the room's only durable handle. */
  link: string;
  roomId: string;
  name: string;
  joinedAt: number; // unix seconds
  shielded: boolean;
  audience?: 'human' | 'agent';
  /** Separate agent-lane link (owner spec 2026-09-14): present for
   *  humans+agents rooms; humans-only rooms have none by design. */
  agentLink?: string;
  inviteId?: string;
  maxUses?: number;
  expiresAt?: number;
  /** Opt-in to the live-only storage check (probe + advisory). No default
   *  room opts in: the landing room is a normal retained room (its scroll is
   *  rolled by the scribe), so a "live-only" claim would be false and the
   *  operator-only advisory must never reach the public surface. Rooms that
   *  genuinely advertise live-only can set this again. */
  storageObservation?: boolean;
  /** Campaign this room belongs to (set by `importCampaign`). Lets the room
   *  surface a Fund action for its campaign without re-deriving the link. */
  fundraiserId?: string;
}

export const ROOMS_STORAGE_KEY = 'bao-fund-community-rooms';

export function loadFundRooms(storage: Pick<Storage, 'getItem'> = localStorage): FundRoomMeta[] {
  try {
    const raw = storage.getItem(ROOMS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const rooms: FundRoomMeta[] = [];
    for (const r of parsed) {
      const candidate = r as FundRoomMeta;
      if (typeof candidate?.link !== 'string' || typeof candidate?.roomId !== 'string') continue;
      // Drop the retired hosted-2140 Trollbox: the BAO chat must use the Fund
      // relay's rooms (relay.bao.fund) only. A room on another relay cannot
      // share the fund scroll and rendered empty.
      if (/2140\.social/i.test(candidate.link)) continue;
      // Re-derive the identity from the LINK - the link is the room's only
      // durable handle; a tampered/stale stored roomId must not win over it
      // (it would desync identity, privacy display, and reaction targets).
      try {
        const truth = roomLinkPrivacy(candidate.link);
        if (truth.roomId !== candidate.roomId) continue; // poisoned entry: drop
        rooms.push({
          ...candidate,
          roomId: truth.roomId,
          shielded: truth.shielded,
          // Legacy entries persisted before the live-only claim was dropped:
          // never re-arm the probe/advisory from stale storage.
          storageObservation: undefined,
        });
      } catch {
        continue; // malformed link: drop the entry rather than crash the panel
      }
    }
    return rooms;
  } catch {
    return [];
  }
}

export function saveFundRooms(rooms: FundRoomMeta[], storage: Pick<Storage, 'setItem'> = localStorage): void {
  storage.setItem(ROOMS_STORAGE_KEY, JSON.stringify(rooms));
}

/** Add (or replace) a room by roomId. Link wins: a re-join with a fresh
 *  link replaces the stale entry. */
export function addFundRoom(room: FundRoomMeta, storage?: Pick<Storage, 'getItem' | 'setItem'>): FundRoomMeta[] {
  const rooms = loadFundRooms(storage ?? localStorage).filter((r) => r.roomId !== room.roomId);
  rooms.push(room);
  if (storage) saveFundRooms(rooms, storage as Pick<Storage, 'setItem'>);
  else saveFundRooms(rooms);
  return rooms;
}

export function removeFundRoom(roomId: string, storage?: Pick<Storage, 'getItem' | 'setItem'>): FundRoomMeta[] {
  const rooms = loadFundRooms(storage ?? localStorage).filter((r) => r.roomId !== roomId);
  if (storage) saveFundRooms(rooms, storage as Pick<Storage, 'setItem'>);
  else saveFundRooms(rooms);
  return rooms;
}

/** Parse a link into room metadata without touching the network. Throws on
 *  a malformed link (callers surface the error to the UI). */
export function roomMetaFromLink(link: string, name?: string): FundRoomMeta {
  const privacy = roomLinkPrivacy(link);
  const meta: FundRoomMeta = {
    link,
    roomId: privacy.roomId,
    name: name ?? privacy.label ?? `Room ${privacy.roomId.slice(0, 8)}`,
    joinedAt: Math.floor(Date.now() / 1000),
    shielded: privacy.shielded,
    ...(privacy.audience ? { audience: privacy.audience } : {}),
    ...(privacy.inviteId ? { inviteId: privacy.inviteId } : {}),
    ...(privacy.maxUses !== undefined ? { maxUses: privacy.maxUses } : {}),
    ...(privacy.expiresAt !== undefined ? { expiresAt: privacy.expiresAt } : {}),
  };
  // Rooms are normal retained rooms: no storage check, no operator advisory
  // on the public chat surface.
  return meta;
}

// ─── Join (agent fast path - the link is self-contained) ─────────────────

export interface JoinedFundRoom {
  conn: RelayConn;
  session: RoomSession;
  joined: JoinedRoom;
}

/** Join a room from its fat link: parse → connect → burner join → fresh
 *  session connection (spec §6). Browser transport: WebRelayConn (native
 *  WebSocket). The relay never sees a durable key. `memberSecretKey` (F7
 *  welcomer half) carries the durable member-claim INSIDE the encrypted
 *  join request for rooms with a memberPolicy. `proofs` (P3 admission menu)
 *  carries the donor credential (or other menu proof) inside the same
 *  encrypted request - a donor-gated campaign room cannot be entered with
 *  the link alone. */
export async function joinFundRoom(link: string, opts: { joinTimeoutMs?: number; memberSecretKey?: Uint8Array; proofs?: AdmissionProofs } = {}): Promise<JoinedFundRoom> {
  validateRoomInvite(link);
  const connections = new Set<WebRelayConn>();
  try {
    return await joinFromLink(link, {
      joinTimeoutMs: opts.joinTimeoutMs ?? 15_000,
      ...(opts.memberSecretKey ? { memberSecretKey: opts.memberSecretKey } : {}),
      ...(opts.proofs ? { proofs: opts.proofs } : {}),
      connFactory: url => { const conn = new WebRelayConn(url); connections.add(conn); return conn; },
    });
  } catch {
    for (const conn of connections) conn.close();
    throw new Error('Room admission failed');
  }
}

// ─── Payload convention ───────────────────────────────────────────────────
// Envelopes carry app-defined JSON; the fund's convention is { text }.

export function encodeTextPayload(text: string): { text: string } {
  return { text };
}

export function decodeTextPayload(payload: unknown): string | null {
  if (payload && typeof payload === 'object' && typeof (payload as { text?: unknown }).text === 'string') {
    return (payload as { text: string }).text;
  }
  return null;
}

// ─── API provisioning (rule 8: the API mints; the fund only calls it) ────

export interface ProvisionOptions {
  name: string;
  topic?: string;
  policy?: 'open' | 'cap-pow' | 'invite';
  audience?: 'human' | 'agent';
  /** Owner spec 2026-09-14: 'humans' (no agent link) | 'agents' | 'both'
   *  (human link + SEPARATE agent link). */
  audienceMode?: 'humans' | 'agents' | 'both';
  label?: string;
}

export interface ProvisionResult {
  link: string;
  /** Separate agent-lane link - absent for humans-only rooms. */
  agentLink?: string;
  roomId: string;
  name: string;
  governancePubkey: string;
  relay: string;
}

/** Mint a room via the operator's provisioning route. Requires an authed
 *  signer with the 'trade' scope; the API writes the daemons' rooms file. */
export async function provisionFundRoom(signer: FundHttpSigner, opts: ProvisionOptions): Promise<ProvisionResult> {
  const json = await fundFetch<{ data?: ProvisionResult }>('/v1/chat/provision', {
    method: 'POST',
    body: {
      name: opts.name,
      ...(opts.topic ? { topic: opts.topic } : {}),
      ...(opts.policy ? { policy: opts.policy } : {}),
      ...(opts.audience ? { audience: opts.audience } : {}),
      ...(opts.audienceMode ? { audienceMode: opts.audienceMode } : {}),
      ...(opts.label ? { label: opts.label } : {}),
    },
    signer,
  });
  if (!json.data) throw new Error(`provision failed (HTTP 200, no data)`);
  return json.data;
}

/** Resolve a campaign's chat link: prefer the card's link if present, else
 *  ask the API for the fundraiser detail. Returns null when the campaign
 *  has no room (caller may provision one, subject to API auth). */
export async function fetchCampaignChatLink(fundraiserId: string): Promise<string | null> {
  try {
    const json = await fundFetch<{ data?: { fundraiser?: { chat_room_link?: string } } }>(
      `/v1/fundraisers/${encodeURIComponent(fundraiserId)}`,
    );
    const link = json.data?.fundraiser?.chat_room_link;
    return typeof link === 'string' && link.length > 0 ? link : null;
  } catch {
    return null;
  }
}

/**
 * Donor-gated room access (P3 admission menu). The API withholds the room
 * link from non-contributors; a contributor identity (authenticated pubkey,
 * stable across sessions) receives the link plus the credential issuer key
 * needed to blind-request a one-use entry credential. Returns null on any
 * failure; callers surface `reason` when present.
 */
export interface CampaignRoomStatus {
  gate: 'open' | 'invite' | 'follows' | 'donors';
  available: boolean;
  link?: string | null;
  roomId?: string | null;
  issuerPub?: { n: string; e: string } | null;
  reason?: string;
}

export async function fetchCampaignRoomStatus(
  fundraiserId: string,
  signer: FundHttpSigner,
): Promise<CampaignRoomStatus | null> {
  try {
    const json = await fundFetch<{ data?: CampaignRoomStatus }>(
      `/v1/fundraisers/${encodeURIComponent(fundraiserId)}/room`,
      { signer },
    );
    return json.data ?? null;
  } catch {
    return null;
  }
}

/** Blind-sign one room credential for a verified contributor. The client
 *  never sends the credential itself - only the blinded message. */
export async function requestRoomCredential(
  fundraiserId: string,
  signer: FundHttpSigner,
  blinded: string,
): Promise<{ blindSignature: string; issuerPub: { n: string; e: string }; roomId: string | null; expiresAt?: number } | null> {
  try {
    const json = await fundFetch<{ data?: { blindSignature: string; issuerPub: { n: string; e: string }; roomId: string | null; expiresAt?: number } }>(
      `/v1/fundraisers/${encodeURIComponent(fundraiserId)}/room/credential`,
      { method: 'POST', body: { blinded }, signer },
    );
    return json.data ?? null;
  } catch {
    return null;
  }
}

// ─── Default public rooms (Trollbox + Public Chat) ─────────────────────

export interface PublicRoom {
  roomId: string;
  name: string;
  link: string;
}

/** The API's default public doors (owner spec 2026-09-14; landing name
 *  Troll₿ox since 2026-09-24 - the Bitcoin B, after the short-lived Trollbox
 *  and the intermediate BAO). Landing room first, then Public Chat.
 *  Authenticated call; returns [] on any failure so the UI degrades to no
 *  defaults, never an error modal. */
export async function fetchPublicRooms(signer: FundHttpSigner): Promise<PublicRoom[]> {
  try {
    const json = await fundFetch<{ data?: { rooms?: PublicRoom[] } }>('/v1/chat/public-rooms', { signer });
    const rooms = json.data?.rooms;
    return Array.isArray(rooms) ? rooms.filter(r => typeof r.link === 'string' && typeof r.name === 'string') : [];
  } catch {
    return [];
  }
}

/** The default rooms by name, with the landing room first. Matching is
 *  exact-name; unknown names from the API are passed through unchanged.
 *  The API renames a registry that still carries a legacy landing name
 *  ('BAO', 'Trollbox') IN PLACE at boot, keeping the roomId and its history,
 *  and every client constant must match the API's names exactly. */
export const DEFAULT_LANDING_ROOM = 'Troll₿ox';
export const DEFAULT_ROOM_NAMES = ['Troll₿ox', 'Public Chat'] as const;

/** The two public doors every authenticated user may enter - campaign rooms
 *  stay donor-gated, these never do. Consumed by the campaign-chat gate. */
export const PUBLIC_ROOM_NAMES = DEFAULT_ROOM_NAMES;
