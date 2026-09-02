/**
 * BaoScrollChat — the bao_chat_protocol v1 encrypted scroll client, reusable.
 *
 * Extracted from BaoCommunitiesPage so the SAME encrypted chat (burner-key
 * joins, hash-chained ciphertext scroll, presence roster, @mentions,
 * receipts, identity modes) can be mounted from two entry points:
 *
 *   1. 2140 Social page   → multi-room mode (full directory sidebar)
 *   2. Fal Live TV panel  → single-room mode (lockedRoom, no sidebar)
 *
 * PRIVACY CONTRACT: every message is an E2E-encrypted envelope posted ONLY
 * to the room's single relay (wss://2140.social/ws). There is no kind-1
 * publish path here — nothing ever leaves the encrypted scroll.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Copy, ExternalLink, Hash, IdCard, KeyRound, Loader2, PanelRightClose, PanelRightOpen, Plus, Radio, Reply, ShieldCheck, Sparkles, X } from "lucide-react";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import {
  WebRelayConn,
  RoomSession,
  joinRoom,
  parseJoinLink,
  absorbLink,
  serializeJoinedRoom,
  restoreJoinedRoom,
  dedupKey,
  getPublicKey,
  buildPresence,
  foldRoster,
  resolveMentions,
  segmentMentions,
} from "@/lib/baosocial/browser.js";
import { npubEncode, nsecEncode } from "nostr-tools/nip19";
import type { Envelope, JoinedRoom, RosterEntry } from "@/lib/baosocial/browser.js";
import { BAO_SOCIAL_DIRECTORY, type BaoSocialRoomInfo } from "@/lib/baosocial/rooms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useNip05Verify } from "@/hooks/useNip05Verify";
import { cn } from "@/lib/utils";

// ── Persistence (demo parity: the app decides its own custody policy) ───────

// ── Persistence (demo parity: the app decides its own custody policy) ───────

const SESSIONS_KEY = "2140:bao-social-sessions-v1";
const NAME_KEY = "2140:bao-social-name-v1";
const NPUB_KEY = "2140:bao-social-npub-v1";
const ADDED_KEY = "2140:bao-social-rooms-v1";

type SerializedSession = ReturnType<typeof serializeJoinedRoom>;

function loadStored(): Record<string, SerializedSession> {
  try {
    return JSON.parse(localStorage.getItem(SESSIONS_KEY) ?? "{}") as Record<string, SerializedSession>;
  } catch {
    return {};
  }
}

interface AddedRoom {
  roomId: string;
  joinLink: string;
  name?: string;
}

function loadAddedRooms(): AddedRoom[] {
  try {
    return JSON.parse(localStorage.getItem(ADDED_KEY) ?? "[]") as AddedRoom[];
  } catch {
    return [];
  }
}

/** Validate npub1… or 64-hex → npub. null when empty/invalid. */
function validateNpub(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (/^npub1[0-9a-z]{58,62}$/.test(v)) return v;
  if (/^[0-9a-f]{64}$/.test(v)) {
    try {
      return npubEncode(v);
    } catch {
      return null;
    }
  }
  return null;
}

// ── Payload conventions (application-level, inside the encrypted envelope) ──

interface ReplyRef {
  author: string;
  msg_id: string;
}

interface ChatPayload {
  text?: string;
  reply?: ReplyRef;
  /** App-level identity convention riding INSIDE the encrypted envelope.
   *  Exactly one field is set in practice, depending on the sender's identity
   *  mode: `npub` (anon mode, manual npub), `nip05` (verified identifier only),
   *  or `pseudonym` (stable hashed pseudonym — NOT an npub; do not nip19-decode). */
  identity?: { npub?: string; nip05?: string; pseudonym?: string };
  to?: string[];
  presence?: { name?: string };
  epochAdvance?: { epoch?: number };
}

function replyOf(env: Envelope): ReplyRef | null {
  const p = env.payload as ChatPayload | null;
  if (!p || typeof p.reply !== "object" || p.reply === null) return null;
  const r = p.reply as unknown as Record<string, unknown>;
  if (typeof r.author !== "string" || !/^[0-9a-f]{64}$/.test(r.author)) return null;
  if (typeof r.msg_id !== "string" || !/^[0-9a-f]{32}$/.test(r.msg_id)) return null;
  return { author: r.author, msg_id: r.msg_id };
}

function isPresenceFrame(env: Envelope): boolean {
  const p = env.payload as ChatPayload | null;
  return !!p?.presence?.name && typeof p.text !== "string";
}

function isEpochFrame(env: Envelope): boolean {
  const p = env.payload as ChatPayload | null;
  return !!p?.epochAdvance && typeof p.text !== "string";
}

function previewText(env: Envelope): string {
  const p = env.payload as ChatPayload | null;
  const s = p && typeof p.text === "string" ? p.text : "";
  return s.length > 200 ? `${s.slice(0, 200)}…` : s;
}

// ── Auth gate + identity module (2140 Social access policy) ─────────────────
//
// Mirrors production 2140.social: the chat itself stays isolated/anonymous,
// but ENTERING is for authed users only. After login, EVERY entry to the
// chat shows the identity module first — the user picks how to appear:
//   - "nip05"  : ride the account's verified NIP-05 identifier inside the
//                encrypted envelope (never on the wire)
//   - "hashed" : a stable pseudonym derived from the account pubkey via a
//                salted sha256 — linkable across messages, not to the key
//   - "anon"   : pure burner (protocol default)

