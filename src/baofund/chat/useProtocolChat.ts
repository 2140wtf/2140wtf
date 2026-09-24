/**
 * useProtocolChat - the fund's chat hook over @bao/community (rule 8).
 *
 * Rooms are fat join links persisted locally; only the SELECTED room holds
 * a live protocol session (join on select - one relay connection at a
 * time). Receipts poll merged scrolls with bounded, cancellable retries.
 *
 * Chat features adopted from @bao/community v0.2.0:
 *   - reliable post with receipt status (pending → confirmed/timeout)
 *   - typing indicators (ephemeral, never enter the scroll)
 *   - reactions (encrypted in-envelope, toggle semantics)
 *   - retract (author-side tombstones, B4)
 *   - mentions (subscribeMentions - works in public AND shielded rooms)
 *   - roster (self-declared presence, key-derived handles)
 *   - thread index + reaction tallies via readViews()
 */
import React from 'react';
import { postWithReceipt } from './postWithReceipt';
import type { RoomSession, RelayConn } from '@/baofund/community/client.js';
import type { Envelope } from '@/baofund/community/envelope.js';
import type { TypingEvent } from '@/baofund/community/typing.js';
import type { Mention } from '@/baofund/community/mention.js';
import { aggregateScroll, type ScrollViews } from '@/baofund/community/aggregate.js';
import type { MergedMessage } from '@/baofund/community/merge.js';
import type { RosterEntry } from '@/baofund/community/presence.js';
import { getPublicKey } from '@/baofund/community/crypto.js';
import type { NostrEvent } from '@/baofund/community/crypto.js';
import { TypingSignal } from '@/baofund/community/typing.js';
import {
  type FundRoomMeta,
  loadFundRooms,
  saveFundRooms,
  addFundRoom,
  removeFundRoom,
  roomMetaFromLink,
  joinFundRoom,
  encodeTextPayload,
  decodeTextPayload,
  fetchCampaignRoomStatus,
  requestRoomCredential,
  provisionFundRoom,
  fetchPublicRooms,
  DEFAULT_LANDING_ROOM,
} from '../lib/baoCommunity';
import { fetchFundraiser, type SignerLike } from '../lib/baoFundraising';
import { createCredentialRequest, finalizeCredential } from '@/baofund/community/credential.js';
import type { AdmissionProofs } from '@/baofund/community/admission.js';
import { errorMessage } from '../lib/errors';

/** Room minting is operator-provisioned by default: operators run
 *  `npm run provision-room` (no API dependency). Set
 *  VITE_BAO_CHAT_CREATE_ENABLED=1 to re-enable in-app creation through the
 *  API's /v1/chat/provision route. */
const CREATE_ROOM_ENABLED =
  (import.meta.env as Record<string, string | undefined>).VITE_BAO_CHAT_CREATE_ENABLED === '1';
import { foldViewsToChatItems, chatIdentityKey, isBotControlPayload, botIdentitiesOf, MAX_MESSAGE_CHARS, MAX_RENDERED_MESSAGES, type ChatItem } from './chatFold';
import { buildRetract } from '@/baofund/community/retract.js';
import {
  buildRoomCapabilities,
  applyProbeToCapabilities,
  type RoomCapabilities,
} from '../lib/roomCapabilities';
import {
  foldRoleEditions,
  roleEditionFilter,
  hasPerm,
  buildRoleEditionEvent,
  type FoldedRoles,
  type EditionSpec,
  type Perm,
} from './roleEditions';
import {
  // vsk:4 banlist (deny-only companion fold; same kind, same relay query).
  foldBanEditions,
  buildBanEditionEvent,
  buildBanLiftEvent,
  isBanned,
  banFrom,
  type FoldedBanlist,
} from './banEditions';
import { buildMemberClaim, verifyMemberClaim, type MemberIdentity } from './memberIdentity';
import { probeRelayStorage } from '../lib/relayStorageProbe';
import { nip98Header } from '../lib/fundHttp';
import { fetchIsChatAdmin } from './useIsChatAdmin';
import { validateRoomInvite } from '../lib/roomInvite';

export type { ChatItem };

export interface TypingState {
  /** Author keys currently typing (most recent first). */
  authors: string[];
}

export interface UseProtocolChatReturn {
  rooms: FundRoomMeta[];
  messages: ChatItem[];
  typing: TypingState;
  roster: Map<string, RosterEntry>;
  mentions: Mention[];
  selectedRoomId: string | null;
  /** Open a room. `force` closes and re-joins the live session (identity
   *  changes must re-derive the per-room member key). */
  selectRoom(roomId: string, opts?: { force?: boolean }): Promise<void>;
  /** Close every live session and clear room-scoped state (sign-out). */
  resetSessions(): void;
  sendMessage(text: string): Promise<void>;
  /** Post a text message to a SPECIFIC joined room, bypassing selection.
   *  Closure-safe for async flows (a release finalizing while the user has
   *  navigated to another room): resolves the live session from liveRef at
   *  call time. Best-effort: returns false instead of throwing when the
   *  room is not joined, the payload is empty, or the post fails. */
  postToRoom(roomId: string, text: string): Promise<boolean>;
  /** Fire a typing signal (debounced inside the library's TypingSignal). */
  notifyTyping(): void;
  /** Notifications: per-room @mention counts, cleared on room open.
   *  Message unread counts are deliberately not produced (WS3 option C -
   *  single live session; see the state comment). */
  mentionUnread: Map<string, number>;
  /** Toggle this author's reaction on a message. */
  toggleReaction(msgId: string, emoji: string): Promise<void>;
  /** Retract one of this author's own messages. */
  retractMessage(msgId: string): Promise<void>;
  /** Reply to a message (thread root). */
  replyToMessage(replyTo: string, text: string): Promise<void>;
  /** This session's author pubkey (throwaway per-room key) - lets the UI
   *  only offer retract for the user's OWN messages. */
  selfAuthor: string | null;
  isSending: boolean;
  error: string | null;
  importLink(link: string, name?: string): Promise<void>;
  /** Resolve + join a campaign's room. Returns the persisted room metadata
   *  so callers can select it by its real (link-derived) roomId; null when
   *  the room could not be imported (error is set for the panel). */
  importCampaign(fundraiserId: string, title: string, signer: SignerLike): Promise<FundRoomMeta | null>;
  createRoom(name: string, opts: { policy?: 'open' | 'cap-pow' | 'invite'; audience?: 'human' | 'agent'; audienceMode?: 'humans' | 'agents' | 'both'; label?: string }, signer: SignerLike): Promise<void>;
  removeRoom(roomId: string): void;
  /** Ensure the default public rooms (Trollbox + Public Chat) exist and
   *  optionally land in Trollbox (skipLanding=true after an invite join).
   *  `onlyRoomName` restricts the import to one room (signed-out guests get
   *  the public landing room only - never Public Chat or stored rooms). */
  ensureDefaultRooms(signer: SignerLike, skipLanding: boolean, opts?: { onlyRoomName?: string }): Promise<void>;
  /** Cross-app parity: pull the caller's market rooms (bao.markets API) into
   *  the local room list so the same identity sees them on every BAO app. */
  syncExternalRooms(signer: SignerLike): Promise<void>;
  /** Row E: measured storage capability document per room (probe-folded,
   *  versioned; `unknown` until a probe completes - fail closed). */
  capabilities: Map<string, RoomCapabilities>;
  /** True while a join-time storage probe is running. */
  capabilityProbeInFlight: boolean;
  /** Owner spec: author keys that announced as bots (botHello/botManifest
   *  payloads) - render a flat 🤖 chip; their control payloads are hidden
   *  from the timeline. */
  botAuthors: Set<string>;
  /** Roles spec §1/§5: folded kind-3308 vsk:1 role state per room. Rooms
   *  with no role editions fold to status 'none'; shielded/ephemeral rooms
   *  are 'ignored-ephemeral' (tier honesty, §4). */
  roles: Map<string, FoldedRoles>;
  /** vsk:4 banlist: folded deny-only removal state per room. */
  bans: Map<string, FoldedBanlist>;
  /** Durable member claims per room: transport burner → member pubkey,
   *  folded from verified in-room claims (key control only; no human
   *  attestation, ever). Used for recognition and identity-addressed bans. */
  memberClaims: Map<string, Map<string, string>>;
  /** Remove an author by their DURABLE member key when a verified claim
   *  links them, so the ban survives burner rotation. */
  memberKeyFor(roomId: string, author: string): string | null;
  /** UI gate for kick/ban affordances: true when THIS session's key may
   *  publish a ban for `pubkey` (founder or current `ban` perm holder, room
   *  not role-frozen/unknown-catalog). Deny-only - the hook re-checks on
   *  the actual call. */
  mayBan: (roomId: string, pubkey: string) => boolean;
  /** UI gate for kick (timeout) affordances: founder or `kick` perm holder. */
  mayKick: (roomId: string, pubkey: string) => boolean;
  /** Room settings (owner spec): role management gated on founder/pin-role. */
  mayManageRoles: (roomId: string) => boolean;
  /** Grant `roleId` (default moderator) to `pubkey` - full restatement. */
  grantRole: (pubkey: string, roleId?: string) => Promise<void>;
  /** Remove `pubkey` from `roleId` (omission = deletion, spec §2). */
  revokeRole: (pubkey: string, roleId?: string) => Promise<void>;
  /** Folded role grants per pubkey → role ids (for the settings roster). */
  roleGrants: (roomId: string) => Map<string, string[]>;
  /** The room's founder key (governance) - null when not joined. */
  roomFounder: (roomId: string) => string | null;
  /** Publish a vsk:4 ban edition for `pubkey` (deny-only removal). */
  banAuthor(pubkey: string, reason?: string): Promise<void>;
  /** Publish a vsk:4 lift edition (empty member restatement). */
  liftBan(pubkey: string): Promise<void>;
  /** KICK (Discord-style timeout): a NIP-40-expiring ban - the deny lapses
   *  after `durationSeconds` (default 1h) with no lift event needed. */
  kickAuthor(pubkey: string, durationSeconds?: number): Promise<void>;
}

