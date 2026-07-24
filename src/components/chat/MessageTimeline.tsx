import { ChevronDown, Loader2 } from "lucide-react";
import { useCallback, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import type { ChatMsg, ChatTransport } from "@/components/chat/transport";
import type { ReactNode, RefObject, UIEvent } from "react";
import type { FollowOutputScalarType, VirtuosoHandle } from "react-virtuoso";

/**
 * Largest gap (seconds) between two same-author messages for the later one to
 * render as a compact continuation (no repeated avatar/name/timestamp).
 */
const CONTINUATION_WINDOW_SECONDS = 5 * 60;

/** Whether two unix-second timestamps fall on the same local calendar day. */
function isSameDay(a: number, b: number): boolean {
  const da = new Date(a * 1000);
  const db = new Date(b * 1000);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

/** "Today" / "Yesterday" / a long local date, for the day separators. */
function formatDayLabel(ts: number): string {
  const date = new Date(ts * 1000);
  const now = new Date();
  if (isSameDay(ts, Math.floor(now.getTime() / 1000))) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(ts, Math.floor(yesterday.getTime() / 1000))) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

/** Discord-style day boundary: a hairline with the date pinned in the middle. */
function DateSeparator({ ts }: { ts: number }) {
  return (
    <div className="flex items-center gap-3 px-2 pt-3 pb-1 select-none" aria-hidden>
      <div className="h-px flex-1 bg-border/60" />
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">
        {formatDayLabel(ts)}
      </span>
      <div className="h-px flex-1 bg-border/60" />
    </div>
  );
}

/** Discord-style unread marker: a red hairline with a "NEW" tag. */
function NewMessagesDivider() {
  return (
    <div className="flex items-center px-2 py-1 select-none" role="separator" aria-label="New messages">
      <div className="h-px flex-1 bg-destructive/70" />
      <span className="pl-1.5 text-[10px] font-semibold uppercase tracking-wider text-destructive">
        New
      </span>
    </div>
  );
}

/**
 * One virtualized row: a message (with its precomputed continuation flag), a
 * day separator, or the unread "NEW" divider. Separators are rows of their own
 * so the windowing library can measure and anchor every piece of scroll content.
 */
type TimelineItem =
  | { type: "date"; ts: number; key: string }
  | { type: "unread"; key: string }
  | { type: "message"; msg: ChatMsg; continuation: boolean; key: string };

/**
 * `firstItemIndex` base for the virtualizer. Backfill prepends older rows by
 * DECREASING this offset by the number of prepended rows (react-virtuoso then
 * keeps the reading position anchored automatically), so it starts high enough
 * to never hit zero.
 */
const FIRST_INDEX_BASE = 10_000_000;

/** Context handed to the virtualizer's Header/Footer (kept stable at module scope). */
interface TimelineContext {
  isLoadingOlder: boolean;
}

/** Top of the scroll content: backfill spinner while loading older, else padding. */
function TimelineHeader({ context }: { context?: TimelineContext }) {
  return context?.isLoadingOlder ? (
    <div className="flex justify-center pt-4 pb-3">
      <Loader2 className="size-4 animate-spin text-muted-foreground" />
    </div>
  ) : (
    <div className="h-4" aria-hidden />
  );
}

/** Bottom padding of the scroll content (the scroller itself can't take `py`). */
function TimelineFooter() {
  return <div className="h-4" aria-hidden />;
}

// Stable component map — a fresh object each render would remount Header/Footer.
const TIMELINE_COMPONENTS = { Header: TimelineHeader, Footer: TimelineFooter };

/** Follow appended messages only while the view is already at the bottom. */
function followOutput(isAtBottom: boolean): FollowOutputScalarType {
  return isAtBottom ? "auto" : false;
}

/** Imperative handle a parent can use to jump the timeline to a message by id. */
export interface MessageTimelineHandle {
  scrollToMessage: (id: string) => void;
  /** Re-anchor to the bottom and resume auto-scroll (e.g. after sending). */
  pinToBottom: () => void;
  /**
   * Keep the view at the bottom *only if the user was already there* — used
   * while a sibling panel animates its width and would otherwise let the
   * bottom-anchored view drift.
   */
  maintainBottom: () => void;
}

interface MessageTimelineProps {
  transport: ChatTransport;
  /**
   * Render one message row. The parent (a transport-specific wrapper) resolves
   * per-message data (reactions, reply context, send status) and returns a
   * `ChatMessage`. `continuation` is precomputed here from the shared rule.
   */
  renderMessage: (event: ChatMsg, continuation: boolean) => ReactNode;
  /**
   * Empty-state node shown when there are no messages and nothing is loading.
   */
  emptyState?: ReactNode;
  /** Optional ref for imperative scroll control (pinned-message jumps, etc.). */
  handleRef?: RefObject<MessageTimelineHandle | null>;
  /**
   * When true, the timeline yields its content area to a caller-provided
   * overlay (e.g. search results) — backfill on scroll is suppressed.
   */
  paused?: boolean;
  /**
   * Id of the first unread message: the red "NEW" divider renders directly
   * above it (computed by the parent, e.g. {@link useNewMessagesDivider}).
   */
  newDividerId?: string;
  /**
   * True while a background catch-up for THIS conversation is in flight (a
   * sync-activity task scoped to it). An empty timeline then keeps the
   * skeleton up instead of declaring "no messages" — the verdict isn't in yet.
   */
  syncing?: boolean;
  className?: string;
}

/**
 * The transport-agnostic message timeline: a bottom-anchored, auto-scrolling,
 * VIRTUALIZED scroll area with scroll-up backfill, same-author continuation
 * collapsing, a loading skeleton and an empty state. It owns only scroll
 * mechanics and the continuation rule; every message's content/actions come
 * from `renderMessage`, and all data/mutations come from the
 * {@link ChatTransport}. Shared by NIP-29 group chat, Concord communities,
 * DMs and the Bluetooth mesh.
 *
 * Windowing is react-virtuoso: only rows near the viewport are mounted, which
 * is what keeps long histories cheap on iOS Safari (low per-tab memory
 * ceiling). The timeline's contract survives it as follows:
 * - Bottom pinning: `followOutput` re-pins on appends; `totalListHeightChanged`
 *   re-pins when already-mounted rows GROW from async loads (images, link
 *   previews, embeds, reactions) that don't change `messages`.
 * - Backfill: older history is prepended by decreasing `firstItemIndex`, which
 *   virtuoso uses to keep the same content under the viewport — no manual
 *   scrollTop restore math.
 * - `scrollToMessage`: resolved to an item INDEX (not a DOM node — the row may
 *   be unmounted), scrolled to via `scrollToIndex`, then highlighted once the
 *   row exists in the DOM (short rAF retry loop on `[data-event-id]`).
 * - Conversation switches without a remount (some callers don't `key` this
 *   component) are detected by anchor loss — no previously-known message id
 *   survives into the new list — and reset the virtualizer via an epoch key.
 */
export function MessageTimeline({
  transport,
  renderMessage,
  emptyState,
  handleRef,
  paused = false,
  newDividerId,
  syncing = false,
  className,
}: MessageTimelineProps) {
  const { messages, isLoading, loadOlder, hasMore, isLoadingOlder } = transport;

  // Remember that we've shown a populated timeline. If `messages` then briefly
  // empties (a transient between a cache refresh and the merged result landing),
  // we render the skeleton rather than flashing the empty state / a blank gap —
  // the timeline never truly "loses" its history, so a momentary empty array is
  // a render artifact, not an empty channel. Reset while a fresh load is in
  // flight (channel switch) so a genuinely-empty channel still shows its empty
  // state instead of a stale skeleton.
  const hadMessagesRef = useRef(false);
  if (isLoading) hadMessagesRef.current = false;
  if (messages.length > 0) hadMessagesRef.current = true;
  const transientEmpty = messages.length === 0 && hadMessagesRef.current;

  // Flatten messages + injected separators into the virtualizer's row model,
  // applying the shared continuation rule (same author, same day, small gap).
  const items = useMemo<TimelineItem[]>(() => {
    const out: TimelineItem[] = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const prev = messages[i - 1];
      const newDay = !!prev && !isSameDay(prev.created_at, msg.created_at);
      if (newDay) out.push({ type: "date", ts: msg.created_at, key: `date-${msg.id}` });
      if (newDividerId === msg.id) out.push({ type: "unread", key: "unread-divider" });
      const continuation =
        !!prev &&
        !newDay &&
        prev.pubkey === msg.pubkey &&
        msg.created_at - prev.created_at < CONTINUATION_WINDOW_SECONDS;
      out.push({ type: "message", msg, continuation, key: msg.id });
    }
    return out;
  }, [messages, newDividerId]);

  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const scrollerElRef = useRef<HTMLElement | null>(null);
  // Whether the view is (near) the bottom — mirrors virtuoso's atBottom state
  // and gates the re-pin paths, like the old manual `isAutoScrollRef`.
  const atBottomRef = useRef(true);
  // Whether the user has scrolled far enough up that a "jump to present" pill
  // should be offered. (setState bails out when unchanged, so updating this on
  // every scroll event is cheap.)
  const [showJumpPill, setShowJumpPill] = useState(false);
  // In-flight guard for backfill, independent of the transport's (possibly
  // lagging) `isLoadingOlder`, so one scroll gesture can't double-trigger it.
  const loadingOlderRef = useRef(false);

  // ── Prepend anchoring / conversation-switch detection ─────────────────────
  // Derived synchronously during render (getDerivedStateFromProps-style): when
  // `items` changes, locate the previous first MESSAGE row in the new list.
  // Found at a later index → rows were prepended (backfill): decrease
  // `firstItemIndex` by the difference and virtuoso holds the reading position.
  // Gone entirely (along with the previous last message) → this is a different
  // conversation: bump the epoch, which remounts the virtualizer pinned to the
  // bottom with a fresh index base.
  const anchorRef = useRef<{ items: TimelineItem[]; firstItemIndex: number; epoch: number }>({
    items: [],
    firstItemIndex: FIRST_INDEX_BASE,
    epoch: 0,
  });
  if (anchorRef.current.items !== items) {
    const prev = anchorRef.current;
    const prevFirstIdx = prev.items.findIndex((it) => it.type === "message");
    let firstItemIndex = prev.firstItemIndex;
    let epoch = prev.epoch;
    if (prevFirstIdx === -1) {
      // Previously empty — fresh conversation, fresh base.
      firstItemIndex = FIRST_INDEX_BASE;
    } else {
      const anchorItem = prev.items[prevFirstIdx];
      const anchorId = anchorItem.type === "message" ? anchorItem.msg.id : "";
      const newIdx = items.findIndex((it) => it.type === "message" && it.msg.id === anchorId);
      if (newIdx !== -1) {
        firstItemIndex = prev.firstItemIndex - (newIdx - prevFirstIdx);
      } else {
        // The old first message is gone. If the old NEWEST message survived,
        // history was merely trimmed/deleted at the front — keep the offset
        // (a one-row shift beats a full reset). Otherwise: new conversation.
        const prevLast = [...prev.items].reverse().find((it) => it.type === "message");
        const sameConversation =
          prevLast?.type === "message" &&
          items.some((it) => it.type === "message" && it.msg.id === prevLast.msg.id);
        if (!sameConversation) {
          epoch = prev.epoch + 1;
          firstItemIndex = FIRST_INDEX_BASE;
          atBottomRef.current = true;
          loadingOlderRef.current = false;
        }
      }
    }
    anchorRef.current = { items, firstItemIndex, epoch };
  }
  const { firstItemIndex, epoch } = anchorRef.current;

  /** Jump to the newest message (instant), hiding the pill. */
  const pinToBottomNow = useCallback(() => {
    virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end" });
    setShowJumpPill(false);
  }, []);

  // Rows growing from async loads (images, link previews, embeds, reactions)
  // change the total list height without changing `messages`; keep the view
  // pinned through that, but only while the user is at the bottom. (Replaces
  // the old ResizeObserver on a fully-mounted content wrapper.)
  const handleTotalListHeightChanged = useCallback(() => {
    if (atBottomRef.current) pinToBottomNow();
  }, [pinToBottomNow]);

  const handleAtBottomStateChange = useCallback((atBottom: boolean) => {
    atBottomRef.current = atBottom;
    if (atBottom) setShowJumpPill(false);
  }, []);

  const handleScroll = useCallback(
    (e: UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowJumpPill(distanceFromBottom > 300);
      // Near the top: backfill older history. Virtuoso anchors the reading
      // position itself when `firstItemIndex` decreases on the prepend.
      if (
        !paused &&
        loadOlder &&
        hasMore &&
        !isLoadingOlder &&
        !loadingOlderRef.current &&
        el.scrollTop < 200
      ) {
        loadingOlderRef.current = true;
        void loadOlder().finally(() => {
          loadingOlderRef.current = false;
        });
      }
    },
    [paused, loadOlder, hasMore, isLoadingOlder],
  );

  // Scroll a (pinned) message into view and briefly highlight it with a subtle
  // background tint that fades out. No-op if it's not in the currently-loaded
  // timeline. The row may not be mounted yet (that's the point of windowing),
  // so the scroll targets its item INDEX and the highlight retries against the
  // DOM until the row exists.
  const scrollToMessage = useCallback((id: string) => {
    const current = anchorRef.current.items;
    const idx = current.findIndex((it) => it.type === "message" && it.msg.id === id);
    if (idx === -1) return;
    atBottomRef.current = false;
    virtuosoRef.current?.scrollToIndex({ index: idx, align: "center", behavior: "smooth" });
    const started = performance.now();
    const tryHighlight = () => {
      const el = scrollerElRef.current?.querySelector<HTMLElement>(`[data-event-id="${id}"]`);
      if (el) {
        el.classList.add("bg-primary/10", "transition-colors", "duration-1000", "rounded-md");
        setTimeout(() => el.classList.remove("bg-primary/10"), 1200);
        setTimeout(() => el.classList.remove("transition-colors", "duration-1000", "rounded-md"), 2200);
        return;
      }
      if (performance.now() - started < 2000) requestAnimationFrame(tryHighlight);
    };
    requestAnimationFrame(tryHighlight);
  }, []);

  useImperativeHandle(
    handleRef,
    () => ({
      scrollToMessage,
      pinToBottom: () => {
        atBottomRef.current = true;
        pinToBottomNow();
      },
      maintainBottom: () => {
        if (!atBottomRef.current) return;
        pinToBottomNow();
      },
    }),
    [scrollToMessage, pinToBottomNow],
  );

  const scrollerRefCallback = useCallback((el: HTMLElement | Window | null) => {
    scrollerElRef.current = el instanceof HTMLElement ? el : null;
  }, []);

  const itemContent = useCallback(
    (_index: number, item: TimelineItem) => {
      // The horizontal gutter (`px-3`) lives on each row, NOT the Virtuoso
      // scroller: virtuoso's viewport/list is absolutely positioned and
      // `width: 100%`, so a scroller `px-*` only honors the LEFT side (the
      // list's static x sits inside the left padding) while the right padding
      // is spanned over — content would hug the right edge (and the sliver of
      // overflow gets silently eaten by `overflow-x-clip`). Padding the rows
      // themselves restores the symmetric gutter the pre-virtualized scroll
      // container had.
      switch (item.type) {
        case "date":
          return (
            <div className="px-3">
              <DateSeparator ts={item.ts} />
            </div>
          );
        case "unread":
          return (
            <div className="px-3">
              <NewMessagesDivider />
            </div>
          );
        case "message":
          // `hover:z-10` lifts the hovered row above its siblings so the
          // floating action toolbar (which overhangs the row's top edge) isn't
          // painted under the row above.
          return (
            <div className="px-3 relative hover:z-10 focus-within:z-10">
              {renderMessage(item.msg, item.continuation)}
            </div>
          );
      }
    },
    [renderMessage],
  );

  return (
    <div className={cn("relative flex flex-col", className)}>
      {isLoading || transientEmpty || (syncing && messages.length === 0) ? (
        <div className="flex-1 min-h-0 overflow-hidden px-3 py-4">
          <div className="space-y-3 p-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3">
                <Skeleton className="size-10 rounded-full shrink-0" />
                <div className="space-y-1 flex-1">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : messages.length === 0 ? (
        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-4">{emptyState ?? null}</div>
      ) : (
        <>
          <Virtuoso<TimelineItem, TimelineContext>
            key={epoch}
            ref={virtuosoRef}
            scrollerRef={scrollerRefCallback}
            className="flex-1 min-h-0 overflow-x-clip overscroll-contain scrollbar-stable"
            data={items}
            context={{ isLoadingOlder: Boolean(isLoadingOlder) }}
            components={TIMELINE_COMPONENTS}
            computeItemKey={(_i, item) => item.key}
            itemContent={itemContent}
            firstItemIndex={firstItemIndex}
            initialTopMostItemIndex={{ index: "LAST", align: "end" }}
            followOutput={followOutput}
            atBottomThreshold={60}
            atBottomStateChange={handleAtBottomStateChange}
            totalListHeightChanged={handleTotalListHeightChanged}
            increaseViewportBy={{ top: 800, bottom: 200 }}
            onScroll={handleScroll}
          />
          {/* Jump-to-present pill, floating over the bottom edge of the list. */}
          {showJumpPill && (
            <div className="absolute bottom-3 inset-x-0 z-10 flex justify-center pointer-events-none">
              <button
                type="button"
                onClick={() => {
                  atBottomRef.current = true;
                  pinToBottomNow();
                }}
                className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-border/60 bg-secondary/90 backdrop-blur px-5 py-2.5 text-sm font-medium text-foreground shadow-lg hover:bg-secondary transition-colors"
                aria-label="Jump to the latest messages"
              >
                <ChevronDown className="size-4" />
                Jump to present
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
