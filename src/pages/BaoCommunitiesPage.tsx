/**
 * 2140 Social — the bao_chat_protocol v1 scroll client, in-app.
 *
 * A React port of the www.2140.social web client (demo/app.ts in
 * baocommunity/2140.social) on the vendored @bao/community core:
 * burner-key joins via fat invite links, hash-chained encrypted scroll,
 * presence roster, @mentions, replies, retry-until-scrolled receipts.
 * Identity is anonymous by default; an optional npub rides INSIDE the
 * encrypted envelope payload, never on the wire.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useSeoMeta } from "@unhead/react";
import { Copy, Hash, Loader2, PanelRightClose, PanelRightOpen, Plus, Radio, Reply, X } from "lucide-react";

import {
  WebRelayConn,
  RoomSession,
  joinRoom,
  parseJoinLink,
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
import { cn } from "@/lib/utils";

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
  identity?: { npub: string };
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
  rerenderTimer: ReturnType<typeof setTimeout> | null;
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
    rerenderTimer: null,
    relayUrl,
  };
}

// ── Component ────────────────────────────────────────────────────────────────

export function BaoCommunitiesPage() {
  useSeoMeta({
    title: "2140 Social",
    description: "2140 Social — encrypted community scroll on Nostr, inside 2140.",
  });

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
            topic: "joined via invite link",
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
  const [npubInput, setNpubInput] = useState(() => localStorage.getItem(NPUB_KEY) ?? "");
  const [joinLinkInput, setJoinLinkInput] = useState("");
  const [showIdentity, setShowIdentity] = useState(false);
const [roomsCollapsed, setRoomsCollapsed] = useState(false);

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
        // the session gets a fresh one (spec §6, unlinkability).
        const joinConn = new WebRelayConn(r.relayUrl);
        const joined: JoinedRoom = await joinRoom(
          joinConn,
          r.info.joinLink,
          { welcomerPub: r.info.welcomerPub, routingId: r.info.routingId },
          { joinTimeoutMs: 25_000 },
        );
        joinConn.close();
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
        // Batch rerenders: throttle full component repaint to 150ms so rapid
        // live-message bursts don't jank mobile (slow load / high CPU).
        clearTimeout(r.rerenderTimer);
        r.rerenderTimer = window.setTimeout(() => void refreshScroll(roomId), 150);
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

  // Boot: create runtimes, open the default room (#general or first).
  useEffect(() => {
    let cancelled = false;
    for (const info of roomInfos) {
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
      roomInfos.find((info) => info.name.toLowerCase() === "general") ?? roomInfos[0];
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
    const exposed = validateNpub(npubInput);
    if (exposed) payload.identity = { npub: exposed };
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
  }, [draft, replyDraft, npubInput, refreshScroll, log]);

  // ── Join by invite link ──────────────────────────────────────────────────

  const addRoomFromLink = useCallback(() => {
    const link = joinLinkInput.trim();
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
        topic: "joined via invite link",
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
  const npubValid = validateNpub(npubInput);

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
        // LiveStreamPage uses successfully.
        "max-lg:livestream-height",
        // When the rooms sidebar is collapsed on mobile, the chat column
        // should take the full width instead of leaving a blank gap.
        roomsCollapsed && "max-lg:pl-0",
      )}
      data-room={roomKey}
    >
      {/* Rooms sidebar — collapsible on mobile so chat can go full-width */}
      <aside
        className={cn(
          "flex shrink-0 flex-col border-r bg-muted/30 transition-all",
          roomsCollapsed ? "max-lg:w-0 max-lg:border-r-0" : "max-lg:w-40",
        )}
      >
        <div className="flex items-center justify-between px-3 py-2.5">
          <span className="text-[11px] font-semibold tracking-widest text-muted-foreground">ROOMS</span>
          <button
            type="button"
            onClick={() => setRoomsCollapsed((v) => !v)}
            aria-label={roomsCollapsed ? "Expand rooms" : "Collapse rooms"}
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
        <div className="flex-1 space-y-0.5 overflow-y-auto px-2">
          {roomInfos.map((info) => {
            const r = runtimes.current.get(info.roomId);
            const active = info.roomId === currentId.current;
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
      </aside>

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
              🪪 {name.trim() || (npubValid ? "named npub" : "anonymous")} {showIdentity ? "▾" : "▸"}
            </button>
            {showIdentity && (
              <div className="flex flex-1 flex-wrap items-center gap-2">
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
                <Input
                  value={npubInput}
                  onChange={(event) => {
                    setNpubInput(event.target.value);
                    try {
                      localStorage.setItem(NPUB_KEY, event.target.value);
                    } catch {
                      /* best-effort */
                    }
                  }}
                  placeholder="npub1… (optional — expose your identity)"
                  className="h-7 max-w-64 text-xs"
                />
                <span className={cn("text-[11px]", npubValid ? "text-success" : "text-muted-foreground")}>
                  {npubInput.trim()
                    ? npubValid
                      ? `✓ visible as ${npubValid.slice(0, 12)}…`
                      : "✗ invalid npub — stays anonymous"
                    : "anonymous"}
                </span>
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