interface LiveRoom {
  generation: number;
  abort: AbortController;
  conn: RelayConn;
  session: RoomSession;
  unsubscribe?: () => void;
  unsubTyping?: () => void;
  unsubMentions?: () => void;
  /** Roles spec §4: live subscription for kind-3308 control editions
   *  (vsk:1 roles AND vsk:4 banlist - one subscription, two folds). */
  unsubRoles?: () => void;
  /** This room session's secret key - the only key that can be named in a
   *  roster/banlist, hence the only one that may sign control editions. */
  authorSecretKey: Uint8Array;
  /** Per-msg_id reaction subscriptions (the library filters by exact target). */
  reactionSubs: Map<string, () => void>;
  typingSignal?: TypingSignal;
}

/** Bound on per-message reaction subscriptions per room session. */
const MAX_REACTION_SUBS = 200;

/** Thrown when the session key is on the room's vsk:4 banlist at join:
 *  admission consumes the deny list (spec §6.1) - the join is refused, not
 *  merely displayed. Carries the ban's anchor timestamp for the message. */
export class BanJoinRejected extends Error {
  constructor(roomId: string, pubkey: string, banFrom: number | null) {
    super(`banned: this session key is on room ${roomId}'s banlist${banFrom ? ` (since ${new Date(banFrom * 1000).toISOString()})` : ''} - entry published by the room's moderator/founder key`);
    this.name = 'BanJoinRejected';
  }
}

export interface UseProtocolChatOptions {
  /** Resolve THIS account's durable per-room member identity. Optional: the
   *  chat still works with ephemeral keys when absent (pure-agent clients and
   *  tests). Presence of an identity never requires any human attestation -
   *  it is a key-control claim only. */
  resolveMemberIdentity?: (roomId: string) => Promise<MemberIdentity | null>;
}