// Identity preferences are scoped PER ACCOUNT (the app supports multiple
// stored logins): `2140:bao-social-identity-mode-v1:<pubkey>` and
// `2140:bao-social-npub-v1:<pubkey>`. The legacy unscoped keys are read once
// for migration and then retired, so a second account can never inherit the
// first one's identity preferences.
const IDENTITY_MODE_KEY = "2140:bao-social-identity-mode-v1";
type IdentityMode = "nip05" | "hashed" | "anon";

function isIdentityMode(v: string | null): v is IdentityMode {
  return v === "nip05" || v === "hashed" || v === "anon";
}

/** Account-scoped identity mode; falls back to the legacy browser-wide key. */
function loadIdentityModeFor(pubkey: string | undefined): IdentityMode {
  try {
    if (pubkey) {
      const scoped = localStorage.getItem(`${IDENTITY_MODE_KEY}:${pubkey}`);
      if (isIdentityMode(scoped)) return scoped;
    }
    const legacy = localStorage.getItem(IDENTITY_MODE_KEY);
    if (isIdentityMode(legacy)) return legacy;
  } catch {
    /* best-effort */
  }
  return "hashed";
}

/** Account-scoped manual npub; falls back to the legacy browser-wide key. */
function loadNpubFor(pubkey: string | undefined): string {
  try {
    if (pubkey) {
      const scoped = localStorage.getItem(`${NPUB_KEY}:${pubkey}`);
      if (scoped !== null) return scoped;
    }
    return localStorage.getItem(NPUB_KEY) ?? "";
  } catch {
    /* best-effort */
  }
  return "";
}

/** Stable pseudonym from the account pubkey via a salted sha256 — linkable
 *  across messages. NOTE: the "salt" is a public constant and the input is the
 *  PUBLIC key, so this is NOT cryptographically unlinkable — anyone who learns
 *  the pubkey (profile event, NIP-05 resolution, one exposed npub) can recompute
 *  it offline and link the whole pseudonymous history. It only avoids putting
 *  the raw key on the envelope. */
function hashedIdentityNpub(pubkey: string): string {
  const digest = sha256(new TextEncoder().encode(`2140:bao-social-identity:${pubkey}`));
  return `anon-${bytesToHex(digest).slice(0, 8)}`;
}

// ── Imperative per-room session state (mirrors the demo's RoomState) ───────

type Receipt = "pending" | "scrolled" | "dropped";

interface RoomRow {
  key: string;
  env: Envelope;
  mine: boolean;
  receipt: Receipt;
}

interface RoomRuntime {
  info: BaoSocialRoomInfo;
  conn: WebRelayConn | null;
  session: RoomSession | null;
  myAuthor: string;
  joinPhase: "idle" | "joining" | "ready" | "error";
  joinError?: string;
  rows: RoomRow[];
  known: Map<string, Envelope>;
  outbox: Map<string, { env: Envelope; lastSentMs: number; attempts: number }>;
  roster: Map<string, RosterEntry>;
  presencePosted: boolean;
  unsubscribe: (() => void) | null;
  refreshTimer: ReturnType<typeof setInterval> | null;
  relayUrl: string;
}

function newRuntime(info: BaoSocialRoomInfo, relayUrl: string): RoomRuntime {
  return {
    info,
    conn: null,
    session: null,
    myAuthor: "",
    joinPhase: "idle",
    rows: [],
    known: new Map(),
    outbox: new Map(),
    roster: new Map(),
    presencePosted: false,
    unsubscribe: null,
    refreshTimer: null,
    relayUrl,
  };
}

interface BaoScrollChatProps {
  /**
   * Single-room mode: lock the client to this room and hide the room list.
   * Used by the Fal Live TV panel to expose the Trollbox FAL TV room. When
   * omitted, the full directory sidebar (multi-room) is shown.
   */
  lockedRoom?: BaoSocialRoomInfo;
  /**
   * Embedded mode: the parent (e.g. the Fal Live TV panel) provides the
   * height, so the chat must not apply the mobile full-viewport class
   * (max-lg:livestream-height) that standalone pages need.
   */
  embedded?: boolean;
}

