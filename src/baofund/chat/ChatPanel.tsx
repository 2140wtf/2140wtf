import React from 'react';
import { Send, Lock, Hash, MessageCircle, Plus, X, Copy, Check, Shield, Bot, Trash2, Reply, RotateCcw, AtSign, HardDrive, Loader2, Settings, UserPlus, Ban, Maximize2, Minimize2, LogOut, Info, HandCoins } from 'lucide-react';
import { useChatContext, type ChatItem } from './ChatContext';
import { agentShareText, fetchAgentHelloSha, sanitizeRoomName } from './agentPrompt';
import { useIsChatAdmin } from './useIsChatAdmin';
import { fundApiOrigin } from '../lib/fundHttp';
import { isAuthorBanned as isAuthorBannedByIdentity } from './memberIdentity';
import { useAuth } from '../auth/useAuth';
import { createGuestSigner } from '../relay/guestIdentity';
import { DEFAULT_LANDING_ROOM } from '../lib/baoCommunity';
import { roomLinkPrivacy } from '@/baofund/community/agents.js';
import { storageVerdictAdvisory } from '../lib/roomCapabilities';

export interface ChatPanelProps {
  defaultRoomId?: string | null;
  /** Land on this room by name once the defaults are imported (the public
   *  doors opened from the campaign-chat gate). Ignored when defaultRoomId
   *  is set. */
  defaultRoomName?: string | null;
  /** Start in full-viewport mode (used by the BAO chat-first entry at
   *  app.bao.network). */
  defaultFullscreen?: boolean;
  /** Native page flow (bao.network hub): render inline by default - the page
   *  itself grows and scrolls. The fullscreen toggle still expands the SAME
   *  panel to the fixed overlay on every surface (owner rule 2026-09-21: all
   *  chats have the same features). */
  embedded?: boolean;
  /** Fund the selected room's campaign without leaving chat (owner priority
   *  2026-09-22). Called with the room's `fundraiserId` and name; the app
   *  opens the pledge flow, whose built-in-wallet step pre-fills the escrow. */
  onFundCampaign?: (fundraiserId: string, title: string) => void;
}

/** Quick reactions (module-level: never re-created per render). */
const REACTIONS = ['⚡', '🤙', '😂', '🔥'] as const;

/** Room minting is operator-provisioned unless explicitly enabled (see
 *  useProtocolChat.createRoom); operators mint with `npm run provision-room`.
 *  ADMINS always get the affordance: the owner ruling 2026-09-22 is that an
 *  admin can create arbitrary (invisible) rooms from the UI, independent of
 *  the build flag. The API remains the authority (GET /v1/me scopes). */
const CHAT_CREATE_ENABLED =
  (import.meta.env as Record<string, string | undefined>).VITE_BAO_CHAT_CREATE_ENABLED === '1';