export function useProtocolChat(opts: UseProtocolChatOptions = {}): UseProtocolChatReturn {
  const resolveMemberIdentity = opts.resolveMemberIdentity;
  const [rooms, setRooms] = React.useState<FundRoomMeta[]>(() => loadFundRooms());
  const [messages, setMessages] = React.useState<ChatItem[]>([]);
  const [typing, setTyping] = React.useState<TypingState>({ authors: [] });
  const [roster, setRoster] = React.useState<Map<string, RosterEntry>>(new Map());
  const [mentions, setMentions] = React.useState<Mention[]>([]);
  // Notifications (owner spec, Discord parity): per-room @mention counts,
  // cleared on room open and zeroed on sign-out.
  //
  // WS3 decision (2026-09-21, option C): message UNREAD counts are NOT
  // produced. Only the selected room keeps a live session, so a count of
  // "messages that arrived while the room was backgrounded" is unreachable
  // by construction, and per-room background subscriptions (option A) or a
  // bounded refetch per room (option B) do not scale to the 100+ joined
  // market/campaign rooms. Mentions have their own subscription and are the
  // only badge contract. Do not reintroduce `unread`.
  const [mentionUnread, setMentionUnread] = React.useState<Map<string, number>>(new Map());
  /** Author keys that announced as bots (botHello / botManifest payloads).
   *  Owner spec: agent-lane joiners show a flat 🤖 chip, and their control
   *  payloads never render as chat text. */
  const [botAuthors, setBotAuthors] = React.useState<Set<string>>(new Set());
  const [selectedRoomId, setSelectedRoomId] = React.useState<string | null>(null);
  const [isSending, setIsSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const liveRef = React.useRef<Map<string, LiveRoom>>(new Map());
  const selectionRef = React.useRef({ generation: 0, roomId: null as string | null });
  const isCurrent = React.useCallback((live: LiveRoom) => live.generation === selectionRef.current.generation, []);
  // Author pubkey of THIS session (throwaway per-room key) for reactions/retract.
  const selfAuthorRef = React.useRef<string | null>(null);
  // State mirror for reactivity: the ref is set inside async selectRoom, so
  // the UI needs a state update to re-render with the new author.
  const [selfAuthor, setSelfAuthor] = React.useState<string | null>(null);
  // Durable member identity per room (burner → member key), folded from
  // verified in-room claims. Recognition + identity-addressed bans live here;
  // no human attestation is ever required (member claims prove key control).
  const memberIdsRef = React.useRef<Map<string, Map<string, string>>>(new Map());
  const [memberClaims, setMemberClaims] = React.useState<Map<string, Map<string, string>>>(new Map());
  const mergeMemberClaim = React.useCallback((claim: { roomId: string; burnerPub: string; memberPub: string }) => {
    const room = memberIdsRef.current.get(claim.roomId) ?? new Map<string, string>();
    if (room.get(claim.burnerPub) === claim.memberPub) return;
    room.set(claim.burnerPub, claim.memberPub);
    memberIdsRef.current.set(claim.roomId, room);
    setMemberClaims(new Map(memberIdsRef.current).set(claim.roomId, new Map(room)));
  }, []);
  // Row E: measured storage capability per room (probe → versioned doc).
  // Populated at join time; UI renders the honest advisory, never a
  // "nothing is stored" promise.
  const [capabilities, setCapabilities] = React.useState<Map<string, RoomCapabilities>>(new Map());
  const [capabilityProbeInFlight, setCapabilityProbeInFlight] = React.useState(false);
  // Probe generation per room. Only the LATEST probe for a room may fold its
  // verdict: a superseded probe (re-activation/re-join while one is in
  // flight) resolving later must never overwrite a newer result, and it must
  // not clear the shared in-flight flag while a newer probe still runs.
  // resetSessions() clears the map, which invalidates every in-flight probe
  // across an identity change (probes are account-scoped state).
  const probeGenerationRef = React.useRef<Map<string, number>>(new Map());
  // Rooms whose CURRENT probe is still in flight. The public flag is shared,
  // so completions/removals recompute it from this live set instead of
  // assuming the finishing probe is the only one (round-6: a probe for a
  // removed room must neither fold its verdict nor strand the flag).
  const probeInFlightRef = React.useRef<Set<string>>(new Set());
  // Current joined epoch per room. The storage probe runs PRE-join, so the
  // epoch is only known once the join result lands; capability docs fold it
  // in whichever order the join and the probe complete (0 is a real epoch,
  // never coerced to null).
  const epochByRoomRef = React.useRef<Map<string, number>>(new Map());
  // Folded reaction tallies per room (target → emoji → authors). The library's
  // `react()` is ADD-only; `unreact()` removes - toggle semantics need the
  // current tallies, which the ScrollViews carry and ChatItem counts drop.
  const reactionsByRoomRef = React.useRef<Map<string, ScrollViews['reactions']>>(new Map());
  // Roles spec: folded role state per room + raw edition cache for re-folds.
  // The same raw kind-3308 cache feeds the vsk:4 banlist fold (one relay
  // query/subscription, two folds split by sub-kind).
  const [roles, setRoles] = React.useState<Map<string, FoldedRoles>>(new Map());
  const [bans, setBans] = React.useState<Map<string, FoldedBanlist>>(new Map());
  // Ref mirrors of the folded state for gate checks inside async publishers
  // (state closures go stale; refs read the latest fold).
  const rolesByRoomRef = React.useRef<Map<string, FoldedRoles>>(new Map());
  const bansByRoomRef = React.useRef<Map<string, FoldedBanlist>>(new Map());
  const controlEventsRef = React.useRef<Map<string, NostrEvent[]>>(new Map());
  // Per-room control metadata captured at join (fold authority anchors) +
  // the scoped fold applier, so publishers can re-fold optimistically.
  const controlMetaRef = React.useRef<Map<string, { founder: string; epoch: number }>>(new Map());
  const applyControlRef = React.useRef<Map<string, (events: NostrEvent[]) => void>>(new Map());

  const persist = React.useCallback((next: FundRoomMeta[]) => {
    setRooms(next);
    saveFundRooms(next);
  }, []);

  const closeRoom = React.useCallback((roomId: string) => {
    const live = liveRef.current.get(roomId);
    if (!live) return;
    live.abort.abort();
    live.unsubscribe?.();
    live.unsubTyping?.();
    live.unsubMentions?.();
    live.unsubRoles?.();
    for (const unsub of live.reactionSubs.values()) unsub();
    live.reactionSubs.clear();
    live.typingSignal?.dispose();
    live.conn.close();
    liveRef.current.delete(roomId);
    // Control state is authority: a closed room must not keep folded role or
    // ban grants that a later rejoin (whose control query can fail) would
    // otherwise inherit and gate publish actions on.
    controlMetaRef.current.delete(roomId);
    applyControlRef.current.delete(roomId);
    controlEventsRef.current.delete(roomId);
    rolesByRoomRef.current.delete(roomId);
    bansByRoomRef.current.delete(roomId);
    memberIdsRef.current.delete(roomId);
    reactionsByRoomRef.current.delete(roomId);
    // A closed room has no live epoch: a re-measurement must not inherit the
    // previous session's epoch (stale probe fail-closed).
    epochByRoomRef.current.delete(roomId);
    setRoles((prev) => (prev.has(roomId) ? new Map([...prev].filter(([id]) => id !== roomId)) : prev));
    setBans((prev) => (prev.has(roomId) ? new Map([...prev].filter(([id]) => id !== roomId)) : prev));
    setMemberClaims((prev) => (prev.has(roomId) ? new Map([...prev].filter(([id]) => id !== roomId)) : prev));
  }, []);

  // Ref indirection breaks the ensureReactionSubs ↔ refreshScroll cycle
  // (the reaction callback needs the latest refreshScroll, which itself
  // calls ensureReactionSubs).
  const refreshScrollRef = React.useRef<(live: LiveRoom) => Promise<void>>(async () => {});

  /** Subscribe reactions for msg_ids not yet subscribed (bounded, oldest evicted). */
  const ensureReactionSubs = React.useCallback((live: LiveRoom, ids: string[]) => {
    for (const id of ids) {
      if (!id || live.reactionSubs.has(id)) continue;
      if (live.reactionSubs.size >= MAX_REACTION_SUBS) {
        const oldest = live.reactionSubs.keys().next().value;
        if (oldest !== undefined) {
          live.reactionSubs.get(oldest)?.();
          live.reactionSubs.delete(oldest);
        }
      }
      live.reactionSubs.set(
        id,
        live.session.subscribeReactions(id, () => {
          void refreshScrollRef.current(live).catch((err) => {
            if (isCurrent(live)) setError(errorMessage(err));
          });
        }),
      );
    }
  }, [isCurrent]);

  /** Fold the library's ScrollViews into UI-facing state (chatFold.ts).
   *  Also folds bot control payloads (botHello / botManifest): authors that
   *  announced as bots go into botAuthors and those payloads are hidden
   *  from the chat timeline (owner spec: bots are visible as bots, their
   *  plumbing is not chat). */
  const applyViews = React.useCallback((views: ScrollViews, removed?: ReadonlySet<string>) => {
    const roomId = selectionRef.current.roomId;
    if (roomId) reactionsByRoomRef.current.set(roomId, views.reactions);
    setRoster(views.roster);
    const bots = new Set<string>();
    // Bot control payloads (botHello/botManifest) arrive in TWO shapes - as
    // object payloads and as JSON.stringify'd strings riding the text lane.
    // Detection is the shared, string-aware fold (chatFold.ts) so BOTH paths
    // (scroll fold + live append) hide the plumbing from the timeline.
    const isControl = (payload: unknown): boolean => isBotControlPayload(payload);
    const collectBot = (payload: unknown, author: string) => {
      const roomClaims = memberIdsRef.current.get(selectionRef.current.roomId ?? '');
      const ids = botIdentitiesOf(payload, {
        author,
        claimedMemberOf: (burner) => roomClaims?.get(burner) ?? null,
      });
      for (const id of ids) bots.add(id);
    };
    const controlIds = new Set<string>();
    const scan = (mm: MergedMessage) => {
      if (isControl(mm.envelope.payload)) {
        controlIds.add(mm.envelope.msg_id);
        collectBot(mm.envelope.payload, mm.envelope.author);
      }
      // Verified member claims (key control only) - never rendered as text.
      const claim = verifyMemberClaim(mm.envelope.payload, mm.envelope.author);
      if (claim) {
        controlIds.add(mm.envelope.msg_id);
        // The signed digest binds the claim to a room: a claim posted in
        // room A naming room B must not write room B's member map.
        if (claim.roomId === selectionRef.current.roomId) mergeMemberClaim(claim);
      }
    };
    views.timeline.forEach(scan);
    views.threadIndex.threads.forEach((t) => { scan(t.root); t.replies.forEach(scan); });
    if (bots.size > 0) {
      setBotAuthors((prev) => {
        const next = new Set(prev);
        for (const b of bots) next.add(b);
        return next.size === prev.size ? prev : next;
      });
    }
    setMessages((prev) =>
      foldViewsToChatItems(views, { previous: prev, ...(removed ? { removed } : {}) })
        .filter((m) => !controlIds.has(m.id)),
    );
  }, [mergeMemberClaim]);

  const refreshScroll = React.useCallback(
    async (live: LiveRoom) => {
      if (!isCurrent(live)) return;
      const result = await live.session.read();
      if (!isCurrent(live)) return;
      const views = aggregateScroll(result);
      // aggregateScroll drops governance-redacted messages from every view
      // without a retraction entry; hand their identities (author + msg_id,
      // never the id alone) to the fold so the stable merge actually removes
      // them without touching same-id messages by other authors.
      const removed = new Set(
        result.messages.filter((m) => m.redacted).map((m) => chatIdentityKey(m.envelope.author, m.envelope.msg_id)),
      );
      applyViews(views, removed);
      // Keep reaction subscriptions covering everything currently rendered.
      const ids = views.timeline.map((mm) => mm.envelope.msg_id);
      for (const thread of views.threadIndex.threads.values()) {
        for (const reply of thread.replies) ids.push(reply.envelope.msg_id);
      }
      for (const orphan of views.threadIndex.orphans) ids.push(orphan.envelope.msg_id);
      ensureReactionSubs(live, ids);
    },
    [applyViews, ensureReactionSubs, isCurrent],
  );
  // Keep the ref pointing at the latest refreshScroll for reaction callbacks.
  React.useEffect(() => {
    refreshScrollRef.current = refreshScroll;
  }, [refreshScroll]);

  /** Row E: measure the relay behind a room link and fold the result into
   *  that room's versioned capability document. Inconclusive/failed probes
   *  land on `unknown` (fail closed) - never a "nothing stored" claim. */
  const measureCapabilities = React.useCallback(async (meta: FundRoomMeta): Promise<RoomCapabilities> => {
    let relayUrl: string | null = null;
    try {
      const relay = validateRoomInvite(meta.link).relay;
      if (typeof relay === 'string' && relay) relayUrl = relay;
    } catch {
      // Unparseable link: capability doc records relayUrl=null (verdict
      // still lands on unknown, fail closed).
    }
    // Build the document at FOLD time: the probe starts pre-join, but the
    // joined room's epoch may land while it is in flight. Reading the epoch
    // ref here attaches the current session's epoch in either completion
    // order; absent/failed joins stay null (never a stale epoch).
    const capabilityDoc = (observedAt: number) => buildRoomCapabilities({
      shielded: meta.shielded,
      relayUrl,
      epoch: epochByRoomRef.current.get(meta.roomId) ?? null,
      observedAt,
    });
    // Supersession guard: this probe is the room's latest. A result only
    // folds (and only owns the in-flight flag) while that stays true.
    const generation = (probeGenerationRef.current.get(meta.roomId) ?? 0) + 1;
    probeGenerationRef.current.set(meta.roomId, generation);
    const isLatest = (): boolean => probeGenerationRef.current.get(meta.roomId) === generation;
    probeInFlightRef.current.add(meta.roomId);
    setCapabilityProbeInFlight(true);
    try {
      // The probe drives a DOM-style WebSocket (onopen/onmessage property
      // assignment). Browser: ALWAYS use the native global - the vite `ws`
      // alias resolves to the node-style shim class whose `.on()` API does
      // NOT fire property handlers, which silently zeroed every probe
      // ("Not measured" forever). Node (tests/probes): global WebSocket
      // exists too (undici, DOM-conformant); the shim is only for
      // @bao/community's node-style conn, never the probe.
      const wsModule = globalThis.WebSocket ? null : await import('ws').catch(() => null);
      const WebSocketCtor = (globalThis.WebSocket ?? wsModule?.default) as unknown as typeof WebSocket;
      const probe = await probeRelayStorage({ relayUrl: relayUrl ?? '', WebSocketCtor, timeoutMs: 8_000 });
      const observedAt = Math.floor(Date.now() / 1000);
      const next = applyProbeToCapabilities(capabilityDoc(observedAt), probe, observedAt);
      if (isLatest()) setCapabilities((prev) => new Map(prev).set(meta.roomId, next));
      return next;
    } catch {
      // Probe crash ⇒ unknown verdict, still recorded and rendered honestly.
      const doc = capabilityDoc(Math.floor(Date.now() / 1000));
      if (isLatest()) setCapabilities((prev) => new Map(prev).set(meta.roomId, doc));
      return doc;
    } finally {
      // Only the latest probe for the room releases its in-flight slot; a
      // superseded probe finishing early must not hide a newer probe that is
      // still running (or a concurrent probe for another room).
      if (isLatest()) {
        probeInFlightRef.current.delete(meta.roomId);
        setCapabilityProbeInFlight(probeInFlightRef.current.size > 0);
      }
    }
  }, []);

  const activateRoom = React.useCallback(async (meta: FundRoomMeta, opts?: { proofs?: AdmissionProofs; force?: boolean }) => {
    if (!opts?.force && selectionRef.current.roomId === meta.roomId && liveRef.current.has(meta.roomId)) return;
    // Identity change: drop the old session so the join re-derives the
    // per-room member key under the new login (otherwise a guest burner or a
    // signed-out member keeps posting under the previous identity).
    if (opts?.force) closeRoom(meta.roomId);
    const generation = ++selectionRef.current.generation;
    selectionRef.current.roomId = meta.roomId;
    // Invalidate callbacks before closing sockets; pending joins are disposed
    // when they resolve, without touching the newer selection.
    for (const roomId of [...liveRef.current.keys()]) closeRoom(roomId);
    setSelectedRoomId(meta.roomId);
    setMessages([]);
    setTyping({ authors: [] });
    setRoster(new Map());
    setMentions([]);
    selfAuthorRef.current = null;
    setSelfAuthor(null);
    setIsSending(false);
    setError(null);
    // Live-only storage check: ONLY rooms that opt in (today: BAO) are
    // probed. Other rooms emit no probe events and show no advisory at all.
    if (meta.storageObservation) void measureCapabilities(meta);
    // Durable pseudonymous member identity (audit F7). Key-control only -
    // no human attestation and no personhood check anywhere. Resolved BEFORE
    // the join so the admission claim can ride the encrypted join request
    // (welcomer half: rooms with memberPolicy 'all'/'selected' gate on it).
    // Best-effort: chat must never block on identity resolution.
    let memberIdentity: MemberIdentity | null = null;
    try {
      memberIdentity = resolveMemberIdentity ? await resolveMemberIdentity(meta.roomId) : null;
    } catch (err) {
      console.warn('member identity skipped:', errorMessage(err));
    }
    try {
      const { conn, session, joined } = await joinFundRoom(meta.link, {
        ...(memberIdentity ? { memberSecretKey: memberIdentity.secretKey } : {}),
        ...(opts?.proofs ? { proofs: opts.proofs } : {}),
      });
      if (generation !== selectionRef.current.generation) {
        conn.close();
        return;
      }
      const live: LiveRoom = { generation, abort: new AbortController(), conn, session, reactionSubs: new Map(), authorSecretKey: joined.authorSecretKey };
      liveRef.current.set(meta.roomId, live);
      selfAuthorRef.current = getPublicKey(joined.authorSecretKey);
      setSelfAuthor(selfAuthorRef.current);
      // A live echo proves delivery, not scribe storage. Keep it pending
      // until a scroll read confirms inclusion.
      // Live stream: envelopes arriving between joins/posts. A live text
      // envelope flips a matching optimistic pending bubble to scrolled;
      // otherwise it appends. Replies (payload.replyTo) keep their linkage.
      live.unsubscribe?.();
      live.unsubscribe = live.session.subscribeLive((env: Envelope) => {
        if (!isCurrent(live)) return;
        const liveClaim = verifyMemberClaim(env.payload, env.author);
        if (liveClaim) {
          if (liveClaim.roomId === meta.roomId) mergeMemberClaim(liveClaim);
          return; // claims are control payloads, never chat text
        }
        // Bot control payloads (object OR text-lane JSON-string shape): hide
        // from the live timeline and fold announced keys into botAuthors -
        // the same treatment the scroll fold gives them.
        if (isBotControlPayload(env.payload)) {
          const roomClaims = memberIdsRef.current.get(meta.roomId);
          const ids = botIdentitiesOf(env.payload, {
            author: env.author,
            claimedMemberOf: (burner) => roomClaims?.get(burner) ?? null,
          });
          setBotAuthors((prev) => {
            const next = new Set(prev);
            let changed = false;
            for (const id of ids) {
              if (!next.has(id)) { next.add(id); changed = true; }
            }
            return changed ? next : prev;
          });
          return;
        }
        const text = decodeTextPayload(env.payload);
        if (text === null) return;
        setMessages((prev) => {
          // Identity is (author, msg_id): a same-id envelope from another
          // author appends as its own item instead of overwriting this one.
          const existing = prev.find(
            (m) => m.id === env.msg_id && m.author.toLowerCase() === env.author.toLowerCase(),
          );
          if (existing && existing.status === 'scrolled') return prev;
          const replyTo =
            env.payload && typeof env.payload === 'object' && typeof (env.payload as { replyTo?: unknown }).replyTo === 'string'
              ? (env.payload as { replyTo: string }).replyTo
              : existing?.replyTo;
          const item: ChatItem = {
            id: env.msg_id,
            author: env.author,
            text,
            status: 'pending',
            ...(replyTo ? { replyTo } : {}),
          };
          if (existing) {
            return prev.map((m) =>
              m.id === env.msg_id && m.author.toLowerCase() === env.author.toLowerCase() ? item : m,
            );
          }
          return [...prev, item].slice(-MAX_RENDERED_MESSAGES);
        });
      });
      // Typing indicators (ephemeral; debounce etiquette inside TypingSignal).
      live.unsubTyping?.();
      live.unsubTyping = live.session.subscribeTyping((t: TypingEvent) => {
        if (!isCurrent(live)) return;
        setTyping((prev) => {
          const rest = prev.authors.filter((a) => a !== t.from);
          return t.active ? { authors: [t.from, ...rest].slice(0, 5) } : { authors: rest };
        });
      });
      // Mentions of THIS session's key (works in shielded rooms too).
      // selfAuthorRef is set by the active join above - read it fresh, never a
      // captured stale value from a previous room.
      live.unsubMentions?.();
      live.unsubMentions = live.session.subscribeMentions(selfAuthorRef.current ?? '', (m: Mention) => {
        if (!isCurrent(live)) return;
        setMentions((prev) => [m, ...prev].slice(0, 50));
        // Mentions always badge - including in the OPEN room (Discord
        // behavior: you get the red pill even while reading the channel).
        setMentionUnread((prev) => {
          const next = new Map(prev);
          next.set(meta.roomId, (next.get(meta.roomId) ?? 0) + 1);
          return next;
        });
      });
      // Roles spec §4/§5: fold role editions from history, then follow live
      // ones. Tier honesty: shielded rooms fold as 'ignored-ephemeral' (a
      // stored public role artifact contradicts the "nothing is stored"
      // tier). Failures NEVER break chat - the role surface degrades to
      // status 'none' and a console note.
      controlEventsRef.current.set(meta.roomId, []);
      controlMetaRef.current.set(meta.roomId, { founder: joined.governance, epoch: joined.epoch });
      // Row E: the capability doc's epoch is the JOINED room's current epoch.
      // The probe runs pre-join, so record it here and patch an already
      // completed document; an in-flight probe reads the ref when it folds.
      epochByRoomRef.current.set(meta.roomId, joined.epoch);
      setCapabilities((prev) => {
        const cur = prev.get(meta.roomId);
        if (!cur || cur.epoch === joined.epoch) return prev;
        return new Map(prev).set(meta.roomId, { ...cur, epoch: joined.epoch });
      });
      const applyControlFold = (events: NostrEvent[]) => {
        if (!isCurrent(live)) return;
        const foldInput = {
          roomId: meta.roomId,
          epoch: joined.epoch,
          founder: joined.governance,
          // The JOIN-AUTHENTICATED shield key (welcomer wrap) is the real
          // tier; the link's `sh` hint is advisory and checksum-exempt, so it
          // can only ever tighten (never loosen) the tier.
          ephemeral: Boolean(joined.shieldPub) || meta.shielded,
        } as const;
        const folded = foldRoleEditions(events, foldInput);
        rolesByRoomRef.current.set(meta.roomId, folded);
        setRoles((prev) => new Map(prev).set(meta.roomId, folded));
        // vsk:4 banlist folds against the role fold's CURRENT ban-perm
        // holders (deny-only authority mirror of §3's signer classes).
        // Spec §6.1: a frozen (fork) or unknown-catalog fold authorizes
        // nobody - the ambiguity is exactly "who holds `ban`", so derive no
        // holders and let no retained pre-fork key publish bans/lifts.
        const banHolders = new Set<string>();
        const kickHolders = new Set<string>();
        if (folded.status === 'ok' && !folded.frozen && !folded.unknownCatalog) {
          for (const [pk, assigned] of folded.grants) {
            if (assigned.some((r) => r.perms.includes('ban'))) banHolders.add(pk);
            if (assigned.some((r) => r.perms.includes('kick'))) kickHolders.add(pk);
          }
        }
        // Kicks are expiring ban editions: their authority is the `kick`
        // perm (mayKick gates publication on exactly that), so the fold must
        // recognize kick-only holders for expiring entries - never for
        // permanent ones (banEditions.isAuthorized).
        const foldedBans = foldBanEditions(events, {
          ...foldInput,
          banPermHolders: banHolders,
          kickPermHolders: kickHolders,
          nowSeconds: () => Math.floor(Date.now() / 1000),
        });
        bansByRoomRef.current.set(meta.roomId, foldedBans);
        setBans((prev) => new Map(prev).set(meta.roomId, foldedBans));
      };
      applyControlRef.current.set(meta.roomId, applyControlFold);
      // Publish the member claim (burner ↔ durable key), best-effort, once
      // per join/epoch. The claim proves key control only; rooms may run
      // 100% agents with no human in the loop.
      if (memberIdentity) {
        try {
          const claim = buildMemberClaim({
            roomId: meta.roomId,
            epoch: joined.epoch,
            memberSecretKey: memberIdentity.secretKey,
            burnerSecretKey: joined.authorSecretKey,
          });
          void live.session.post(claim).catch(() => { /* claim is best-effort */ });
        } catch (err) {
          console.warn('member claim publish skipped:', errorMessage(err));
        }
      }
      // The raw-conn surface is transport-dependent: absent methods skip the
      // role surface silently (same best-effort rule as the query catch).
      if (typeof live.conn.query === 'function') {
        try {
          const roleEvents = await live.conn.query(roleEditionFilter(meta.roomId), 5_000);
          if (!isCurrent(live)) return;
          controlEventsRef.current.set(meta.roomId, roleEvents);
          applyControlFold(roleEvents);
        } catch (err) {
          console.warn('role fold skipped (query failed):', errorMessage(err));
        }
      }
      if (typeof live.conn.subscribe === 'function') {
        live.unsubRoles = live.conn.subscribe(roleEditionFilter(meta.roomId), (event: NostrEvent) => {
          if (!isCurrent(live)) return;
          const events = controlEventsRef.current.get(meta.roomId) ?? [];
          if (events.some((e) => e.id === event.id)) return;
          const next = [...events, event];
          controlEventsRef.current.set(meta.roomId, next);
          try {
            applyControlFold(next);
          } catch (err) {
            console.warn('control re-fold failed:', errorMessage(err));
          }
        });
      }
      // §6.1 admission enforcement: a banlist entry for THIS session key
      // refuses the join (deny-only list, consumed at the door). Checked
      // AFTER the control fold so a founder/moderator ban is enforced on
      // the very first join that sees it; the fold itself is best-effort,
      // so a failed query degrades to the pre-banlist behavior (no false
      // evictions - the enforcement never errs toward rejecting).
      const selfPubkey = selfAuthorRef.current;
      const foldedBansNow = bansByRoomRef.current.get(meta.roomId);
      if (selfPubkey && foldedBansNow && isBanned(foldedBansNow, selfPubkey)) {
        throw new BanJoinRejected(meta.roomId, selfPubkey, banFrom(foldedBansNow, selfPubkey));
      }
      // Identity-addressed removal: the durable member key is checked too, so
      // a ban survives burner rotation (self-enforced here for honest clients;
      // the welcomer-side checker is the deployment half - see
      // docs/CHAT-MEMBER-IDENTITY.md).
      if (memberIdentity && foldedBansNow && isBanned(foldedBansNow, memberIdentity.pubkey)) {
        throw new BanJoinRejected(meta.roomId, memberIdentity.pubkey, banFrom(foldedBansNow, memberIdentity.pubkey));
      }
      // Reactions arriving live: the library filters by exact target msg_id
      // ('' matches nothing), so subscriptions are managed per rendered
      // message via ensureReactionSubs (driven by refreshScroll).
      // Read the scroll (receipts + history + views + reaction subs).
      await refreshScroll(live);
    } catch (err) {
      if (generation === selectionRef.current.generation) {
        closeRoom(meta.roomId);
        // The door never opened: live envelopes that raced the admission
        // check (they can land while the control query is awaited) must not
        // remain rendered after a rejected join.
        setMessages([]);
        setTyping({ authors: [] });
        setRoster(new Map());
        setMentions([]);
        setError(errorMessage(err));
      }
    }
  }, [refreshScroll, closeRoom, isCurrent, measureCapabilities, resolveMemberIdentity, mergeMemberClaim]);

  const selectRoom = React.useCallback(async (roomId: string, opts?: { force?: boolean }) => {
    const meta = rooms.find((room) => room.roomId === roomId);
    if (meta) await activateRoom(meta, opts);
    // Opening a room marks it read: the mention badge clears (Discord
    // "channel read" semantics).
    setMentionUnread((prev) => (prev.get(roomId) ? new Map([...prev.entries()].filter(([id]) => id !== roomId)) : prev));
  }, [rooms, activateRoom]);

  const sendMessage = React.useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    if (trimmed.length > MAX_MESSAGE_CHARS) {
      setError(`Message too long - max ${MAX_MESSAGE_CHARS} characters.`);
      return;
    }
    if (!selectedRoomId) return;
    const live = liveRef.current.get(selectedRoomId);
    if (!live) { setError('room not joined'); return; }
    setIsSending(true);
    setError(null);
    // Optimistic bubble with a client-side temp id: the message must remain
    // visible between post() and the scribes' first scroll inclusion (the
    // old code showed nothing until postReliable resolved - a perceived
    // multi-second black hole on slow relays).
    const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setMessages((prev) => [
      ...prev,
      { id: tempId, author: selfAuthorRef.current ?? '', text, status: 'pending' as const },
    ].slice(-MAX_RENDERED_MESSAGES));
    try {
      const tracked = await postWithReceipt(live.session, encodeTextPayload(trimmed), {
        signal: live.abort.signal,
        onPublished: (envelope) => {
          if (!isCurrent(live)) return;
          // An echo or concurrent history read can precede publish's OK.
          // Keep that item and remove the temporary bubble in that case.
          // The match is (author, msg_id): a same-id message by ANOTHER
          // author is not our echo and must not cancel this bubble.
          setMessages((prev) => prev.some(m => m.id === envelope.msg_id && m.author.toLowerCase() === envelope.author.toLowerCase())
            ? prev.filter(m => m.id !== tempId)
            : prev.map(m => m.id === tempId ? { ...m, id: envelope.msg_id, author: envelope.author } : m));
        },
      });
      if (!isCurrent(live)) return;
      if (tracked.state === 'timeout') {
        setError('message not confirmed by scribes yet');
      } else {
        // Render the confirming read itself: a second network read could
        // hang or disagree and discard the receipt we just verified.
        const redacted = new Set(
          tracked.scroll.messages.filter((m) => m.redacted).map((m) => chatIdentityKey(m.envelope.author, m.envelope.msg_id)),
        );
        applyViews(aggregateScroll(tracked.scroll), redacted);
        ensureReactionSubs(live, tracked.scroll.messages.map(m => m.envelope.msg_id));
      }
    } catch (err) {
      if (isCurrent(live)) setError(errorMessage(err));
    } finally {
      if (isCurrent(live)) setIsSending(false);
    }
  }, [selectedRoomId, applyViews, ensureReactionSubs, isCurrent]);

  /** Best-effort post to a specific joined room (release notes from the fund
   *  view). Deliberately QUIET: no error state, no optimistic bubble, no
   *  scroll-apply into the currently-rendered room - a background note must
   *  never mutate what the user is looking at, and must never surface as a
   *  scary error in the chat panel. Reads liveRef at CALL time, so it is
   *  safe to invoke after awaits that changed the selection. */
  const postToRoom = React.useCallback(async (roomId: string, text: string): Promise<boolean> => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return false;
    const live = liveRef.current.get(roomId);
    if (!live) return false;
    try {
      const tracked = await postWithReceipt(live.session, encodeTextPayload(trimmed), {
        signal: live.abort.signal,
        onPublished: () => { /* quiet path: no optimistic bubble to replace */ },
      });
      return tracked.state !== 'timeout';
    } catch {
      return false;
    }
  }, []);

  const notifyTyping = React.useCallback(() => {
    if (!selectedRoomId) return;
    const live = liveRef.current.get(selectedRoomId);
    if (!live) return;
    if (!live.typingSignal) {
      live.typingSignal = new TypingSignal({ post: (payload) => live.session.post(payload) });
    }
    void live.typingSignal.keystroke().catch(() => {});
  }, [selectedRoomId]);

  const toggleReaction = React.useCallback(async (msgId: string, emoji: string) => {
    if (!selectedRoomId) return;
    const live = liveRef.current.get(selectedRoomId);
    if (!live) return;
    try {
      // The library does NOT toggle: react() always ADDS this author's
      // reaction and unreact() retracts it. Decide from the folded tallies
      // (authors, not counts - a same-emoji tally may be other people's).
      const self = selfAuthorRef.current?.toLowerCase();
      const reacted = self
        ? (reactionsByRoomRef.current.get(selectedRoomId)?.get(msgId) ?? []).some(
            (t) => t.emoji === emoji && t.authors.some((a) => a.toLowerCase() === self),
          )
        : false;
      if (reacted) await live.session.unreact(msgId, emoji);
      else await live.session.react(msgId, emoji);
      await refreshScroll(live);
    } catch (err) {
      if (isCurrent(live)) setError(errorMessage(err));
    }
  }, [selectedRoomId, refreshScroll, isCurrent]);

  const retractMessage = React.useCallback(async (msgId: string) => {
    if (!selectedRoomId) return;
    const live = liveRef.current.get(selectedRoomId);
    if (!live) return;
    try {
      // A retraction is only visible after a scribe rolls it: wait for the
      // receipt (same race postWithReceipt exists for text) instead of a
      // single read that usually misses the tombstone.
      const tracked = await postWithReceipt(live.session, buildRetract(msgId), {
        signal: live.abort.signal,
        onPublished: () => undefined,
      });
      if (!isCurrent(live)) return;
      if (tracked.state === 'timeout') {
        setError('message not confirmed by scribes yet');
        return;
      }
      applyViews(aggregateScroll(tracked.scroll));
    } catch (err) {
      if (isCurrent(live)) setError(errorMessage(err));
    }
  }, [selectedRoomId, applyViews, isCurrent]);

  const replyToMessage = React.useCallback(async (replyTo: string, text: string) => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    if (trimmed.length > MAX_MESSAGE_CHARS) {
      setError(`Message too long - max ${MAX_MESSAGE_CHARS} characters.`);
      return;
    }
    if (!selectedRoomId) return;
    const live = liveRef.current.get(selectedRoomId);
    if (!live) { setError('room not joined'); return; }
    setIsSending(true);
    setError(null);
    try {
      await live.session.reply(replyTo, trimmed);
      await refreshScroll(live);
    } catch (err) {
      if (isCurrent(live)) setError(errorMessage(err));
    } finally {
      if (isCurrent(live)) setIsSending(false);
    }
  }, [selectedRoomId, refreshScroll, isCurrent]);

  const importLink = React.useCallback(async (link: string, name?: string) => {
    setError(null);
    // VALIDATE FIRST (bug-hunt 2026-09-22): the previous flow persisted the
    // room BEFORE joining, so a mistyped/garbage link left a permanent dead
    // "Room xxxxxxxx" entry in the sidebar with only a transient error.
    // Fail closed: nothing is stored unless the invite validates AND the
    // join activates. validateRoomInvite THROWS on invalid input (it never
    // returns null) - catch that and turn it into the quiet error state;
    // letting it escape would surface as an unhandled pageerror.
    let check: ReturnType<typeof validateRoomInvite>;
    try {
      check = validateRoomInvite(link);
    } catch {
      check = null as unknown as ReturnType<typeof validateRoomInvite>;
    }
    if (!check || !check.relay || !check.welcomerPub || !check.routingId) {
      setError('Invalid, incomplete or expired room invite');
      return;
    }
    try {
      const meta = roomMetaFromLink(link.trim(), name);
      await activateRoom(meta);
      persist(addFundRoom(meta));
      // Campaign links carry the machine label `fund:<frId>` so the room can
      // be grouped; a JOINER should see the campaign's name instead of the
      // raw ref (owner 2026-09-22). Best effort, after the join so naming can
      // never block entry.
      const fundLabel = /^fund:(fr_[0-9a-z]+)$/i.exec(meta.name);
      if (fundLabel) {
        void (async () => {
          try {
            const { fundraiser } = await fetchFundraiser(fundLabel[1]);
            const title = typeof fundraiser.title === 'string' ? fundraiser.title.trim() : '';
            if (!title) return;
            persist(addFundRoom({ ...meta, name: `${title} Room` }));
          } catch {
            /* keep the raw label - the room still works */
          }
        })();
      }
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [persist, activateRoom]);

  const importCampaign = React.useCallback(async (fundraiserId: string, title: string, signer: SignerLike) => {
    setError(null);
    // Donor-gated campaign rooms: the API only reveals the link to an
    // authenticated contributor identity, and entry additionally requires a
    // one-use blind credential (issued against the same contribution record,
    // so a returning investor is recognized by pubkey alone).
    const status = await fetchCampaignRoomStatus(fundraiserId, signer);
    if (!status) {
      setError('could not check this campaign room - try again');
      return null;
    }
    if (!status.available || !status.link) {
      setError(
        status.reason === 'auth_required'
          ? 'Sign in to enter the campaign room'
          : 'Only contributors to this campaign can enter its room - contribute first',
      );
      return null;
    }
    let proofs: AdmissionProofs | undefined;
    if (status.gate === 'donors' && status.roomId && status.issuerPub) {
      try {
        const expiry = Math.floor(Date.now() / 1000) + 7 * 86_400;
        const request = createCredentialRequest(status.roomId, status.issuerPub, { expiry });
        const issued = await requestRoomCredential(fundraiserId, signer, request.blinded);
        if (!issued) {
          setError('could not obtain the campaign room credential - try again');
          return null;
        }
        const { credential, signature } = finalizeCredential(issued.blindSignature, request.unblinder, request);
        proofs = { credential: { credential, signature } };
      } catch (err) {
        setError(errorMessage(err));
        return null;
      }
    }
    const meta: FundRoomMeta = { ...roomMetaFromLink(status.link, `${title} Room`), fundraiserId };
    persist(addFundRoom(meta));
    await activateRoom(meta, { proofs });
    return meta;
  }, [persist, activateRoom]);

  const createRoom = React.useCallback(async (
    name: string,
    opts: { policy?: 'open' | 'cap-pow' | 'invite'; audience?: 'human' | 'agent'; audienceMode?: 'humans' | 'agents' | 'both'; label?: string },
    signer: SignerLike,
  ) => {
    setError(null);
    // Operator-provisioned by default; ADMINS may always mint a room from the
    // UI (owner ruling 2026-09-22). The API's scopes are the authority - this
    // probe only decides between proceeding and the honest error below.
    if (!CREATE_ROOM_ENABLED && !(await fetchIsChatAdmin(signer))) {
      setError('Room creation is operator-provisioned - ask the operator for an invite link (operators: npm run provision-room).');
      return;
    }
    try {
      const result = await provisionFundRoom(signer, { name, topic: `${name} discussion`, ...opts });
      const meta = roomMetaFromLink(result.link, name);
      // Persist the SEPARATE agent link when the room has one (humans-only
      // rooms never do) - the room row is the only durable place for it.
      const full = result.agentLink ? { ...meta, agentLink: result.agentLink } : meta;
      persist(addFundRoom(full));
      await importLink(result.link, name);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [importLink, persist]);

  const removeRoom = React.useCallback((roomId: string) => {
    // Invalidate any in-flight storage probe for the removed room: a verdict
    // for a room that no longer exists must never fold. Bump (not delete)
    // the generation so a later re-import cannot collide with the stale
    // probe's number, and release its in-flight slot so the shared flag
    // cannot stay stuck true.
    probeGenerationRef.current.set(roomId, (probeGenerationRef.current.get(roomId) ?? 0) + 1);
    probeInFlightRef.current.delete(roomId);
    setCapabilityProbeInFlight(probeInFlightRef.current.size > 0);
    // Folded capability state for the removed room must not survive a
    // re-import under the same room id.
    setCapabilities((prev) => (prev.has(roomId) ? new Map([...prev].filter(([id]) => id !== roomId)) : prev));
    if (selectionRef.current.roomId === roomId) {
      ++selectionRef.current.generation;
      selectionRef.current.roomId = null;
      setSelectedRoomId(null);
      setMessages([]);
      setMentions([]);
      setTyping({ authors: [] });
      setRoster(new Map());
      selfAuthorRef.current = null;
      setSelfAuthor(null);
      setIsSending(false);
      setError(null);
    }
    closeRoom(roomId);
    // A removed room's badge must not survive to a re-import.
    setMentionUnread((prev) => (prev.has(roomId) ? new Map([...prev].filter(([id]) => id !== roomId)) : prev));
    persist(removeFundRoom(roomId));
  }, [closeRoom, persist]);

  // ─── vsk:4 banlist affordances (deny-only; the fold is the gate) ────────
  /** Founder-or-ban-perm check against the room's CURRENT role fold, plus
   *  the structural honesty gates: a frozen or unknown-catalog fold cannot
   *  authorize bans (who holds `ban` is exactly what's ambiguous), and a
   *  session without a signing key cannot publish. */
  const mayBan = React.useCallback((roomId: string, pubkey: string): boolean => {
    if (!pubkey) return false;
    const live = liveRef.current.get(roomId);
    if (!live) return false;
    const meta = controlMetaRef.current.get(roomId);
    const folded = rolesByRoomRef.current.get(roomId);
    if (!meta || !folded) return false;
    if (folded.frozen || folded.unknownCatalog || folded.status === 'ignored-ephemeral') return false;
    const self = selfAuthorRef.current;
    if (!self) return false;
    if (pubkey.toLowerCase() === self) return false; // no self-ban
    return self === meta.founder || (folded.grants.get(self)?.some((r) => r.perms.includes('ban')) ?? false);
  }, []);

  /** UI gate for kick affordances: founder or `kick` perm holder, same
   *  structural honesty gates as mayBan (frozen/unknown-catalog refuse).
   *  Defined BEFORE publishBanEdition, which gates on it. */
  const mayKick = React.useCallback((roomId: string, pubkey: string): boolean => {
    if (!pubkey) return false;
    const live = liveRef.current.get(roomId);
    if (!live) return false;
    const meta = controlMetaRef.current.get(roomId);
    const folded = rolesByRoomRef.current.get(roomId);
    if (!meta || !folded) return false;
    if (folded.frozen || folded.unknownCatalog || folded.status === 'ignored-ephemeral') return false;
    const self = selfAuthorRef.current;
    if (!self) return false;
    if (pubkey.toLowerCase() === self) return false; // no self-kick
    return self === meta.founder || (folded.grants.get(self)?.some((r) => r.perms.includes('kick')) ?? false);
  }, []);

  const publishBanEdition = React.useCallback(async (roomId: string, target: string, lift: boolean, reason?: string, expiration?: number, perm: 'ban' | 'kick' = 'ban'): Promise<void> => {
    if (perm === 'kick' ? !mayKick(roomId, target) : !mayBan(roomId, target)) {
      throw new Error(`missing-perm: ${perm} requires the founder key or the \`${perm}\` perm in the current role fold`);
    }
    const live = liveRef.current.get(roomId);
    const meta = controlMetaRef.current.get(roomId);
    if (!live || !meta || typeof live.conn.publish !== 'function') throw new Error('not_joined');
    const event = lift
      ? buildBanLiftEvent(live.authorSecretKey, { roomId, epoch: meta.epoch, target })
      : buildBanEditionEvent(live.authorSecretKey, { roomId, epoch: meta.epoch, target, ...(reason ? { reason } : {}), ...(expiration !== undefined ? { expiration } : {}) });
    await live.conn.publish(event);
    // Optimistic refold; the live subscription reconciles with the relay.
    applyControlRef.current.get(roomId)?.([...(controlEventsRef.current.get(roomId) ?? []), event]);
  }, [mayBan, mayKick]);

  // ─── Room settings: role management (owner spec 2026-09-14) ─────────────
  /** Who may publish a vsk:1 role edition from THIS session: the founder
   *  key, or a member holding `pin-role` in the current fold (the fold, not
   *  this check, is the real authority - same shape as mayBan). */
  const mayManageRoles = React.useCallback((roomId: string): boolean => {
    const live = liveRef.current.get(roomId);
    const meta = controlMetaRef.current.get(roomId);
    const folded = rolesByRoomRef.current.get(roomId);
    if (!live || !meta || !folded) return false;
    if (folded.frozen || folded.unknownCatalog || folded.status === 'ignored-ephemeral') return false;
    const self = selfAuthorRef.current;
    if (!self) return false;
    return self === meta.founder || hasPerm(folded, self, 'pin-role');
  }, []);

  /** Publish a FULL-RESTATEMENT role edition: adds `pubkey` to `roleId`
   *  (grantRole) or removes them (revokeRole - omission is deletion).
   *  Structure and other members are restated unchanged from the current
   *  fold; a frozen/unknown-catalog fold refuses (same honesty gates as the
   *  ban path). Signed by THIS session's key when it is the founder - i.e.
   *  the creator's browser session holding the governance key via join.
   *  NOTE: non-founder members holding pin-role sign with their own key;
   *  membership-only restatement rule (§2) is enforced by receivers' fold. */
  const publishRoleEdition = React.useCallback(async (roomId: string, mutate: (spec: EditionSpec) => EditionSpec): Promise<void> => {
    const live = liveRef.current.get(roomId);
    const meta = controlMetaRef.current.get(roomId);
    const folded = rolesByRoomRef.current.get(roomId);
    if (!live || !meta || !folded) throw new Error('not_joined');
    if (folded.status !== 'ok') throw new Error(`roles unavailable: ${folded.status}`);
    // Unknown catalog = fail closed (same rule as mayManageRoles): restating
    // unknown role ids under this client's catalog would publish a structure
    // nobody can fold. The founder's authority does not bypass catalog
    // honesty.
    if (folded.unknownCatalog) throw new Error('roles unavailable: unknown catalog version');
    const self = selfAuthorRef.current;
    if (!self) throw new Error('no session key');
    if (self !== meta.founder && !hasPerm(folded, self, 'pin-role')) {
      throw new Error('missing-perm: role management requires the founder or pin-role');
    }
    if (typeof live.conn.publish !== 'function') throw new Error('transport lacks publish');
    // Restate from the CURRENT top edition (spec §2: full set every time).
    const top = folded.edition;
    const roles = top
      ? [...top.roles].map((r) => ({ id: r.id, rank: r.rank ?? 1 }))
      : [{ id: 'moderator', rank: 1 }];
    const perms: Array<{ roleId: string; perm: Perm }> = [];
    if (top) {
      for (const [roleId, list] of top.perms) for (const p of list) perms.push({ roleId, perm: p });
    } else {
      // Bootstrap: founder-unsigned room gets the default moderator perms.
      for (const p of ['pin', 'kick', 'ban', 'delete-message', 'role-grant'] as const) perms.push({ roleId: 'moderator', perm: p });
    }
    const members: Array<{ roleId: string; pubkey: string }> = [];
    if (top) {
      for (const [roleId, pks] of top.members) for (const pk of pks) members.push({ roleId, pubkey: pk });
    }
    const base: EditionSpec = {
      roomId,
      epoch: meta.epoch,
      roles,
      perms,
      members,
      ...(top?.eventId ? { prev: top.eventId } : {}),
    };
    const event = buildRoleEditionEvent(live.authorSecretKey, mutate(base));
    await live.conn.publish(event);
    // Optimistic refold; the live subscription reconciles with the relay.
    applyControlRef.current.get(roomId)?.([...(controlEventsRef.current.get(roomId) ?? []), event]);
  }, []);

  /** The room's founder (governance) key from the control-fold metadata. */
  const roomFounder = React.useCallback((roomId: string): string | null => {
    return controlMetaRef.current.get(roomId)?.founder ?? null;
  }, []);

  /** Current role assignments in the room's top edition: pubkey → role ids.
   *  Read-only view for the settings roster. */
  const roleGrants = React.useCallback((roomId: string): Map<string, string[]> => {
    const folded = rolesByRoomRef.current.get(roomId);
    const out = new Map<string, string[]>();
    if (!folded?.edition) return out;
    for (const [pk, assigned] of folded.grants) {
      out.set(pk, assigned.map((r) => r.roleId));
    }
    return out;
  }, []);

  const grantRole = React.useCallback(async (pubkey: string, roleId = 'moderator') => {
    if (!selectedRoomId) throw new Error('no room selected');
    const target = pubkey.toLowerCase().trim();
    await publishRoleEdition(selectedRoomId, (spec) => ({
      ...spec,
      members: [...spec.members.filter((m) => !(m.pubkey === target && m.roleId === roleId)), { roleId, pubkey: target }],
    }));
  }, [selectedRoomId, publishRoleEdition]);

  const revokeRole = React.useCallback(async (pubkey: string, roleId = 'moderator') => {
    if (!selectedRoomId) throw new Error('no room selected');
    const target = pubkey.toLowerCase().trim();
    await publishRoleEdition(selectedRoomId, (spec) => ({
      ...spec,
      members: spec.members.filter((m) => !(m.pubkey === target && m.roleId === roleId)),
    }));
  }, [selectedRoomId, publishRoleEdition]);

  // Ban/lift target resolution: when a verified member claim links the
  // observed transport key to a durable member key, address the DURABLE key so
  // the removal survives burner rotation (F7). Unclaimed authors fall back to
  // their current key.
  const memberKeyFor = React.useCallback(
    (roomId: string, author: string): string | null =>
      memberIdsRef.current.get(roomId)?.get(author.toLowerCase()) ?? null,
    [],
  );

  const banAuthor = React.useCallback(
    async (pubkey: string, reason?: string) => {
      if (!selectedRoomId) throw new Error('no room selected');
      const target = memberKeyFor(selectedRoomId, pubkey) ?? pubkey.toLowerCase();
      await publishBanEdition(selectedRoomId, target, false, reason);
    },
    [selectedRoomId, publishBanEdition, memberKeyFor],
  );

  const liftBan = React.useCallback(
    async (pubkey: string) => {
      if (!selectedRoomId) throw new Error('no room selected');
      const target = memberKeyFor(selectedRoomId, pubkey) ?? pubkey.toLowerCase();
      await publishBanEdition(selectedRoomId, target, true);
    },
    [selectedRoomId, publishBanEdition, memberKeyFor],
  );

  /** KICK = a NIP-40-expiring ban: the deny lapses at `expiration` (unix
   *  seconds) without any lift event. Discord parity - "timeout". Clients
   *  that ignore expiration keep the deny (fail closed). Default: 1 hour.
   *  Gated on the `kick` perm (distinct from `ban`). */
  const kickAuthor = React.useCallback(
    async (pubkey: string, durationSeconds = 3600) => {
      if (!selectedRoomId) throw new Error('no room selected');
      const target = memberKeyFor(selectedRoomId, pubkey) ?? pubkey.toLowerCase();
      const expiration = Math.floor(Date.now() / 1000) + Math.max(60, durationSeconds);
      await publishBanEdition(selectedRoomId, target, false, 'kicked', expiration, 'kick');
    },
    [selectedRoomId, publishBanEdition, memberKeyFor],
  );

  // Close every session on unmount (page nav / hot reload).
  React.useEffect(() => {
    const live = liveRef.current;
    const selection = selectionRef.current;
    return () => {
      ++selection.generation;
      selection.roomId = null;
      for (const [, room] of live) {
        room.abort.abort();
        room.unsubscribe?.();
        room.unsubTyping?.();
        room.unsubMentions?.();
        room.unsubRoles?.();
        for (const unsub of room.reactionSubs.values()) unsub();
        room.reactionSubs.clear();
        room.typingSignal?.dispose();
        room.conn.close();
      }
      live.clear();
    };
  }, []);

  /** Default public rooms (owner spec 2026-09-14): ensure Trollbox +
   *  Public Chat exist, then land in Trollbox. Idempotent: rooms already
   *  in the list are kept (never re-imported); any API failure is silent -
   *  defaults are an enhancement, not a correctness surface. An INVITE-LINK
   *  join takes precedence: the caller passes `skipLanding` and the user
   *  lands in their invited room instead. `opts.onlyRoomName` (guests)
   *  filters the API doors before importing so a signed-out visitor never
   *  persists the member rooms into their browser. */
  const ensureDefaultRooms = React.useCallback(async (signer: SignerLike, skipLanding: boolean, opts?: { onlyRoomName?: string }): Promise<void> => {
    try {
      const all = await fetchPublicRooms(signer as unknown as Parameters<typeof fetchPublicRooms>[0]);
      const pub = opts?.onlyRoomName ? all.filter((room) => room.name === opts.onlyRoomName) : all;
      if (pub.length === 0) return;
      let landing: string | null = null;
      for (const room of pub) {
        if (room.name === DEFAULT_LANDING_ROOM) landing = room.roomId;
      }
      // Import any missing defaults, then re-read the freshest list for landing.
      const known = new Set(loadFundRooms().map((r) => r.roomId));
      let changed = false;
      for (const room of pub) {
        if (known.has(room.roomId)) continue;
        const meta = roomMetaFromLink(room.link, room.name);
        persist(addFundRoom(meta));
        changed = true;
      }
      void changed;
      if (!skipLanding && landing) {
        const fresh = loadFundRooms().find((r) => r.roomId === landing);
        // activateRoom takes the meta directly: selectRoom's closure would
        // still hold the pre-import rooms state on a fresh browser, so the
        // landing silently no-opped for first-time guests.
        if (fresh) void activateRoom(fresh);
      }
    } catch { /* defaults are best-effort */ }
  }, [activateRoom, persist]);

  /** Cross-app room parity: the same identity sees its MARKET rooms on
   *  bao.fund / app.bao.network / bao.network. The markets API is another
   *  origin, so the call rides Authorization (its CORS allowlist does not
   *  expose X-Nostr-Auth) and each link imports exactly like an invite:
   *  roomMetaFromLink + saveFundRooms. Best-effort by design. */
  const syncExternalRooms = React.useCallback(async (signer: SignerLike) => {
    try {
      const url = 'https://relay.bao.network/bao-api/v1/chat/my-rooms';
      const header = await nip98Header(signer, url, 'GET');
      const res = await fetch(url, { headers: { Authorization: header } });
      if (!res.ok) return;
      const payload = (await res.json()) as { data?: { rooms?: { marketId?: string; title?: string; link?: string }[] } };
      const list = payload?.data?.rooms ?? [];
      const existing = loadFundRooms();
      const known = new Set(existing.map((r) => r.roomId));
      const next = [...existing];
      for (const row of list) {
        if (!row?.link || !row?.title) continue;
        try {
          const meta = roomMetaFromLink(String(row.link), String(row.title));
          if (known.has(meta.roomId)) continue;
          known.add(meta.roomId);
          next.push(meta);
        } catch { /* malformed link: skip */ }
      }
      if (next.length !== existing.length) {
        saveFundRooms(next);
        setRooms(next);
      }
    } catch { /* external rooms are a convenience, never a blocker */ }
  }, []);

  const resetSessions = React.useCallback(() => {
    selectionRef.current.generation += 1;
    selectionRef.current.roomId = null;
    for (const roomId of [...liveRef.current.keys()]) closeRoom(roomId);
    setSelectedRoomId(null);
    setMessages([]);
    setTyping({ authors: [] });
    setRoster(new Map());
    setMentions([]);
    // Notification badges are session state: the signed-out session's
    // unread mentions must not persist into the next identity's UI.
    setMentionUnread(new Map());
    // Bot announcements are per-session author evidence (burner keys); a
    // later login must re-derive them from its own scrolls.
    setBotAuthors(new Set());
    selfAuthorRef.current = null;
    setSelfAuthor(null);
    setIsSending(false);
    setError(null);
    // Account-scoped room state must not survive a sign-out on a shared
    // browser (badges, bans, roles, claims, bot announcements, probes).
    setMentionUnread(new Map());
    setMemberClaims(new Map());
    setBotAuthors(new Set());
    setCapabilities(new Map());
    // Invalidate every in-flight probe: a superseded result must not fold
    // account-scoped capability state after a sign-out/identity switch.
    probeGenerationRef.current = new Map();
    probeInFlightRef.current.clear();
    setCapabilityProbeInFlight(false);
    setRoles(new Map());
    setBans(new Map());
  }, [closeRoom]);

  return {
    rooms, messages, typing, roster, mentions, selectedRoomId,
    /** Notifications (owner spec): mention badges per room. */
    mentionUnread,
    /** Owner spec: author keys that announced as bots - render 🤖. */
    botAuthors,
    selectRoom, resetSessions, sendMessage, postToRoom, notifyTyping, toggleReaction, retractMessage, replyToMessage,
    selfAuthor, isSending, error,
    importLink, importCampaign, createRoom, removeRoom,
    ensureDefaultRooms,
    syncExternalRooms,
    /** Row E: measured storage capability per room + probe-in-flight flag. */
    capabilities, capabilityProbeInFlight,
    /** Roles spec §1/§5: folded role state per room. */
    roles,
    /** vsk:4 banlist state + gated affordances (deny-only). */
    bans,
    memberClaims,
    memberKeyFor,
    mayBan,
    mayKick,
    banAuthor,
    liftBan,
    kickAuthor,
    /** Room settings (owner spec 2026-09-14). */
    mayManageRoles,
    grantRole,
    revokeRole,
    roleGrants,
    roomFounder,
  };
}