/** The chat client itself — mounted only for authed users. */
export function BaoScrollChat({ lockedRoom, embedded }: BaoScrollChatProps) {
  const { user, metadata } = useCurrentUser();
  // Identity preferences are scoped to this account (see loadIdentityModeFor).
  const accountPubkey = user?.pubkey;
  const nip05 = typeof metadata?.nip05 === "string" && metadata.nip05.trim() !== "" ? metadata.nip05 : undefined;
  const { data: nip05Verified } = useNip05Verify(nip05, user?.pubkey);

  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const runtimes = useRef(new Map<string, RoomRuntime>());
  const stored = useRef<Record<string, SerializedSession>>(loadStored());
  const currentId = useRef<string | null>(null);

  const [roomInfos, setRoomInfos] = useState<BaoSocialRoomInfo[]>(() => {
    const added = loadAddedRooms()
      .map((added) => {
        try {
          const parts = parseJoinLink(added.joinLink);
          return {
            roomId: parts.roomId,
            name: added.name ?? `room-${parts.roomId.slice(0, 6)}`,
            // Unlisted room (ghost): reachable only via its invite link — the
            // link IS the credential; never advertised in any directory.
            topic: "unlisted · invite link",
            joinLink: added.joinLink,
            agentLink: "",
            welcomerPub: parts.welcomerPub ?? "",
            routingId: parts.routingId ?? "",
            flushDeadlineMs: 4000,
          } satisfies BaoSocialRoomInfo;
        } catch {
          return null;
        }
      })
      .filter((info): info is BaoSocialRoomInfo => info !== null);
    return [...BAO_SOCIAL_DIRECTORY.rooms, ...added];
  });

  const [logLines, setLogLines] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [replyDraft, setReplyDraft] = useState<{ author: string; msgId: string; preview: string } | null>(null);
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? "");
  const [npubInput, setNpubInput] = useState(() => {
    // The manual npub is anon-mode-scoped: only seed the persisted value when
    // the persisted mode is actually "anon", so a previously typed npub can
    // never silently re-attach in hashed/nip05 mode (privacy).
    if (loadIdentityModeFor(accountPubkey) !== "anon") return "";
    return loadNpubFor(accountPubkey);
  });
  const [joinLinkInput, setJoinLinkInput] = useState("");
  // A join link handed over from elsewhere in the app (e.g. the ₿AO join chip
  // rendered inside notes) lands here via router state and pre-fills the
  // paste box — joining stays an explicit human action.
  const location = useLocation();
  const navigate = useNavigate();
  const handedLink = (location.state as { joinLink?: string } | null)?.joinLink;
  useEffect(() => {
    if (handedLink) {
      setJoinLinkInput(handedLink);
      // Clear the state so a refresh / back-nav doesn't re-fill the box.
      window.history.replaceState({}, "");
    }
  }, [handedLink]);
  const [showIdentity, setShowIdentity] = useState(false);
  const [identityMode, setIdentityMode] = useState<IdentityMode>(() => loadIdentityModeFor(accountPubkey));
  const [roomsCollapsed, setRoomsCollapsed] = useState(false);

  // ── Identity module (shown on EVERY entry, 2140.social parity) ────────────
  // Default per session: the hashed pseudonym. The npubInput used on the wire
  // is DERIVED from the mode — manual npub entry is folded into the module.

  // One-time per-account migration: copy the legacy browser-wide identity
  // preferences into this account's scope, then retire the unscoped keys.
  useEffect(() => {
    if (!accountPubkey) return;
    try {
      const modeKey = `${IDENTITY_MODE_KEY}:${accountPubkey}`;
      const npubKey = `${NPUB_KEY}:${accountPubkey}`;
      if (localStorage.getItem(modeKey) === null) {
        const legacy = localStorage.getItem(IDENTITY_MODE_KEY);
        if (legacy !== null) localStorage.setItem(modeKey, legacy);
      }
      if (localStorage.getItem(npubKey) === null) {
        const legacyNpub = localStorage.getItem(NPUB_KEY);
        if (legacyNpub !== null) localStorage.setItem(npubKey, legacyNpub);
      }
      localStorage.removeItem(IDENTITY_MODE_KEY);
      localStorage.removeItem(NPUB_KEY);
    } catch {
      /* best-effort */
    }
  }, [accountPubkey]);

  useEffect(() => {
    try {
      const modeKey = accountPubkey ? `${IDENTITY_MODE_KEY}:${accountPubkey}` : IDENTITY_MODE_KEY;
      localStorage.setItem(modeKey, identityMode);
    } catch {
      /* best-effort */
    }
    // Leaving anon mode must clear BOTH the state and the persisted value:
    // otherwise a previously typed npub keeps riding the envelope in
    // hashed/nip05 mode, and resurrects from localStorage on the next mount
    // even though the user saw the field emptied.
    if (identityMode !== "anon") {
      setNpubInput("");
      try {
        const npubKey = accountPubkey ? `${NPUB_KEY}:${accountPubkey}` : NPUB_KEY;
        localStorage.removeItem(npubKey);
      } catch {
        /* best-effort */
      }
    }
  }, [identityMode, accountPubkey]);

  /** What actually rides the envelope for the current mode. `undefined` =
   *  anonymous — nothing is attached. nip05 mode only attaches a VERIFIED
   *  identifier (never while verification is pending/failed). */
  const effectiveIdentity = useMemo<ChatPayload["identity"]>(() => {
    if (identityMode === "hashed" && user) return { pseudonym: hashedIdentityNpub(user.pubkey) };
    if (identityMode === "nip05") return nip05 && nip05Verified ? { nip05 } : undefined;
    const npub = validateNpub(npubInput); // anon: whatever the user typed (usually empty)
    return npub ? { npub } : undefined;
  }, [identityMode, user, nip05, nip05Verified, npubInput]);

  /** Short printable form of the effective identity (npub / @nip05 / pseudonym). */
  const effectiveIdentityLabel = useMemo(() => {
    if (!effectiveIdentity) return undefined;
    return effectiveIdentity.nip05 ?? effectiveIdentity.npub ?? effectiveIdentity.pseudonym;
  }, [effectiveIdentity]);

  const identityLabel = useMemo(() => {
    if (identityMode === "nip05") {
      return nip05 ? (nip05Verified ? `@${nip05}` : "NIP-05 (unverified)") : "no NIP-05 on profile";
    }
    if (identityMode === "hashed") return effectiveIdentityLabel ?? "hashed anon";
    return effectiveIdentityLabel ? "custom npub" : "anonymous";
  }, [identityMode, nip05, nip05Verified, effectiveIdentityLabel]);

  const log = useCallback((msg: string) => {
    setLogLines((lines) => [...lines.slice(-80), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  // ── Scroll read: backfill, receipts, retries, roster fold ────────────────

  const refreshScroll = useCallback(async (roomId: string) => {
    const r = runtimes.current.get(roomId);
    if (!r?.session) return;
    try {
      const result = await r.session.read();
      // Re-serialize after possible epoch ratchet so reloads stay members.
      const serialized = serializeJoinedRoom(r.session.joined);
      if (JSON.stringify(serialized) !== JSON.stringify(stored.current[roomId])) {
        stored.current[roomId] = serialized;
        try {
          localStorage.setItem(SESSIONS_KEY, JSON.stringify(stored.current));
        } catch {
          /* best-effort */
        }
      }
      const scrolled = new Set(result.messages.map((m) => dedupKey(m.envelope)));
      for (const m of result.messages) {
        const key = dedupKey(m.envelope);
        if (isPresenceFrame(m.envelope) || isEpochFrame(m.envelope)) continue;
        const existing = r.rows.find((row) => row.key === key);
        if (existing) {
          if (existing.receipt !== "scrolled") existing.receipt = "scrolled";
        } else {
          r.rows.push({ key, env: m.envelope, mine: m.envelope.author === r.myAuthor, receipt: "scrolled" });
        }
        r.known.set(key, m.envelope);
        r.outbox.delete(key);
      }
      // Retry-until-scrolled (§3): republish unconfirmed sends, cap 8.
      const timeoutMs = 3 * r.info.flushDeadlineMs;
      for (const [key, item] of r.outbox) {
        if (scrolled.has(key)) continue;
        const age = Date.now() - item.lastSentMs;
        const row = r.rows.find((entry) => entry.key === key);
        if (item.attempts >= 8) {
          if (row) row.receipt = "dropped";
          r.outbox.delete(key);
          continue;
        }
        if (age >= timeoutMs) {
          item.attempts++;
          item.lastSentMs = Date.now();
          await r.session.republish(item.env);
          log(`#${r.info.name}: republishing unconfirmed message (attempt ${item.attempts})`);
        }
      }
      // Fold roster + repaint bylines.
      r.roster = foldRoster(result.messages);
      if (result.chainWarnings.length) log(`⚠ chain: ${result.chainWarnings.join("; ")}`);
      rerender();
    } catch (err) {
      log(`scroll read error: ${(err as Error).message}`);
    }
  }, [log]);

  // ── Presence: claim the in-room @handle (encrypted, never the wire) ──────

  const postPresence = useCallback(async (roomId: string) => {
    const r = runtimes.current.get(roomId);
    const trimmed = name.trim();
    if (!r?.session || !trimmed || r.presencePosted) return;
    r.presencePosted = true;
    try {
      await r.session.post(buildPresence(trimmed));
      void refreshScroll(roomId);
    } catch {
      r.presencePosted = false;
    }
  }, [name, refreshScroll]);

  // ── Join (restore-first, then burner dance) ──────────────────────────────

  const ensureJoined = useCallback(async (roomId: string) => {
    const r = runtimes.current.get(roomId);
    if (!r || r.session || r.joinPhase === "joining") return;
    r.joinPhase = "joining";
    rerender();
    try {
      if (stored.current[roomId]) {
        r.conn = r.conn ?? new WebRelayConn(r.relayUrl);
        r.session = new RoomSession(r.conn, restoreJoinedRoom(stored.current[roomId]));
        log(`#${r.info.name}: rejoined from local membership`);
      } else {
        const t0 = Date.now();
        log(`#${r.info.name}: burner join…`);
        // Join runs on a throwaway connection, closed immediately after —
        // the session gets a fresh one (spec §6, unlinkability). REL-01: the
        // join connection MUST close even on failure (timeout/wrap mismatch),
        // or a retry loop leaks one socket per attempt — hence try/finally.
        const joinConn = new WebRelayConn(r.relayUrl);
        let joined: JoinedRoom;
        try {
          joined = await joinRoom(
            joinConn,
            r.info.joinLink,
            { welcomerPub: r.info.welcomerPub, routingId: r.info.routingId },
            { joinTimeoutMs: 25_000 },
          );
        } finally {
          joinConn.close();
        }
        r.conn = r.conn ?? new WebRelayConn(r.relayUrl);
        r.session = new RoomSession(r.conn, joined);
        stored.current[roomId] = serializeJoinedRoom(joined);
        try {
          localStorage.setItem(SESSIONS_KEY, JSON.stringify(stored.current));
        } catch {
          /* best-effort */
        }
        log(`#${r.info.name}: wrap received, burner discarded — joined in ${Date.now() - t0}ms`);
      }
      r.myAuthor = getPublicKey(r.session.joined.authorSecretKey);
      r.unsubscribe = r.session.subscribeLive((env: Envelope) => {
        if (!isPresenceFrame(env) && !isEpochFrame(env)) {
          const key = dedupKey(env);
          if (!r.rows.some((row) => row.key === key)) {
            r.rows.push({ key, env, mine: env.author === r.myAuthor, receipt: "pending" });
            r.known.set(key, env);
          }
        }
        void refreshScroll(roomId);
      });
      r.refreshTimer = setInterval(() => void refreshScroll(roomId), Math.max(1500, r.info.flushDeadlineMs / 2));
      r.joinPhase = "ready";
    } catch (err) {
      r.joinPhase = "error";
      r.joinError = (err as Error).message;
      log(`#${r.info.name}: join failed: ${(err as Error).message}`);
    }
    rerender();
  }, [log, refreshScroll]);

  // ── Room selection ───────────────────────────────────────────────────────

  const selectRoom = useCallback(async (roomId: string) => {
    const r = runtimes.current.get(roomId);
    if (!r) return;
    currentId.current = roomId;
    setReplyDraft(null);
    setDraft("");
    rerender();
    await ensureJoined(roomId);
    if (r.joinPhase === "ready") {
      void postPresence(roomId);
      await refreshScroll(roomId);
    }
  }, [ensureJoined, postPresence, refreshScroll]);

  // Boot: create runtimes, open the default room (#general or first). In
  // single-room mode (lockedRoom) the list is exactly that one room.
  useEffect(() => {
    let cancelled = false;
    const infos = lockedRoom ? [lockedRoom] : roomInfos;
    for (const info of infos) {
      // App-authored public rooms (externalUrl) have no scroll runtime —
      // they navigate elsewhere, so they must never be joined or auto-opened.
      if (info.externalUrl) continue;
      if (!runtimes.current.has(info.roomId)) {
        // The production site connects to its attached relay endpoint
        // (wss://<host>/ws); the fragment's direct-relay hint is the fallback.
        let relayUrl = BAO_SOCIAL_DIRECTORY.relayUrl;
        if (!relayUrl) {
          try {
            const parts = parseJoinLink(info.joinLink);
            relayUrl = parts.relay ?? "";
          } catch {
            relayUrl = "";
          }
        }
        runtimes.current.set(info.roomId, newRuntime(info, relayUrl));
      }
    }
    const first =
      lockedRoom ??
      infos.find((info) => info.name.toLowerCase() === "general") ??
      infos.find((info) => !info.externalUrl);
    if (first && !currentId.current && !cancelled) {
      // Load app framework first (paint layout), then connect content.
      window.setTimeout(() => void selectRoom(first.roomId), 50);
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Unmount cleanup: stop timers/subscriptions, close sockets.
  useEffect(() => {
    const runtimesMap = runtimes.current;
    return () => {
      for (const r of runtimesMap.values()) {
        if (r.refreshTimer) clearInterval(r.refreshTimer);
        r.unsubscribe?.();
        r.conn?.close();
      }
    };
  }, []);

  // Catch-up on tab focus / visibility: browsers throttle background timers
  // (and the relay may drop the socket while hidden), so messages that
  // arrived while away only appeared after the next slow poll — or not at
  // all if the live sub was down. Refresh the open room immediately when the
  // user comes back.
  useEffect(() => {
    const catchUp = () => {
      const roomId = currentId.current;
      if (roomId && document.visibilityState === 'visible') {
        void refreshScroll(roomId);
      }
    };
    window.addEventListener('focus', catchUp);
    document.addEventListener('visibilitychange', catchUp);
    return () => {
      window.removeEventListener('focus', catchUp);
      document.removeEventListener('visibilitychange', catchUp);
    };
  }, [refreshScroll]);

  // ── Send ─────────────────────────────────────────────────────────────────

  const send = useCallback(async () => {
    const roomId = currentId.current;
    const r = roomId ? runtimes.current.get(roomId) : undefined;
    if (!roomId || !r?.session) return;
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    setReplyDraft(null);
    const payload: ChatPayload = { text };
    if (replyDraft) {
      payload.reply = { author: replyDraft.author, msg_id: replyDraft.msgId };
    }
    const identity = effectiveIdentity;
    if (identity) payload.identity = identity;
    const to = resolveMentions(text, r.roster);
    if (to.length > 0) payload.to = to;
    try {
      const env = await r.session.post(payload);
      const key = dedupKey(env);
      // Register BEFORE the live echo can arrive — no duplicates, ever.
      r.rows.push({ key, env, mine: true, receipt: "pending" });
      r.known.set(key, env);
      r.outbox.set(key, { env, lastSentMs: Date.now(), attempts: 0 });
      rerender();
      void refreshScroll(roomId);
    } catch (err) {
      // Publish failed (relay unreachable / OK timeout / rejection): the outbox
      // was never armed, so without this the message is silently lost. Give
      // the text (and reply target) back so the member can simply retry.
      setDraft(text);
      if (replyDraft) setReplyDraft(replyDraft);
      log(`#${r.info.name}: post failed — draft restored: ${(err as Error).message}`);
    }
  }, [draft, replyDraft, effectiveIdentity, refreshScroll, log]);

  // ── Join by invite link ──────────────────────────────────────────────────

  const addRoomFromLink = useCallback(() => {
    const link = absorbLink(joinLinkInput.trim());
    if (!link) return;
    try {
      const parts = parseJoinLink(link);
      if (runtimes.current.has(parts.roomId)) {
        log("already in the directory — selecting it");
        setJoinLinkInput("");
        void selectRoom(parts.roomId);
        return;
      }
      const info: BaoSocialRoomInfo = {
        roomId: parts.roomId,
        name: `room-${parts.roomId.slice(0, 6)}`,
        // Unlisted room (ghost): the invite link is the only way in.
        topic: "unlisted · invite link",
        joinLink: link,
        agentLink: "",
        welcomerPub: parts.welcomerPub ?? "",
        routingId: parts.routingId ?? "",
        flushDeadlineMs: 4000,
      };
      const relayUrl = parts.relay ?? BAO_SOCIAL_DIRECTORY.relayUrl;
      runtimes.current.set(parts.roomId, newRuntime(info, relayUrl));
      setRoomInfos((infos) => [...infos, info]);
      const added = [...loadAddedRooms(), { roomId: parts.roomId, joinLink: link } satisfies AddedRoom];
      try {
        localStorage.setItem(ADDED_KEY, JSON.stringify(added));
      } catch {
        /* best-effort */
      }
      setJoinLinkInput("");
      log(`#${info.name} added from invite link`);
      void selectRoom(parts.roomId);
    } catch {
      log("invite link not recognized");
    }
  }, [joinLinkInput, log, selectRoom]);

  const copy = useCallback((text: string, what: string) => {
    void navigator.clipboard.writeText(text);
    log(`${what} copied`);
  }, [log]);

  // ── Derived render data ──────────────────────────────────────────────────

  const current = currentId.current ? runtimes.current.get(currentId.current) : undefined;

  const handleFor = useCallback(
    (r: RoomRuntime, author: string) => r.roster.get(author)?.handle ?? `${author.slice(0, 8)}…`,
    [],
  );

  const roomKey = useMemo(() => current?.info.roomId ?? "none", [current]);

  return (
    <div
      className={cn(
        "flex h-full min-h-0 overflow-hidden",
        // On mobile the chat pane needs a real viewport height (the parent
        // chain has none), otherwise the column collapses and content hides
        // behind the fixed top bar and bottom nav. Same tool class
        // LiveStreamPage uses successfully. Embedded panels (Fal Live TV)
        // get their height from the parent instead.
        !embedded && "max-lg:livestream-height",
      )}
      data-room={roomKey}
    >
      {/* Rooms sidebar — hidden in single-room mode (lockedRoom). */}
      {!lockedRoom && (
      <aside
        className={cn(
          "flex shrink-0 flex-col border-r bg-muted/30 transition-all",
          roomsCollapsed ? "w-10" : "w-40",
        )}
      >
        <div
          className={cn(
            "flex w-full items-center py-2.5",
            roomsCollapsed ? "justify-center px-0" : "justify-between px-3",
          )}
        >
          {!roomsCollapsed && (
            <span className="text-[11px] font-semibold tracking-widest text-muted-foreground">ROOMS</span>
          )}
          <button
            type="button"
            onClick={() => setRoomsCollapsed((v) => !v)}
            aria-label={roomsCollapsed ? "Expand rooms" : "Collapse rooms"}
            aria-expanded={!roomsCollapsed}
            title={roomsCollapsed ? "Expand rooms" : "Collapse rooms"}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          >
            {roomsCollapsed ? (
              <PanelRightOpen className="size-3.5" />
            ) : (
              <PanelRightClose className="size-3.5" />
            )}
          </button>
        </div>
        {!roomsCollapsed && (
          <>
            <div className="flex-1 space-y-0.5 overflow-y-auto px-2">
              {roomInfos.map((info) => {
                const r = runtimes.current.get(info.roomId);
                const active = info.roomId === currentId.current;
                // App-authored public room (externalUrl): opens its surface
                // instead of joining an encrypted scroll.
                if (info.externalUrl) {
                  return (
                    <button
                      key={info.roomId}
                      type="button"
                      onClick={() => navigate("/fal-live")}
                      title={`${info.name} — public room`}
                      className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors text-foreground/80 hover:bg-secondary/60"
                    >
                      <Sparkles className="size-3.5 shrink-0 text-primary/70" />
                      <span className="truncate">{info.name}</span>
                      <ExternalLink className="ml-auto size-3 opacity-50" />
                    </button>
                  );
                }
                return (
                  <button
                    key={info.roomId}
                    type="button"
                    onClick={() => void selectRoom(info.roomId)}
                    className={cn(
                      "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                      active ? "bg-primary/10 font-medium text-primary" : "text-foreground/80 hover:bg-secondary/60",
                    )}
                  >
                    <Hash className="size-3.5 shrink-0 opacity-60" />
                    <span className="truncate">{info.name}</span>
                    {r?.joinPhase === "joining" && <Loader2 className="ml-auto size-3 animate-spin opacity-60" />}
                  </button>
                );
              })}
              <p className="px-2 pb-2 pt-3 text-[10px] italic leading-tight text-muted-foreground">
                Other rooms exist but are only visible to members.
              </p>
            </div>
            <div className="space-y-2 border-t p-2">
              <div className="flex gap-1">
                <Input
                  value={joinLinkInput}
                  onChange={(event) => setJoinLinkInput(event.target.value)}
                  placeholder="Paste invite link…"
                  className="h-7 text-xs"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") addRoomFromLink();
                  }}
                />
                <Button variant="outline" size="icon" className="size-7 shrink-0" aria-label="Join room from invite link" onClick={addRoomFromLink}>
                  <Plus className="size-3.5" />
                </Button>
              </div>
              <p className="text-[10px] leading-tight text-muted-foreground">
                Create rooms at www.2140.social, then paste the join link here.
              </p>
            </div>
          </>
        )}
      </aside>
      )}

      {/* Room column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 border-b px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold">
              # {current?.info.name ?? "…"}
            </h2>
            <p className="truncate text-xs text-muted-foreground">{current?.info.topic ?? ""}</p>
          </div>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground max-sm:hidden">
            <Radio className={cn("size-3.5", current?.joinPhase === "ready" ? "text-success" : "text-muted-foreground/50")} />
            {current?.joinPhase === "ready" ? "relay live" : current?.joinPhase === "joining" ? "joining…" : "idle"}
          </span>
          {current?.joinPhase === "ready" && (
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => copy(current.info.joinLink, "Invite link")}>
              <Copy className="mr-1 size-3" /> invite link
            </Button>
          )}
        </div>

        {/* Scroll */}
        <div className="flex-1 space-y-0.5 overflow-y-auto px-4 py-3" data-scroll={current?.rows.length ?? 0}>
          {!current || current.rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {current?.joinPhase === "joining"
                ? "Joining — the welcomer is wrapping your room key…"
                : current?.joinPhase === "error"
                  ? `Join failed: ${current.joinError}`
                  : current?.joinPhase === "idle"
                    ? "Loading scroll — connecting to relay…"
                    : "No messages yet. Say something."}
            </p>
          ) : (
            current.rows.map((row) => {
              const reply = replyOf(row.env);
              const target = reply ? current.known.get(`${reply.author}:${reply.msg_id}`) : undefined;
              const segments = segmentMentions(previewText(row.env), current.roster);
              return (
                <div key={row.key} className="group rounded-md px-2 py-1 hover:bg-secondary/40">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-semibold text-primary/90" title={row.env.author}>
                      {handleFor(current, row.env.author)}
                    </span>
                    {row.mine && (
                      <span className="rounded border border-primary/40 px-1 text-[9px] font-bold tracking-wider text-primary">
                        YOU
                      </span>
                    )}
                    <span
                      className={cn(
                        "ml-auto text-[10px] italic",
                        row.receipt === "scrolled" && "text-muted-foreground/60",
                        row.receipt === "pending" && "text-muted-foreground/50",
                        row.receipt === "dropped" && "text-destructive",
                      )}
                    >
                      {row.receipt === "scrolled" ? "scrolled ✓" : row.receipt === "pending" ? "awaiting scroll…" : "dropped ✗ (scribe unreachable)"}
                    </span>
                    <button
                      type="button"
                      aria-label="Reply to message"
                      className="opacity-0 transition-opacity group-hover:opacity-100"
                      onClick={() => {
                        setReplyDraft({ author: row.env.author, msgId: row.env.msg_id, preview: previewText(row.env) });
                      }}
                    >
                      <Reply className="size-3.5 text-muted-foreground" />
                    </button>
                  </div>
                  {reply && (
                    <div className="mb-0.5 border-l-2 border-border pl-2 text-[11px] italic text-muted-foreground">
                      ↩ in reply to {reply.author.slice(0, 8)}…: {target ? previewText(target) : "(message not in this view)"}
                    </div>
                  )}
                  <div className="whitespace-pre-wrap break-words text-sm">
                    {segments.map((seg, index) =>
                      seg.kind === "text" ? (
                        <span key={index}>{seg.text}</span>
                      ) : (
                        <span key={index} className="font-medium text-primary" title={seg.entry?.author ?? ""}>
                          {seg.text}
                        </span>
                      ),
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Composer */}
        <div className="border-t px-4 py-3">
          {replyDraft && (
            <div className="mb-2 flex items-center gap-2 rounded-md border bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
              <span className="truncate">
                Replying to {replyDraft.author.slice(0, 8)}…: {replyDraft.preview}
              </span>
              <button type="button" aria-label="Cancel reply" className="ml-auto" onClick={() => setReplyDraft(null)}>
                <X className="size-3.5" />
              </button>
            </div>
          )}
          <div className="mb-2 flex items-center gap-2 text-xs">
            <button
              type="button"
              className="rounded-md border px-2 py-0.5 text-muted-foreground hover:bg-secondary/60"
              onClick={() => setShowIdentity((value) => !value)}
            >
              🪪 {identityLabel} {showIdentity ? "▾" : "▸"}
            </button>
            {showIdentity && (
              <div className="flex flex-1 flex-wrap items-center gap-2">
                {/* Identity modes — NIP-05 vs hashed-anon vs pure burner. */}
                <div className="flex items-center gap-1 rounded-md border p-0.5">
                  <button
                    type="button"
                    aria-pressed={identityMode === "nip05"}
                    title={nip05 ? (nip05Verified ? `Appear as @${nip05} inside the encrypted envelope` : "Your NIP-05 is not verified yet") : "No NIP-05 on your profile"}
                    className={cn(
                      "flex items-center gap-1 rounded px-2 py-0.5 text-[11px] transition-colors",
                      identityMode === "nip05" ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-secondary/60",
                    )}
                    onClick={() => setIdentityMode("nip05")}
                  >
                    <IdCard className="size-3" /> NIP-05
                  </button>
                  <button
                    type="button"
                    aria-pressed={identityMode === "hashed"}
                    title="Stable pseudonym derived from your pubkey — linkable across messages, never to your key"
                    className={cn(
                      "flex items-center gap-1 rounded px-2 py-0.5 text-[11px] transition-colors",
                      identityMode === "hashed" ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-secondary/60",
                    )}
                    onClick={() => setIdentityMode("hashed")}
                  >
                    <ShieldCheck className="size-3" /> Hashed
                  </button>
                  <button
                    type="button"
                    aria-pressed={identityMode === "anon"}
                    title="Pure burner — no identity rides the envelope"
                    className={cn(
                      "flex items-center gap-1 rounded px-2 py-0.5 text-[11px] transition-colors",
                      identityMode === "anon" ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-secondary/60",
                    )}
                    onClick={() => setIdentityMode("anon")}
                  >
                    <KeyRound className="size-3" /> Anon
                  </button>
                </div>
                {identityMode === "nip05" && (
                  <span className={cn("text-[11px]", nip05 && nip05Verified ? "text-success" : "text-muted-foreground")}>
                    {nip05
                      ? nip05Verified
                        ? `✓ visible as @${nip05}`
                        : "⏳ verifying NIP-05…"
                      : "no NIP-05 on your profile — set one in settings"}
                  </span>
                )}
                {identityMode === "hashed" && (
                  <span className="text-[11px] text-muted-foreground">
                    ✓ visible as {effectiveIdentityLabel}
                  </span>
                )}
                {identityMode === "anon" && (
                  <>
                    <Input
                      value={npubInput}
                      onChange={(event) => {
                        setNpubInput(event.target.value);
                        try {
                          const npubKey = accountPubkey ? `${NPUB_KEY}:${accountPubkey}` : NPUB_KEY;
                          localStorage.setItem(npubKey, event.target.value);
                        } catch {
                          /* best-effort */
                        }
                      }}
                      placeholder="npub1… (optional — expose your identity)"
                      className="h-7 max-w-64 text-xs"
                    />
                    <span className={cn("text-[11px]", effectiveIdentityLabel ? "text-success" : "text-muted-foreground")}>
                      {npubInput.trim()
                        ? effectiveIdentityLabel
                          ? `✓ visible as ${effectiveIdentityLabel.slice(0, 12)}…`
                          : "✗ invalid npub — stays anonymous"
                        : "anonymous"}
                    </span>
                  </>
                )}
                <Input
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    try {
                      localStorage.setItem(NAME_KEY, event.target.value);
                    } catch {
                      /* best-effort */
                    }
                    const r = currentId.current ? runtimes.current.get(currentId.current) : undefined;
                    if (r) r.presencePosted = false;
                  }}
                  placeholder="display name (optional — @handle for mentions)"
                  className="h-7 max-w-56 text-xs"
                  maxLength={40}
                />
                {current?.session && (
                  <span className="text-[10px] text-muted-foreground" title={getPublicKey(current.session.joined.authorSecretKey)}>
                    room key: {getPublicKey(current.session.joined.authorSecretKey).slice(0, 12)}…
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              disabled={!current || current.joinPhase !== "ready"}
              placeholder={
                !current || current.joinPhase !== "ready"
                  ? current?.joinPhase === "joining"
                    ? "Joining…"
                    : "Join a room to write."
                  : "Write to the scroll…"
              }
              rows={1}
              className="max-h-40 min-h-10 flex-1 resize-y rounded-lg border bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button size="sm" className="h-10 px-5" disabled={!current || current.joinPhase !== "ready" || !draft.trim()} onClick={() => void send()}>
              POST
            </Button>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Encrypted scroll — the relay stores only fixed-size ciphertext segments.
            {current?.session && (() => {
              try {
                const sk = current.session.joined.authorSecretKey;
                return ` Burner key: ${nsecEncode(sk).slice(0, 10)}…`;
              } catch {
                return "";
              }
            })()}
          </p>
        </div>

        {/* Status log (site parity) */}
        {logLines.length > 0 && (
          <div className="max-h-20 overflow-y-auto border-t bg-muted/20 px-4 py-1 font-mono text-[10px] leading-relaxed text-muted-foreground">
            {logLines.slice(-6).map((line, index) => (
              <div key={`${index}-${line.slice(0, 12)}`} className="truncate">
                {line}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