export function ChatPanel({ defaultRoomId, defaultRoomName, defaultFullscreen = false, embedded = false, onFundCampaign }: ChatPanelProps): React.ReactElement {
  const {
    rooms,
    messages,
    typing,
    roster,
    mentions,
    selectedRoomId,
    selectRoom,
    sendMessage,
    notifyTyping,
    toggleReaction,
    retractMessage,
    replyToMessage,
    selfAuthor,
    isSending,
    error,
    mentionUnread,
    importLink,
    createRoom,
    removeRoom,
    ensureDefaultRooms,
    syncExternalRooms,
    capabilities,
    capabilityProbeInFlight,
    botAuthors,
    roles,
    bans,
    memberClaims,
    mayBan,
    mayKick,
    banAuthor,
    liftBan,
    kickAuthor,
    mayManageRoles,
    grantRole,
    revokeRole,
    roleGrants,
    roomFounder,
    resetSessions,
  } = useChatContext();
  const { signer, logout, pubkey: authPubkey, status: authStatus } = useAuth();
  // Admin gate for in-app room creation (server-verified, fail closed).
  const isAdmin = useIsChatAdmin(signer);
  const canCreateRoom = CHAT_CREATE_ENABLED || isAdmin;
  // bao is more than chat: signed-out visitors see the live room too. The guest
  // signer ONLY signs NIP-98 for VIEWING - posting is locked to members below,
  // and nothing member-gated (wallet/court/campaigns) reads `signer` here.
  // Default public rooms (owner spec 2026-09-14): on auth, ensure Trollbox +
  // Public Chat exist and land in Trollbox - UNLESS the user arrived via an
  // invite link (defaultRoomId set): they land in THEIR room, with the
  // defaults still available in the sidebar. Signed-out guests import ONLY
  // the public landing room: the other rooms are member doors (owner spec
  // 2026-09-19: guests see Trollbox, authed users see Trollbox + Public Chat).
  const guestDefaultsEnsured = React.useRef(false);
  const memberDefaultsEnsured = React.useRef(false);
  React.useEffect(() => {
    const effective = signer ?? createGuestSigner();
    if (!effective) return;
    if (!signer) {
      if (guestDefaultsEnsured.current) return;
      guestDefaultsEnsured.current = true;
      void ensureDefaultRooms(effective, Boolean(defaultRoomId), { onlyRoomName: DEFAULT_LANDING_ROOM });
      return;
    }
    if (memberDefaultsEnsured.current) return;
    memberDefaultsEnsured.current = true;
    void ensureDefaultRooms(effective, Boolean(defaultRoomId));
    // Cross-app parity: pull this identity's MARKET rooms (bao.markets API)
    // into the local list so the same rooms follow the user everywhere.
    void syncExternalRooms(effective);
  }, [signer, defaultRoomId, ensureDefaultRooms, syncExternalRooms]);
  // Signed-out visitors only see the one public door. Rooms already persisted
  // in this browser (from an earlier signed-in session, or invite links) stay
  // out of the guest sidebar until sign-in.
  const visibleRooms = React.useMemo(
    () => (signer ? rooms : rooms.filter((room) => room.name === DEFAULT_LANDING_ROOM)),
    [rooms, signer],
  );
  // Identity rebind: the open room's live session was keyed to the identity
  // active at join time (guest burner, or a previous account). On change,
  // FORCE a re-join so the per-room member key re-derives - a plain reselect
  // is a no-op while the session is live. Skipped on a fresh session restore
  // (no room open yet).
  const lastAuthPubkey = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (authPubkey === lastAuthPubkey.current) return;
    lastAuthPubkey.current = authPubkey;
    if (authPubkey && selectedRoomId) void selectRoom(selectedRoomId, { force: true });
  }, [authPubkey, selectedRoomId, selectRoom]);
  // Sign-out: close every live session and clear room state. Without this the
  // previous member session stays live and keeps posting under its key.
  const authWasReady = React.useRef(false);
  React.useEffect(() => {
    if (authStatus === 'ready') {
      authWasReady.current = true;
      return;
    }
    if (authStatus === 'signed-out' && authWasReady.current) {
      authWasReady.current = false;
      resetSessions();
    }
  }, [authStatus, resetSessions]);
  const [input, setInput] = React.useState('');
  const [linkInput, setLinkInput] = React.useState('');
  const [showAgentOnboard, setShowAgentOnboard] = React.useState(false);
  const [zapInfoMsg, setZapInfoMsg] = React.useState<string | null>(null);
  const [agentPromptCopied, setAgentPromptCopied] = React.useState(false);
  const [agentHelloSha, setAgentHelloSha] = React.useState<string | null>(null);
  const [agentLane, setAgentLane] = React.useState<{ roomId: string; link: string } | null>(null);
  const [newRoomName, setNewRoomName] = React.useState('');
  // cap-pow by default (hardening: unsolved joins are rejected by the welcomer;
  // the API also defaults to cap-pow when policy is omitted entirely).
  const [newRoomPolicy, setNewRoomPolicy] = React.useState<'open' | 'cap-pow' | 'invite'>('cap-pow');
  const [newRoomAudienceMode, setNewRoomAudienceMode] = React.useState<'humans' | 'agents' | 'both'>('both');
  const [newRoomLabel, setNewRoomLabel] = React.useState('');
  const [showCreate, setShowCreate] = React.useState(false);
  const [showSettings, setShowSettings] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [replyTarget, setReplyTarget] = React.useState<ChatItem | null>(null);
  // Fullscreen/zoom chat (Discord-like): fixed overlay over the whole app;
  // Escape exits. The panel keeps its own sidebar + message columns.
  // Embedded (hub) mode STARTS inline but can expand like every other surface
  // (owner rule 2026-09-21: all chats have the same features).
  const [fullscreen, setFullscreen] = React.useState(defaultFullscreen);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  // Live mentions collected by the hook (subscribeMentions) → per-room badge
  // counts + a header line for the open room. Counts are "mentions received
  // this session"; cross-restart catch-up (MentionInbox) is the documented
  // future upgrade path.
  const mentionCounts = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of mentions) counts.set(m.roomId, (counts.get(m.roomId) ?? 0) + 1);
    return counts;
  }, [mentions]);
  const lastMentionHere = React.useMemo(
    () => mentions.find((m) => m.roomId === selectedRoomId) ?? null,
    [mentions, selectedRoomId],
  );

  React.useEffect(() => {
    // Embedded INLINE pages scroll as a whole (bao.network hub) - never
    // hijack the page scroll on new messages. The fullscreen overlay owns
    // its scroll on every surface.
    if (embedded && !fullscreen) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, embedded, fullscreen]);

  React.useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  // One-shot: a later room-list change (external sync) must not yank the
  // user back to the invite room after they picked another one.
  const landedByDefault = React.useRef(false);
  React.useEffect(() => {
    if (landedByDefault.current || !defaultRoomId) return;
    if (visibleRooms.some((r) => r.roomId === defaultRoomId)) {
      landedByDefault.current = true;
      void selectRoom(defaultRoomId);
    }
  }, [defaultRoomId, visibleRooms, selectRoom]);

  // A reply target belongs to the room it was picked in: switching rooms
  // must not post it into the new room (foreign root / orphan).
  React.useEffect(() => {
    // Deferred to a microtask: the effect body must stay free of reachable
    // synchronous setState (react-perf rule), same pattern as WalletPanel.
    void Promise.resolve().then(() => setReplyTarget(null));
  }, [selectedRoomId]);

  // Public-door landing (campaign-chat gate): select by name once the room
  // list has the imported default. One-shot - later room picks are the
  // user's. defaultRoomId (campaign invites) wins when both are present.
  const landedByName = React.useRef(false);
  React.useEffect(() => {
    if (landedByName.current || defaultRoomId || !defaultRoomName) return;
    const room = visibleRooms.find((r) => r.name === defaultRoomName);
    if (!room) return;
    landedByName.current = true;
    void selectRoom(room.roomId);
  }, [defaultRoomId, defaultRoomName, visibleRooms, selectRoom]);

  const selectedRoom = visibleRooms.find((r) => r.roomId === selectedRoomId);
  // Guests may post in the landing room only (burner identity; the room's
  // retention applies). Every other room stays member-only.
  const guestCanPost = !signer && selectedRoom?.name === DEFAULT_LANDING_ROOM;
  const privacy = selectedRoom ? roomLinkPrivacy(selectedRoom.link) : null;

  // Copyable onboarding prompt for AI agents (owner 2026-09-20). The popup
  // exists so a human can hand any agent a single paste-ready brief: the
  // hello client (URL + sha256), the join + credential-saving steps, and the
  // house rules. The room link carries the keys.
  React.useEffect(() => {
    let cancelled = false;
    void fetchAgentHelloSha().then((sha) => { if (!cancelled) setAgentHelloSha(sha); });
    return () => { cancelled = true; };
  }, []);
  // The agent prompt carries ONE room link: the AGENT-lane link, never the
  // human link. Stored rooms keep it (campaign provisioning); otherwise fetch
  // it from the API for the selected room (NIP-98 signed, guest key works).
  React.useEffect(() => {
    let cancelled = false;
    if (!selectedRoom || selectedRoom.agentLink) return () => { cancelled = true; };
    void (async () => {
      try {
        const effective = signer ?? createGuestSigner();
        const url = `${fundApiOrigin()}/v1/chat/rooms/${selectedRoom.roomId}/agent-link`;
        const signed = await effective.signEvent({
          kind: 27235,
          created_at: Math.floor(Date.now() / 1000),
          tags: [['u', url], ['method', 'GET'], ['nonce', crypto.randomUUID()]],
          content: '',
        });
        const res = await fetch(url, { headers: { Authorization: `Nostr ${btoa(JSON.stringify(signed))}` } });
        if (!res.ok) return;
        const json = await res.json() as { data?: { agentLink?: string } };
        if (!cancelled && typeof json.data?.agentLink === 'string') setAgentLane({ roomId: selectedRoom.roomId, link: json.data.agentLink });
      } catch { /* no agent lane - the prompt asks for a room with one */ }
    })();
    return () => { cancelled = true; };
  }, [selectedRoom, signer]);
  // Single link for agents: the agent-lane link. Never the human link.
  // Derived per render (NOT inside the memo): the memo only recomputes on dep
  // changes, so a stale fetched lane from a previous room (same name, no
  // agentLink, failed fetch for the new room) would otherwise stay in the
  // prompt and send the agent into the wrong room.
  const laneLink = selectedRoom?.agentLink
    ?? (agentLane && agentLane.roomId === selectedRoom?.roomId ? agentLane.link : null);
  const agentPrompt = React.useMemo(() => {
    // Canonical sanitizer from the shared brief: the room label is interpolated
    // into the intro and the brief, so it must not carry quote/control/bidi
    // characters that could break out of the quoted label.
    const roomName = sanitizeRoomName(selectedRoom?.name);
    const intro = `You are an AI agent joining the BAO community chat ("${roomName}"). BAO is open community chat on Nostr: one identity across every BAO app (bao.network, app.bao.network, bao.fund). The full BAO Fund app - campaigns, wallet, donations - is public at https://app.bao.network/index.html; the app-host root is the chat, and fund.bao.network is the password-gated testnet mirror.

CREATE A CAMPAIGN - the ONLY supported way is the Fund API: POST /v1/fundraisers with a NIP-98 signature from your identity. NEVER publish relay events (kind 39801 cards, 49305 ledgers, 38003 rooms) yourself - hand-made cards show up as broken campaigns with no owner record and have to be deleted by an operator. Rails are l1 (Bitcoin testnet4) or liquid (Liquid testnet) only; cashu is gone. Inside this repo, one command does it all: npx tsx scripts/agent-create-campaign.mts --state-dir ~/.bao-agent --title "Your campaign" --goal 21000 --rail l1. The API mints the record, publishes the card, provisions the campaign room and returns its link - keep that link private (bearer capability) and join with the same identity. Full step-by-step guide, including the raw HTTP + NIP-98 contract for agents without the repo: docs/AGENT-CAMPAIGN-GUIDE.md.`;
    return `${intro}\n\n${agentShareText(laneLink ?? '', agentHelloSha, {
      roomName,
      agentLink: laneLink,
    })}`;
  }, [laneLink, selectedRoom?.name, agentHelloSha]);
  // Roles spec §6: folded role state for the open room - mod badges + fork
  // banner. Unknown-catalog roles render `?` and enforce nothing (§8 D1); a
  // frozen room shows the B1-style conflict banner (§5).
  const foldedRoles = selectedRoomId ? roles.get(selectedRoomId) : undefined;
  const foldedBans = selectedRoomId ? bans.get(selectedRoomId) : undefined;
  const roleBadgeFor = (author: string): string | null => {
    const assigned = foldedRoles?.grants.get(author)?.[0];
    if (!assigned) return null;
    return assigned.known ? assigned.roleId : '?';
  };
  // vsk:4 banlist (deny-only): affordances render only when THIS session's
  // key may publish a ban for the target (founder or current `ban` holder);
  // the hook re-checks on the actual call.
  const [modNotice, setModNotice] = React.useState<string | null>(null);
  const canModerate = (author: string): boolean =>
    !!selectedRoomId && mayBan(selectedRoomId, author);
  // Identity-aware removal display: an author is banned when either their
  // transport key or their verified durable member key is on the deny list,
  // so a ban survives burner rotation (F7). No human attestation involved.
  const isAuthorBanned = (author: string): boolean =>
    isAuthorBannedByIdentity(
      foldedBans,
      selectedRoomId ? memberClaims.get(selectedRoomId) : undefined,
      author,
    );
  const handleBan = async (author: string) => {
    setModNotice(null);
    try {
      await banAuthor(author);
      setModNotice(`Ban edition published for ${author.slice(0, 8)}…`);
    } catch (err) {
      setModNotice(`Ban failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const handleLift = async (author: string) => {
    setModNotice(null);
    try {
      await liftBan(author);
      setModNotice(`Lift published for ${author.slice(0, 8)}…`);
    } catch (err) {
      setModNotice(`Lift failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const handleKick = async (author: string) => {
    setModNotice(null);
    try {
      await kickAuthor(author);
      setModNotice(`Kick published for ${author.slice(0, 8)}… (deny lapses in 1h)`);
    } catch (err) {
      setModNotice(`Kick failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Discord-style user card: click an author chip (message header or roster)
  // to open a moderation popover with every action THIS session may take.
  // Affordances are gated per-action via the hook's fold-backed gates; the
  // hook re-checks on the call, so a stale card can never over-authorize.
  const [userCard, setUserCard] = React.useState<{ author: string; anchor: { x: number; y: number } } | null>(null);
  const closeUserCard = React.useCallback(() => setUserCard(null), []);

  // Document-title notification: total unread MENTIONS surface in the tab
  // title so replies are visible from another tab (Discord parity). Message
  // counts are not produced (WS3 option C).
  const totalMentionUnread = [...mentionUnread.values()].reduce((a, b) => a + b, 0);
  React.useEffect(() => {
    // The hub page owns its title in embed mode; only the standalone app
    // surfaces unread mention counts in the tab title.
    if (embedded) return;
    const prefix = totalMentionUnread > 0 ? `(${totalMentionUnread}) ` : '';
    const base = '₿AO';
    document.title = prefix ? `${prefix}${base}` : base;
    return () => { document.title = '₿AO'; };
  }, [totalMentionUnread, embedded]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    if (replyTarget) {
      await replyToMessage(replyTarget.id, input.trim());
      setReplyTarget(null);
    } else {
      await sendMessage(input.trim());
    }
    setInput('');
  };



  const handleImportLink = (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkInput.trim()) return;
    void importLink(linkInput.trim());
    setLinkInput('');
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoomName.trim() || !signer) return;
    void createRoom(newRoomName.trim(), {
      policy: newRoomPolicy,
      audienceMode: newRoomAudienceMode,
      ...(newRoomLabel.trim() ? { label: newRoomLabel.trim() } : {}),
    }, signer);
    setNewRoomName('');
    setNewRoomLabel('');
    setShowCreate(false);
  };

  const copyLink = () => {
    if (!selectedRoom) return;
    void navigator.clipboard.writeText(selectedRoom.link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div
      className={`grid gap-4 sm:grid-cols-[260px_1fr] ${fullscreen ? 'fixed inset-0 z-50 overflow-y-auto p-3 sm:p-5' : ''}`}
      style={fullscreen ? { background: 'var(--np-paper, #fdfdf8)' } : undefined}
    >

      {/* Sidebar */}
      <div className="border-r pr-2" style={{ borderColor: 'var(--np-rule)' }}>
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>
            Rooms
          </span>
          <span className="flex items-center gap-1">
            {canCreateRoom && (
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                className="rounded p-1 hover:bg-black/5"
                aria-label="Create room"
                title="Create room (in-app minting enabled)"
              >
                <Plus size={14} style={{ color: 'var(--np-muted)' }} />
              </button>
            )}
            {signer && (
              <button
                type="button"
                onClick={logout}
                className="rounded p-1 hover:bg-black/5"
                aria-label="Sign out"
                title="Sign out"
              >
                <LogOut size={14} style={{ color: 'var(--np-muted)' }} />
              </button>
            )}
          </span>
        </div>

        {canCreateRoom && showCreate && (
          <form onSubmit={handleCreate} className="mb-3 border p-2" style={{ borderColor: 'var(--np-rule)' }}>
            <input
              value={newRoomName}
              onChange={(e) => setNewRoomName(e.target.value)}
              placeholder="Room name"
              className="mb-2 w-full rounded border bg-transparent px-2 py-1 text-xs"
              style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
            />
            <select
              value={newRoomPolicy}
              onChange={(e) => setNewRoomPolicy(e.target.value as 'open' | 'cap-pow' | 'invite')}
              className="mb-2 w-full rounded border bg-transparent px-1 py-1 text-xs"
              style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
            >
              <option value="open">Open (anyone with the link)</option>
              <option value="cap-pow">PoW-gated</option>
              <option value="invite">Invite-only (secret)</option>
            </select>
            {/* Owner spec 2026-09-14: three audience modes. 'both' mints a
                SEPARATE agent invite link (stored on the room); 'humans'
                mints NO agent link; 'agents' labels the lane agent. */}
            <select
              value={newRoomAudienceMode}
              onChange={(e) => setNewRoomAudienceMode(e.target.value as 'humans' | 'agents' | 'both')}
              className="mb-2 w-full rounded border bg-transparent px-1 py-1 text-xs"
              style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
            >
              <option value="both">Humans + Agents</option>
              <option value="humans">Humans only (no agent link)</option>
              <option value="agents">Agents only</option>
            </select>
            <input
              value={newRoomLabel}
              onChange={(e) => setNewRoomLabel(e.target.value)}
              placeholder="Label (optional)"
              className="mb-2 w-full rounded border bg-transparent px-2 py-1 text-xs"
              style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
            />
            {!signer && (
              <p className="mb-2 text-[10px]" style={{ color: 'var(--np-error, #b91c1c)' }}>
                Log in to provision a room (operators mint via the provision-room CLI).
              </p>
            )}
            <div className="flex gap-1">
              <button type="submit" disabled={!signer} className="flex-1 rounded border px-2 py-1 text-xs disabled:opacity-50" style={{ borderColor: 'var(--np-rule)' }}>
                Create
              </button>
              <button type="button" onClick={() => setShowCreate(false)} className="rounded border px-2 py-1 text-xs" style={{ borderColor: 'var(--np-rule)' }}>
                <X size={12} />
              </button>
            </div>
          </form>
        )}

        <div className="space-y-1">
          {visibleRooms.map((room) => (
            <button
              key={room.roomId}
              onClick={() => void selectRoom(room.roomId)}
              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors ${
                selectedRoomId === room.roomId ? 'bg-[var(--np-accent)]/10' : 'hover:bg-black/5'
              }`}
            >
              {room.shielded ? (
                <Shield size={14} style={{ color: 'var(--np-accent-2)' }} />
              ) : (
                <Hash size={14} style={{ color: 'var(--np-muted)' }} />
              )}
              <span className="flex-1 truncate">{room.name}</span>
              {/* Discord badge semantics: @mentions win (red pill), then
                  session mention counts; cleared on open. Message unread
                  counts are not produced (WS3 option C). */}
              {(mentionUnread.get(room.roomId) ?? 0) > 0 ? (
                <span
                  className="rounded-full px-1.5 text-[10px] font-bold"
                  style={{ background: 'var(--np-danger, #b3261e)', color: '#fff' }}
                  title={`${mentionUnread.get(room.roomId)} unread mention(s)`}
                >
                  {mentionUnread.get(room.roomId)}
                </span>
              ) : (mentionCounts.get(room.roomId) ?? 0) > 0 && room.roomId !== selectedRoomId ? (
                <span
                  className="rounded-full px-1.5 text-[10px] font-bold"
                  style={{ background: 'var(--np-accent)', color: 'var(--np-on-accent)' }}
                  title={`${mentionCounts.get(room.roomId)} mention(s) this session`}
                >
                  {mentionCounts.get(room.roomId)}
                </span>
              ) : null}
              {room.audience === 'agent' && (
                <Bot size={12} style={{ color: 'var(--np-muted)' }} />
              )}
            </button>
          ))}
        </div>

        <form onSubmit={handleImportLink} className="mt-5">
          <label className="mb-1 block text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>
            Join via invite link
          </label>
          <div className="flex gap-1">
            <input
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
              placeholder="https://…/chat/join#…"
              className="flex-1 rounded border bg-transparent px-2 py-1 text-xs"
              style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
            />
            <button
              type="submit"
              className="rounded border px-2 py-1 text-xs"
              style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
            >
              <MessageCircle size={14} />
            </button>
          </div>
          {/* Owner copy (2026-09-19): the public rooms above are visible to
              everyone; every other room is invite-only and stays invisible
              until a link is pasted here. */}
          <p className="mt-1.5 text-[10px] leading-snug" style={{ color: 'var(--np-muted)' }}>
            Public rooms are visible to everyone. Other rooms are invite-only - paste a link to join one.
          </p>
          <button
            type="button"
            onClick={() => setShowAgentOnboard(true)}
            className="mt-2 w-full rounded border px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest hover:bg-black/5"
            style={{ borderColor: 'var(--np-accent-2)', color: 'var(--np-accent-2)', fontFamily: 'var(--np-font-mono)' }}
            title="Copy a ready-to-paste brief for an AI agent"
          >
            🤖 Onboard an AI agent
          </button>
        </form>
        {showAgentOnboard && (
          <div
            className="fixed inset-0 z-[80] overflow-y-auto p-4"
            style={{ background: 'rgba(0, 0, 0, 0.45)' }}
            onClick={() => setShowAgentOnboard(false)}
            role="dialog"
            aria-modal="true"
          >
            <div
              className="mx-auto max-w-2xl border p-4"
              style={{ background: 'var(--np-paper)', borderColor: 'var(--np-rule)' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--np-muted)', fontFamily: 'var(--np-font-mono)' }}>
                  Onboard an AI agent - {selectedRoom?.name ?? 'pick a room first'}
                </span>
                <button
                  type="button"
                  onClick={() => setShowAgentOnboard(false)}
                  className="rounded border px-2 py-0.5 text-xs"
                  style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
                >
                  Close
                </button>
              </div>
              <p className="mb-2 text-xs leading-relaxed" style={{ color: 'var(--np-muted)' }}>
                Paste this brief into any AI agent (Claude, GPT, a local model, your own bot).
                It contains the room link and the rules - one paste and it can join this room and say hello.
              </p>
              <textarea
                readOnly
                value={agentPrompt}
                rows={14}
                className="w-full rounded border bg-transparent p-2 text-xs"
                style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)', fontFamily: 'var(--np-font-mono)' }}
                onFocus={(e) => e.currentTarget.select()}
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(agentPrompt);
                    setAgentPromptCopied(true);
                    setTimeout(() => setAgentPromptCopied(false), 1500);
                  }}
                  className="rounded px-3 py-1.5 text-xs font-bold"
                  style={{ background: 'var(--np-accent)', color: 'var(--np-on-accent)', border: '1px solid var(--np-accent)', fontFamily: 'var(--np-font-mono)' }}
                >
                  {agentPromptCopied ? 'Copied ✓' : 'Copy prompt'}
                </button>
                <span className="text-[10px]" style={{ color: 'var(--np-muted)' }}>
                  The link carries the room keys - share it only with agents you trust in this room.
                </span>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* Main chat */}
      <div className="flex min-h-[360px] flex-col border" style={{ borderColor: 'var(--np-rule)' }}>
        <div className="border-b px-3 py-2" style={{ borderColor: 'var(--np-rule)' }}>
          <div className="flex items-center gap-2 text-sm font-semibold">
            {privacy?.shielded ? <Shield size={14} /> : <Hash size={14} />}
            {selectedRoom?.name ?? 'Select a room'}
            {selectedRoom && (
              <>
                <button onClick={copyLink} className="text-[10px]" style={{ color: 'var(--np-accent-2)' }} title="Copy invite link">
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                </button>
                {/* Fund from the room (owner priority 2026-09-22): campaign
                    rooms carry their fundraiserId, so a member can open the
                    pledge flow (with the built-in-wallet pay step) right here. */}
                {selectedRoom.fundraiserId && onFundCampaign && (
                  <button
                    onClick={() => onFundCampaign(selectedRoom.fundraiserId as string, selectedRoom.name)}
                    className="text-[10px]"
                    style={{ color: 'var(--np-accent-2)' }}
                    title="Fund this campaign with your built-in wallet"
                    aria-label="Fund this campaign"
                    data-testid="chat-fund-campaign"
                  >
                    <HandCoins size={12} />
                  </button>
                )}
                {/* Room settings (owner spec): roster + grant/revoke roles +
                    ban. Members only - a signed-out guest has no member
                    surface here (the panel gates every action anyway). */}
                {signer && (
                  <button onClick={() => setShowSettings((v) => !v)} className="text-[10px]" style={{ color: showSettings ? 'var(--np-accent)' : 'var(--np-muted)' }} title="Room settings - members & roles" aria-label="Room settings">
                    <Settings size={12} />
                  </button>
                )}
                {signer && (
                  <button onClick={() => removeRoom(selectedRoom.roomId)} className="text-[10px]" style={{ color: 'var(--np-muted)' }} title="Leave room">
                    <Trash2 size={12} />
                  </button>
                )}
                {/* Fullscreen toggle on EVERY surface (owner rule 2026-09-21:
                    all chats have the same features) - embedded included. */}
                <button onClick={() => setFullscreen((v) => !v)} className="text-[10px]" style={{ color: fullscreen ? 'var(--np-accent)' : 'var(--np-muted)' }} title={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen chat'} aria-label="Toggle fullscreen chat">
                  {fullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                </button>
              </>
            )}
          </div>
          <div className="text-[10px]" style={{ color: 'var(--np-muted)' }}>
            {!selectedRoom && 'Pick a room to start chatting'}
            {privacy?.shielded && 'Shielded transport (NIP-59) - uploads are gift-wrapped'}
            {privacy && !privacy.shielded && privacy.inviteId && `Invite link ${privacy.inviteId}`}
            {privacy?.expiresAt ? ` · expires ${new Date(privacy.expiresAt * 1000).toLocaleDateString()}` : ''}
            {privacy?.maxUses ? ` · ${privacy.maxUses} use${privacy.maxUses === 1 ? '' : 's'} max` : ''}
          </div>
          {/* Live-only rooms only (opt-in, today: BAO): measured storage
              verdict. All other rooms show nothing - no probe, no warning. */}
          {selectedRoom?.storageObservation && (() => {
            const cap = capabilities.get(selectedRoom.roomId);
            const verdict = cap?.storageVerdict ?? 'unknown';
            const color =
              verdict === 'stored' ? 'var(--np-danger, #b3261e)'
              : verdict === 'not-observed-storing' ? 'var(--np-muted)'
              : 'var(--np-accent-2)';
            const lines = capabilityProbeInFlight && !cap
              ? ['Measuring relay storage behavior…']
              : storageVerdictAdvisory(verdict, cap?.relayUrl ?? null);
            return (
              <div className="mt-1 flex items-start gap-1 text-[10px]" style={{ color }}>
                {capabilityProbeInFlight && !cap
                  ? <Loader2 size={10} className="animate-spin" />
                  : <HardDrive size={10} />}
                <span>
                  {lines.join(' ')}
                  {cap?.observedAt ? ` (checked ${new Date(cap.observedAt * 1000).toLocaleTimeString()})` : ''}
                </span>
              </div>
            );
          })()}
          {foldedRoles?.frozen && (
            <div className="mt-1 flex items-center gap-1 text-[10px]" style={{ color: 'var(--np-danger, #b3261e)' }}>
              <Shield size={10} />
              <span>Role conflict - editions disagree; roles frozen until the founder republishes.</span>
            </div>
          )}
          {(foldedBans?.banned.size ?? 0) > 0 && (
            <div className="mt-1 flex items-center gap-1 text-[10px]" style={{ color: 'var(--np-danger, #b3261e)' }}>
              <Shield size={10} />
              <span>
                {foldedBans!.banned.size} banned (deny-only; entries are advisory until admission enforces them)
              </span>
            </div>
          )}
          {(foldedBans?.frozenTargets.length ?? 0) > 0 && (
            <div className="mt-1 flex items-center gap-1 text-[10px]" style={{ color: 'var(--np-accent-2)' }}>
              <Shield size={10} />
              <span>Banlist conflict on {foldedBans!.frozenTargets.length} entr{(foldedBans?.frozenTargets.length ?? 0) === 1 ? 'y' : 'ies'} - frozen at last applied state until a later edition resolves it.</span>
            </div>
          )}
          {modNotice && (
            <div className="mt-1 text-[10px]" style={{ color: 'var(--np-muted)' }}>{modNotice}</div>
          )}
          {lastMentionHere && (
            <div className="mt-1 flex items-center gap-1 text-[10px]" style={{ color: 'var(--np-accent-2)' }}>
              <AtSign size={10} />
              <span className="truncate">
                {lastMentionHere.from.slice(0, 8)}…: {lastMentionHere.text ?? 'mentioned you'}
              </span>
            </div>
          )}
        </div>

        {/* Room settings panel (owner spec 2026-09-14): member roster with
            grant/revoke moderator, ban/lift, and role-fold state. Every
            affordance is individually permission-gated; the fold is the
            authority, the UI only mirrors what it can enforce. */}
        {selectedRoom && showSettings && (
          <RoomSettingsPanel
            roomId={selectedRoom.roomId}
            rosterHandles={[...roster.entries()].map(([author, e]) => ({ author, handle: e.handle }))}
            botAuthors={botAuthors}
            grants={roleGrants(selectedRoom.roomId)}
            mayManage={mayManageRoles(selectedRoom.roomId)}
            founder={roomFounder(selectedRoom.roomId)}
            selfAuthor={selfAuthor}
            onGrantRole={(pk, roleId) => { void grantRole(pk, roleId).then(() => setModNotice(`Granted ${roleId} to ${pk.slice(0, 8)}…`)).catch((e) => setModNotice(`grant failed: ${e.message}`)); }}
            onRevokeRole={(pk, roleId) => { void revokeRole(pk, roleId).then(() => setModNotice(`Removed ${roleId} from ${pk.slice(0, 8)}…`)).catch((e) => setModNotice(`revoke failed: ${e.message}`)); }}
            onKick={(pk) => { void handleKick(pk); }}
            onBan={(pk) => { void handleBan(pk); }}
            mayBan={mayBan}
            mayKick={mayKick}
            banned={new Set((foldedBans?.banned ?? new Map<string, never>()).keys())}
            memberIds={selectedRoomId ? memberClaims.get(selectedRoomId) : undefined}
            onLift={(pk) => { void handleLift(pk); }}
            onClose={() => setShowSettings(false)}
          />
        )}

        <div
          ref={scrollRef}
          className={`flex-1 px-3 py-3 ${embedded && !fullscreen ? '' : 'overflow-y-auto'}`}
          style={embedded && !fullscreen ? undefined : { maxHeight: '420px' }}
        >
          {messages.length === 0 ? (
            <p className="text-center text-xs italic" style={{ color: 'var(--np-muted)' }}>
              {selectedRoom
                ? (signer ? 'No messages yet. Say something.' : 'No messages yet.')
                : 'Join a room from a link, or create one.'}
            </p>
          ) : (
            <div className="space-y-3">
              {messages.map((msg) => (
                // Key by protocol identity (author, msg_id): msg_id alone can
                // collide across authors and React must not merge their rows.
                <div key={`${msg.author}:${msg.id}`} className="text-sm">
                  <div className="flex items-baseline gap-2">
                    <button
                      type="button"
                      onClick={(e) => setUserCard({ author: msg.author, anchor: { x: e.clientX, y: e.clientY } })}
                      className="cursor-pointer font-mono text-xs font-semibold hover:underline"
                      style={{ color: 'var(--np-accent-2)' }}
                      title="Member card - roles & moderation"
                    >
                      {msg.author.slice(0, 8)}…
                    </button>
                    {botAuthors.has(msg.author.toLowerCase()) && (
                      <span
                        className="rounded border px-1 text-[10px]"
                        style={{ borderColor: 'var(--np-accent-2)', color: 'var(--np-accent-2)' }}
                        title="Bot - joined via an agent link"
                      >
                        🤖 Bot
                      </span>
                    )}
                    {roleBadgeFor(msg.author) && (
                      <span
                        className="rounded border px-1 text-[10px] font-semibold"
                        style={{ borderColor: 'var(--np-accent-2)', color: 'var(--np-accent-2)' }}
                        title={roleBadgeFor(msg.author) === '?' ? 'Unknown role (catalog version not recognized - not enforced)' : `Role: ${roleBadgeFor(msg.author)}`}
                      >
                        {roleBadgeFor(msg.author)}
                      </span>
                    )}
                    {msg.status === 'pending' && (
                      <span className="text-[10px] italic" style={{ color: 'var(--np-muted)' }}>awaiting confirmation…</span>
                    )}
                    <Lock size={10} style={{ color: 'var(--np-muted)' }} />
                  </div>
                  <div className="mt-0.5 break-words font-serif">
                    {msg.retracted ? (
                      <span className="italic" style={{ color: 'var(--np-muted)' }}>message retracted</span>
                    ) : (
                      msg.text
                    )}
                  </div>
                  {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                    <div className="mt-1 flex gap-1">
                      {Object.entries(msg.reactions).map(([emoji, count]) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => void toggleReaction(msg.id, emoji)}
                          className="rounded border px-1 text-[10px] hover:bg-black/5"
                          style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
                        >
                          {emoji} {count}
                        </button>
                      ))}
                    </div>
                  )}
                  {!msg.retracted && (
                    <div className="relative mt-1 flex items-center gap-2 opacity-60 hover:opacity-100">
                      {REACTIONS.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => void toggleReaction(msg.id, emoji)}
                          className="text-[10px]"
                          title={emoji === '⚡' ? 'Zap sats (Cashu, mainnet)' : `React ${emoji}`}
                        >
                          {emoji}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setZapInfoMsg(zapInfoMsg === msg.id ? null : msg.id)}
                        className="rounded-full border p-0.5 hover:bg-black/5"
                        style={{ borderColor: 'var(--np-rule)', color: 'var(--np-muted)' }}
                        title="What does ⚡ do?"
                        aria-label="What does the lightning reaction do?"
                      >
                        <Info size={10} />
                      </button>
                      {zapInfoMsg === msg.id && (
                        <>
                          <button
                            type="button"
                            className="fixed inset-0 z-30 cursor-default"
                            aria-label="Close"
                            onClick={() => setZapInfoMsg(null)}
                          />
                          <div
                            className="absolute left-0 top-4 z-40 w-72 border p-2 text-[10px] leading-relaxed"
                            style={{ background: 'var(--np-paper)', borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
                          >
                            <b>⚡ zaps real sats</b> to this person's key (npub) over Cashu - mainnet only,
                            no test money. Sender pays from their own Cashu wallet; the sats are locked to the
                            recipient, so only they can claim them.
                            <br />
                            <br />
                            They do <b>not</b> need anything set up first: the token waits at the mint until they
                            sign in and redeem. If nobody claims it within <b>210 hours</b>, the zap is
                            <b>refunded automatically</b> to the sender - no action needed on either side.
                          </div>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => setReplyTarget(msg)}
                        className="text-[10px]"
                        style={{ color: 'var(--np-muted)' }}
                        title="Reply"
                      >
                        <Reply size={10} />
                      </button>
                      {selfAuthor && msg.author === selfAuthor && (
                        <button
                          type="button"
                          onClick={() => void retractMessage(msg.id)}
                          className="text-[10px]"
                          style={{ color: 'var(--np-muted)' }}
                          title="Retract message"
                        >
                          <RotateCcw size={10} />
                        </button>
                      )}
                      {canModerate(msg.author) && (
                        isAuthorBanned(msg.author) ? (
                          <button
                            type="button"
                            onClick={() => void handleLift(msg.author)}
                            className="text-[10px] underline"
                            style={{ color: 'var(--np-accent-2)' }}
                            title="Publish a vsk:4 lift (empty restatement removes the ban)"
                          >
                            Unban
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void handleBan(msg.author)}
                            className="text-[10px] underline"
                            style={{ color: 'var(--np-danger, #b3261e)' }}
                            title="Publish a vsk:4 banlist entry (deny-only removal)"
                          >
                            Ban
                          </button>
                        )
                      )}
                      {isAuthorBanned(msg.author) && (
                        <span
                          className="rounded border px-1 text-[10px] font-semibold"
                          style={{ borderColor: 'var(--np-danger, #b3261e)', color: 'var(--np-danger, #b3261e)' }}
                          title="This key is on the room's vsk:4 banlist (deny-only)"
                        >
                          banned
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {typing.authors.length > 0 && (
          <div className="px-3 py-1 text-[10px] italic" style={{ color: 'var(--np-muted)' }}>
            {typing.authors.length === 1
              ? `${roster.get(typing.authors[0])?.handle ?? typing.authors[0].slice(0, 8) + '…'} is typing…`
              : `${typing.authors.length} people are typing…`}
          </div>
        )}

        {error && (
          <div className="px-3 py-1 text-[10px]" style={{ color: 'var(--np-error, #b91c1c)' }}>
            {error}
          </div>
        )}

        {replyTarget && (
          <div className="flex items-center justify-between border-t px-3 py-1 text-[10px]" style={{ borderColor: 'var(--np-rule)', color: 'var(--np-muted)' }}>
            <span>Replying to {replyTarget.author.slice(0, 8)}…: {replyTarget.text.slice(0, 40)}{replyTarget.text.length > 40 ? '…' : ''}</span>
            <button type="button" onClick={() => setReplyTarget(null)} title="Cancel reply"><X size={10} /></button>
          </div>
        )}

        <form onSubmit={handleSend} className="border-t p-2" style={{ borderColor: 'var(--np-rule)' }}>
          {!signer && (
            <p className="px-1 pb-1 text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-muted)', fontFamily: 'var(--np-font-mono)' }}>
              {guestCanPost
                ? <>Posting as a guest in the landing room - messages vanish with it. <a href="#bao-signin" className="underline" style={{ color: 'var(--np-accent-2)' }}>Sign in</a> to keep your identity and unlock every room, wallet, court & campaigns.</>
                : <>You are reading the live room as a guest - <a href="#bao-signin" className="underline" style={{ color: 'var(--np-accent-2)' }}>sign in</a> to post and unlock wallet, court & campaigns.</>}
            </p>
          )}
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                notifyTyping();
              }}
              disabled={!selectedRoomId || isSending}
              readOnly={!signer && !guestCanPost}
              onClick={(e) => {
                // Guest affordance: tapping the locked composer jumps to the
                // sign-in panel (same page) - the room stays mounted behind it.
                if (!signer && !guestCanPost) {
                  e.preventDefault();
                  document.getElementById('bao-signin')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
              }}
              placeholder={!signer && !guestCanPost ? 'Sign in to post…' : selectedRoomId ? 'Type a message…' : 'Select a room first'}
              className="flex-1 rounded border bg-transparent px-3 py-2 text-sm"
              style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
            />
            <button
              type="submit"
              disabled={!selectedRoomId || isSending || !input.trim()}
              className="flex items-center gap-1 rounded border px-3 py-2 text-sm disabled:opacity-50"
              style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
            >
              <Send size={14} />
              <span className="hidden sm:inline">Send</span>
            </button>
          </div>
        </form>
      </div>
      {userCard && selectedRoomId && (
        <UserCard
          author={userCard.author}
          anchor={userCard.anchor}
          roleIds={roleGrants(selectedRoomId).get(userCard.author) ?? []}
          isBot={botAuthors.has(userCard.author.toLowerCase())}
          isFounder={roomFounder(selectedRoomId) === userCard.author}
          isBanned={isAuthorBanned(userCard.author)}
          mayBan={canModerate(userCard.author)}
          mayKick={!!selectedRoomId && mayKick(selectedRoomId, userCard.author)}
          mayManage={mayManageRoles(selectedRoomId)}
          onKick={() => { void handleKick(userCard.author).then(closeUserCard); }}
          onBan={() => { void handleBan(userCard.author).then(closeUserCard); }}
          onLift={() => { void handleLift(userCard.author).then(closeUserCard); }}
          onGrantRole={(roleId) => { void grantRole(userCard.author, roleId).then(() => setModNotice(`Granted ${roleId} to ${userCard.author.slice(0, 8)}…`)).catch((e) => setModNotice(`grant failed: ${e.message}`)); }}
          onRevokeRole={(roleId) => { void revokeRole(userCard.author, roleId).then(() => setModNotice(`Removed ${roleId} from ${userCard.author.slice(0, 8)}…`)).catch((e) => setModNotice(`revoke failed: ${e.message}`)); }}
          onClose={closeUserCard}
        />
      )}
    </div>
  );
}

/**
 * RoomSettingsPanel - members & moderation (owner spec 2026-09-14; expanded
 * to Discord parity 2026-09-15).
 *
 * Shows every KNOWN speaker in the room (roster handles + key-only authors)
 * with their current roles. Per-member actions, each individually gated:
 *   - Assign/remove ANY catalog role (moderator / curator / greeter) via
 *     per-role chips - founder or pin-role holder; publishes a full vsk:1
 *     restatement (omission is deletion, spec §2).
 *   - Kick (1h NIP-40-expiring ban; founder or `kick` perm).
 *   - Ban / Lift ban (founder or `ban` perm; vsk:4 deny-only edition).
 * The creator (founder) is the top role: marked 👑 and never revocable from
 * the panel. Multiple moderators are supported by design (full-set
 * restatement carries all members every time).
 */
function RoomSettingsPanel({
  roomId,
  rosterHandles,
  botAuthors,
  grants,
  mayManage,
  founder,
  selfAuthor,
  onGrantRole,
  onRevokeRole,
  onKick,
  onBan,
  mayBan,
  mayKick,
  banned,
  memberIds,
  onLift,
  onClose,
}: {
  roomId: string;
  rosterHandles: Array<{ author: string; handle: string }>;
  botAuthors: Set<string>;
  grants: Map<string, string[]>;
  mayManage: boolean;
  founder: string | null;
  selfAuthor: string | null;
  onGrantRole: (pubkey: string, roleId: string) => void;
  onRevokeRole: (pubkey: string, roleId: string) => void;
  onKick: (pubkey: string) => void;
  onBan: (pubkey: string) => void;
  mayBan: (roomId: string, pubkey: string) => boolean;
  mayKick: (roomId: string, pubkey: string) => boolean;
  banned: Set<string>;
  /** Verified durable member claims for this room (burner → member pubkey),
   *  key-control only - never a human/personhood attestation. */
  memberIds?: Map<string, string>;
  onLift: (pubkey: string) => void;
  onClose: () => void;
}): React.ReactElement {
  const [manualKey, setManualKey] = React.useState('');
  const HEX64 = /^[0-9a-f]{64}$/;
  const ROLES: ReadonlyArray<{ id: string; hint: string }> = [
    { id: 'moderator', hint: 'pin, kick, ban, delete, grant roles' },
    { id: 'curator', hint: 'pin, delete messages' },
    { id: 'greeter', hint: 'welcomes new members' },
  ];

  // Union of everyone visible: roster authors + anyone holding a role.
  const seen = new Map<string, string>(); // pubkey → handle ('' when key-only)
  for (const { author, handle } of rosterHandles) seen.set(author, handle);
  for (const pk of grants.keys()) if (!seen.has(pk)) seen.set(pk, '');
  const members = [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));

  return (
    <div className="border-b px-3 py-2" style={{ borderColor: 'var(--np-rule)', background: 'var(--np-paper)' }}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--np-accent)', fontFamily: 'var(--np-font-mono)' }}>
          Room settings - members & roles
        </span>
        <button type="button" onClick={onClose} aria-label="Close room settings" className="text-[10px]" style={{ color: 'var(--np-muted)' }}>
          <X size={12} />
        </button>
      </div>

      {!mayManage && (
        <p className="mb-2 text-[10px]" style={{ color: 'var(--np-muted)' }}>
          You can view members. Role changes require the room creator or a member holding pin-role.
        </p>
      )}

      <div className="max-h-56 space-y-1 overflow-y-auto">
        {members.length === 0 && (
          <p className="text-[10px] italic" style={{ color: 'var(--np-muted)' }}>No members seen yet.</p>
        )}
        {members.map(([pk, handle]) => {
          const isFounder = founder !== null && pk.toLowerCase() === founder.toLowerCase();
          const rolesList = grants.get(pk) ?? [];
          const member = memberIds?.get(pk.toLowerCase());
          const isBanned = banned.has(pk.toLowerCase()) || (member ? banned.has(member) : false);
          const isSelf = selfAuthor !== null && pk.toLowerCase() === selfAuthor.toLowerCase();
          return (
            <div key={pk} className="rounded border px-2 py-1" style={{ borderColor: 'var(--np-rule)' }}>
              <div className="flex items-center gap-2 text-[11px]">
                <span className="font-mono" style={{ color: 'var(--np-accent-2)' }}>{pk.slice(0, 8)}…</span>
                {handle && <span style={{ color: 'var(--np-muted)' }}>{handle}</span>}
                {member && (
                  <span
                    className="rounded border px-1 text-[10px]"
                    title="Durable member identity (survives rejoins; key control only)"
                    style={{ borderColor: 'var(--np-rule)', color: 'var(--np-muted)' }}
                  >
                    id:{member.slice(0, 8)}…
                  </span>
                )}
                {isFounder && (
                  <span className="rounded border px-1 text-[10px]" style={{ borderColor: 'var(--np-accent)', color: 'var(--np-accent)' }} title="Room creator - top role">
                    👑 creator
                  </span>
                )}
                {!isFounder && rolesList.map((r) => (
                  <span key={r} className="rounded border px-1 text-[10px]" style={{ borderColor: 'var(--np-accent-2)', color: 'var(--np-accent-2)' }}>{r}</span>
                ))}
                {botAuthors.has(pk.toLowerCase()) && (
                  <span className="rounded border px-1 text-[10px]" style={{ borderColor: 'var(--np-rule)', color: 'var(--np-muted)' }}>🤖 Bot</span>
                )}
                {isSelf && (
                  <span className="rounded border px-1 text-[10px]" style={{ borderColor: 'var(--np-rule)', color: 'var(--np-muted)' }}>you</span>
                )}
                {isBanned && (
                  <span className="rounded border px-1 text-[10px] font-semibold" style={{ borderColor: 'var(--np-danger, #b3261e)', color: 'var(--np-danger, #b3261e)' }}>banned</span>
                )}
                <span className="ml-auto flex gap-1">
                  {/* Kick - founder or `kick` perm; 1h expiring deny. */}
                  {!isBanned && !isSelf && mayKick(roomId, pk) && (
                    <button type="button" onClick={() => onKick(pk)} title="Kick (deny lapses after 1 hour)" className="rounded border px-1" style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}>
                      <LogOut size={10} />
                    </button>
                  )}
                  {/* Ban / lift - gated per-target by mayBan (founder or ban perm). */}
                  {!isBanned && mayBan(roomId, pk) && (
                    <button type="button" onClick={() => onBan(pk)} title="Ban from room" className="rounded border px-1" style={{ borderColor: 'var(--np-danger, #b3261e)', color: 'var(--np-danger, #b3261e)' }}>
                      <Ban size={10} />
                    </button>
                  )}
                  {isBanned && mayBan(roomId, pk) && (
                    <button type="button" onClick={() => onLift(pk)} title="Lift ban" className="rounded border px-1" style={{ borderColor: 'var(--np-rule)', color: 'var(--np-muted)' }}>
                      <RotateCcw size={10} />
                    </button>
                  )}
                </span>
              </div>
              {/* Role assignment (Discord-style chips): add any catalog role
                  not yet held; × removes a held role. Gated by mayManage;
                  founder row shows no assignment UI (top role, never revoked). */}
              {mayManage && !isFounder && (
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {ROLES.filter((r) => !rolesList.includes(r.id)).map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => onGrantRole(pk, r.id)}
                      title={`Grant ${r.id} (${r.hint})`}
                      className="rounded border px-1 text-[10px] hover:bg-black/5"
                      style={{ borderColor: 'var(--np-rule)', color: 'var(--np-muted)' }}
                    >
                      + {r.id}
                    </button>
                  ))}
                  {rolesList.map((r) => (
                    <button
                      key={`revoke-${r}`}
                      type="button"
                      onClick={() => onRevokeRole(pk, r)}
                      title={`Remove ${r}`}
                      className="rounded border px-1 text-[10px] hover:bg-black/5"
                      style={{ borderColor: 'var(--np-accent-2)', color: 'var(--np-accent-2)' }}
                    >
                      {r} ×
                    </button>
                  ))}
                  {rolesList.length === 0 && ROLES.every((r) => !rolesList.includes(r.id)) && (
                    <span className="text-[10px] italic" style={{ color: 'var(--np-muted)' }}>plain member</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {mayManage && (
        <form
          className="mt-2 flex gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            const pk = manualKey.trim().toLowerCase();
            if (!HEX64.test(pk)) return;
            onGrantRole(pk, 'moderator');
            setManualKey('');
          }}
        >
          <input
            value={manualKey}
            onChange={(e) => setManualKey(e.target.value)}
            placeholder="add by pubkey (64-hex) as moderator"
            className="flex-1 rounded border bg-transparent px-2 py-1 text-[10px] font-mono"
            style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
          />
          <button type="submit" className="rounded border px-2 text-[10px]" style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }} title="Grant moderator">
            <UserPlus size={10} />
          </button>
        </form>
      )}
      {selfAuthor && founder === selfAuthor && (
        <p className="mt-1 text-[10px]" style={{ color: 'var(--np-muted)' }}>
          You are the room creator - top role. Moderators can pin, kick, ban, delete and grant roles; curators pin and delete; greeters welcome.
        </p>
      )}
    </div>
  );
}

/**
 * UserCard - the Discord-style member popover: click an author chip in the
 * timeline to see their key/roles and take any action THIS session's key is
 * allowed to publish. Every button is gated by the same fold-backed gates
 * the settings panel uses; the hook re-checks on the actual call.
 */
function UserCard({
  author,
  anchor,
  roleIds,
  isBot,
  isFounder,
  isBanned,
  mayBan,
  mayKick,
  mayManage,
  onKick,
  onBan,
  onLift,
  onGrantRole,
  onRevokeRole,
  onClose,
}: {
  author: string;
  anchor: { x: number; y: number };
  roleIds: string[];
  isBot: boolean;
  isFounder: boolean;
  isBanned: boolean;
  mayBan: boolean;
  mayKick: boolean;
  mayManage: boolean;
  onKick: () => void;
  onBan: () => void;
  onLift: () => void;
  onGrantRole: (roleId: string) => void;
  onRevokeRole: (roleId: string) => void;
  onClose: () => void;
}): React.ReactElement {
  const ROLES: ReadonlyArray<string> = ['moderator', 'curator', 'greeter'];
  // Keep the card on-screen: clamp against the viewport with margins.
  const left = Math.min(Math.max(8, anchor.x - 130), (typeof window !== 'undefined' ? window.innerWidth : 1024) - 290);
  const top = Math.min(Math.max(8, anchor.y + 14), (typeof window !== 'undefined' ? window.innerHeight : 768) - 240);
  return (
    <>
      {/* Click-away scrim - keeps focus semantics simple. */}
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden="true" />
      <div
        className="fixed z-50 w-72 rounded border p-3 text-[11px] shadow-lg"
        style={{ left, top, borderColor: 'var(--np-rule)', background: 'var(--np-paper)', color: 'var(--np-ink)' }}
        role="dialog"
        aria-label="Member card"
      >
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs font-semibold" style={{ color: 'var(--np-accent-2)' }}>{author.slice(0, 16)}…</span>
          <button type="button" onClick={onClose} aria-label="Close member card" className="text-[10px]" style={{ color: 'var(--np-muted)' }}>
            <X size={12} />
          </button>
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {isFounder && <span className="rounded border px-1 text-[10px]" style={{ borderColor: 'var(--np-accent)', color: 'var(--np-accent)' }}>👑 creator</span>}
          {isBot && <span className="rounded border px-1 text-[10px]" style={{ borderColor: 'var(--np-rule)', color: 'var(--np-muted)' }}>🤖 Bot</span>}
          {!isFounder && roleIds.map((r) => (
            <span key={r} className="rounded border px-1 text-[10px]" style={{ borderColor: 'var(--np-accent-2)', color: 'var(--np-accent-2)' }}>{r}</span>
          ))}
          {isBanned && <span className="rounded border px-1 text-[10px] font-semibold" style={{ borderColor: 'var(--np-danger, #b3261e)', color: 'var(--np-danger, #b3261e)' }}>banned</span>}
        </div>
        {(mayKick || mayBan || mayManage) && (
          <div className="mt-2 flex flex-wrap gap-1">
            {!isBanned && mayKick && <button type="button" onClick={onKick} className="rounded border px-2 py-0.5 text-[10px]" style={{ borderColor: 'var(--np-rule)' }}>Kick (1h)</button>}
            {!isBanned && mayBan && <button type="button" onClick={onBan} className="rounded border px-2 py-0.5 text-[10px]" style={{ borderColor: 'var(--np-danger, #b3261e)', color: 'var(--np-danger, #b3261e)' }}>Ban</button>}
            {isBanned && mayBan && <button type="button" onClick={onLift} className="rounded border px-2 py-0.5 text-[10px]" style={{ borderColor: 'var(--np-rule)' }}>Lift ban</button>}
          </div>
        )}
        {mayManage && !isFounder && (
          <div className="mt-2">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>Roles</div>
            <div className="flex flex-wrap gap-1">
              {ROLES.filter((r) => !roleIds.includes(r)).map((r) => (
                <button key={r} type="button" onClick={() => onGrantRole(r)} className="rounded border px-1 text-[10px] hover:bg-black/5" style={{ borderColor: 'var(--np-rule)', color: 'var(--np-muted)' }}>+ {r}</button>
              ))}
              {roleIds.map((r) => (
                <button key={`rm-${r}`} type="button" onClick={() => onRevokeRole(r)} className="rounded border px-1 text-[10px] hover:bg-black/5" style={{ borderColor: 'var(--np-accent-2)', color: 'var(--np-accent-2)' }}>{r} ×</button>
              ))}
            </div>
          </div>
        )}
        {!mayKick && !mayBan && !mayManage && (
          <p className="mt-2 text-[10px] italic" style={{ color: 'var(--np-muted)' }}>No moderation actions available for your role in this room.</p>
        )}
      </div>
    </>
  );
}
