import { Braces, ChevronDown, Copy, Link2, Loader2, Maximize2, MessagesSquare, Minimize2, Pencil, Trash2, X, Zap } from "lucide-react";
import { nip19 } from "nostr-tools";
import { useCallback, useEffect, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";

import { ChatComposer } from "@/components/chat/ChatComposer";
import { ChatContent } from "@/components/chat/ChatContent";
import { ProfilePreviewCard } from "@/components/chat/ProfilePreviewCard";
import { ReactionBar, ReactionPicker } from "@/components/chat/ReactionBar";
import { ZapButton } from "@/components/chat/ZapButton";
import { ZapDialog } from "@/components/chat/ZapDialog";
import { ZapPill } from "@/components/chat/ZapPill";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppContext } from "@/hooks/useAppContext";
import { useAuthor } from "@/hooks/useAuthor";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useScopedDisplayName } from "@/hooks/useScopedDisplayName";
import { isTombstoneRoot } from "@/concord-v2/hooks/useConcord2Threads";
import { ComposerBoundsProvider, getComposerCollisionPadding, useComposerBoundsRef } from "@/contexts/ComposerBoundsContext";
import { getAvatarShape } from "@/lib/avatarShape";
import { shortClockTime } from "@/lib/formatTime";
import { writeClipboardText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

import type { ChatMsg, ChatTransport, MessageReactions, MessageZaps, ZapPayment } from "@/components/chat/transport";
import type { ReactNode, UIEvent } from "react";
import type { FollowOutputScalarType, VirtuosoHandle } from "react-virtuoso";

/**
 * Consecutive replies from the same author within this window collapse into a
 * compact continuation (no repeated avatar/name). Matches the main timeline's
 * `CONTINUATION_WINDOW_SECONDS` in MessageTimeline.
 */
const CONTINUATION_WINDOW_SECONDS = 5 * 60;

/** Stable no-op for a zap-only pill row (no reactions resolved), so the
 * ReactionBar keeps a constant prop instead of a fresh closure per render. */
const NOOP_REACT = () => {};

/** Stable empty list while the thread's replies are still loading. */
const NO_REPLIES: ChatMsg[] = [];

/**
 * Context handed to the virtualizer's Header. The header (root message +
 * divider + spinner) is built per render in ThreadPanel; routing it through
 * `context` keeps the component map itself stable, so the header re-renders in
 * place instead of remounting (which would drop e.g. an in-progress root edit).
 */
interface ThreadListContext {
  header: ReactNode;
}

function ThreadListHeader({ context }: { context?: ThreadListContext }) {
  return <>{context?.header}</>;
}

const THREAD_COMPONENTS = { Header: ThreadListHeader };

/** Always snap to a newly-arrived reply (the panel's long-standing behavior). */
function alwaysFollow(): FollowOutputScalarType {
  return "smooth";
}

/** A single message row inside the thread panel (root or reply). */
function ThreadMessage({
  event,
  reactions,
  zaps,
  zapEnabled = false,
  onSendZap,
  canReact,
  canModerate = false,
  isRumor = false,
  continuation = false,
  onDelete,
  isEditing = false,
  onEdit,
  onEditSubmit,
  onEditCancel,
}: {
  event: ChatMsg;
  reactions?: MessageReactions;
  /** Aggregated zaps for this message (feeds the ⚡ total chip). */
  zaps?: MessageZaps;
  /** Whether this surface supports zaps (shows the ⚡ button on others' messages). */
  zapEnabled?: boolean;
  /** CORD.md announcement publisher (Concord v2); absent = NIP-57 public surface. */
  onSendZap?: (target: ChatMsg, payment: ZapPayment) => Promise<void>;
  canReact: boolean;
  /** Whether the current user may delete others' messages (moderation). */
  canModerate?: boolean;
  /**
   * Whether this message is an unsigned rumor (Concord sealed chat event).
   * Drives the "View event JSON" dialog wording and suppresses "Copy message
   * ID" (a rumor has no relay-addressable event id).
   */
  isRumor?: boolean;
  /**
   * Render as a compact continuation of the previous same-author reply: hides
   * the avatar/name/timestamp header (a hover-revealed clock time replaces the
   * avatar), mirroring the main timeline's continuation collapsing.
   */
  continuation?: boolean;
  /** Delete this message (own always; others' require moderation). Hidden when absent. */
  onDelete?: (event: ChatMsg) => void;
  /** Whether this message is currently in edit mode. */
  isEditing?: boolean;
  /** Begin editing this message (own messages only). */
  onEdit?: (event: ChatMsg) => void;
  /** Submit an inline edit. */
  onEditSubmit?: (event: ChatMsg, content: string) => void;
  /** Cancel editing. */
  onEditCancel?: () => void;
}) {
  const { user } = useCurrentUser();
  const composerBoundsRef = useComposerBoundsRef();
  const author = useAuthor(event.pubkey);
  const metadata = author.data?.metadata;
  const displayName = useScopedDisplayName(event.pubkey, metadata);
  const when = new Date(event.created_at * 1000);

  const [jsonOpen, setJsonOpen] = useState(false);
  const [zapOpen, setZapOpen] = useState(false);
  // A rumor has no signature; strip the synthetic empty `sig` the transport
  // adds for rendering so the JSON view reflects the true rumor shape.
  // Raw event source for the "View event JSON" menu item: a rumor has no
  // signature, so strip the synthetic empty `sig` the transport adds for
  // rendering; a signed event (NIP-29) is shown as-is.
  const sourceJson = isRumor
    ? JSON.stringify((({ sig: _sig, ...rest }) => rest)(event), null, 2)
    : JSON.stringify(event, null, 2);

  // The author can delete their own message; moderators can delete anyone's
  // (mirrors ChatMessage's gating). The transport decides how.
  const isOwn = user?.pubkey === event.pubkey;
  const canDelete = Boolean(onDelete) && (isOwn || canModerate);
  // Own messages are editable when the transport supports it. The transport
  // only provides editMessage for kinds it can edit, so no kind check needed.
  const canEdit = isOwn && Boolean(onEdit);
  const [editText, setEditText] = useState(event.content);
  // Sync edit text when entering edit mode (content may have changed).
  useEffect(() => {
    if (isEditing) setEditText(event.content);
  }, [isEditing, event.content]);
  // Zap gating mirrors ChatMessage: shown on others' messages when the surface
  // supports zaps; disabled once the author's profile loads with no lightning
  // address.
  const canZap = Boolean(zapEnabled && user && !isOwn);
  const zapDisabled = Boolean(author.data && !metadata?.lud16 && !metadata?.lud06);

  return (
    <>
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className={cn(
          "group/threadmsg relative flex items-start gap-3 px-2.5 rounded hover:bg-secondary/40 transition-colors",
          continuation ? "py-0.5" : "py-1.5",
        )}>
          {continuation ? (
            <span className="shrink-0 w-9 self-stretch flex items-start justify-end pr-0.5 pt-0.5 text-[10px] leading-none text-muted-foreground/60 opacity-0 group-hover/threadmsg:opacity-100 transition-opacity tabular-nums select-none">
              {shortClockTime(event.created_at)}
            </span>
          ) : (
            <ProfilePreviewCard pubkey={event.pubkey}>
              <button type="button" className="shrink-0 mt-0.5 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Avatar shape={getAvatarShape(metadata)} className="size-9 cursor-pointer transition-opacity hover:opacity-90">
                  <AvatarImage src={metadata?.picture} alt={displayName} />
                  <AvatarFallback className="bg-primary/20 text-primary text-sm">
                    {displayName[0]?.toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </button>
            </ProfilePreviewCard>
          )}
          <div className="flex-1 min-w-0">
            {!continuation && (
              <div className="flex items-baseline gap-2">
                <ProfilePreviewCard pubkey={event.pubkey}>
                  <button type="button" className="text-[15px] font-semibold text-primary truncate hover:underline focus:outline-none">
                    {displayName}
                  </button>
                </ProfilePreviewCard>
                <span className="text-[11px] text-muted-foreground/70 shrink-0" title={when.toLocaleString()}>
                  {when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                </span>
              </div>
            )}
            {isEditing ? (
              <div className="mt-0.5">
                <textarea
                  autoFocus
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      onEditSubmit?.(event, editText);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      onEditCancel?.();
                    }
                  }}
                  rows={Math.min(6, Math.max(1, editText.split("\n").length))}
                  className="w-full resize-none rounded-md bg-background border border-input px-2 py-1.5 text-[15px] focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <div className="flex items-center gap-2 touch:gap-4 mt-1 text-[11px] text-muted-foreground">
                  <button
                    type="button"
                    className="font-semibold text-primary hover:underline touch:py-2"
                    onClick={() => onEditSubmit?.(event, editText)}
                  >
                    Save
                  </button>
                  <button type="button" className="hover:text-foreground touch:py-2" onClick={() => onEditCancel?.()}>
                    Cancel
                  </button>
                  <span className="opacity-70">escape to cancel · enter to save</span>
                </div>
              </div>
            ) : (
              <ChatContent event={event} className="text-[15px]" />
            )}
            {((zaps && zaps.tally.count > 0) || (reactions && reactions.tallies.length > 0)) && (
              <ReactionBar
                tallies={reactions?.tallies ?? []}
                canReact={canReact}
                onReact={reactions?.react ?? NOOP_REACT}
                leading={
                  zaps && zaps.tally.count > 0 ? (
                    <ZapPill
                      tally={zaps.tally}
                      canZap={canZap && !zapDisabled}
                      onZap={() => setZapOpen(true)}
                    />
                  ) : undefined
                }
              />
            )}
          </div>
          {(canReact && reactions && !isEditing) || (canZap && !isEditing) || (canEdit && !isEditing) ? (
            // Hover-revealed on desktop. On touch there's no hover, so the
            // buttons sit statically at the row's end instead — the long-press
            // menu alone would leave reacting undiscoverable.
            <div className="absolute right-1.5 top-1 flex items-center opacity-0 group-hover/threadmsg:opacity-100 focus-within:opacity-100 transition-opacity touch:static touch:opacity-100 touch:shrink-0">
              {canEdit && !isEditing && (
                <button type="button" className="rounded-md p-1.5 touch:p-2.5 hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors" onClick={() => onEdit?.(event)} aria-label="Edit message">
                  <Pencil className="size-4" />
                </button>
              )}
              {canReact && reactions && !isEditing && <ReactionPicker onReact={reactions.react} />}
              {canZap && !isEditing && <ZapButton disabled={zapDisabled} onOpen={() => setZapOpen(true)} />}
            </div>
          ) : null}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52" collisionPadding={getComposerCollisionPadding(composerBoundsRef)}>
        {canZap && !zapDisabled && (
          <ContextMenuItem onSelect={() => setZapOpen(true)}>
            <Zap className="mr-2 size-4" /> Zap message
          </ContextMenuItem>
        )}
        <ContextMenuItem onSelect={() => writeClipboardText(event.content).catch(() => undefined)}>
          <Copy className="mr-2 size-4" /> Copy text
        </ContextMenuItem>
        {!isRumor && (
          <ContextMenuItem
            onSelect={() => {
              try {
                writeClipboardText(
                  `nostr:${nip19.neventEncode({ id: event.id, author: event.pubkey })}`,
                ).catch(() => undefined);
              } catch {
                writeClipboardText(event.id).catch(() => undefined);
              }
            }}
          >
            <Link2 className="mr-2 size-4" /> Copy message ID
          </ContextMenuItem>
        )}
        <ContextMenuItem onSelect={() => setJsonOpen(true)}>
          <Braces className="mr-2 size-4" /> View event JSON
        </ContextMenuItem>
        {canDelete && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => onDelete?.(event)}
            >
              <Trash2 className="mr-2 size-4" /> Delete message
            </ContextMenuItem>
          </>
        )}
        {canEdit && !isEditing && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => onEdit?.(event)}>
              <Pencil className="mr-2 size-4" /> Edit message
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
    {zapOpen && (
      <ZapDialog open={zapOpen} onOpenChange={setZapOpen} target={event} sendZap={onSendZap} />
    )}
    <Dialog open={jsonOpen} onOpenChange={setJsonOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Event JSON</DialogTitle>
          <DialogDescription>
            {isRumor
              ? "The raw, unsigned rumor for this message."
              : "The raw signed event for this message."}
          </DialogDescription>
        </DialogHeader>
        <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-3 text-xs leading-relaxed">
          {sourceJson}
        </pre>
        <div className="flex justify-end">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => writeClipboardText(sourceJson).catch(() => undefined)}
          >
            <Copy className="mr-2 size-4" /> Copy JSON
          </Button>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}

interface ThreadPanelProps {
  /** The root chat message this thread hangs off. */
  root: ChatMsg;
  /** The room's transport — supplies the replies, reply-send, and reactions. */
  transport: ChatTransport;
  /**
   * NIP-29 composer context: the group's host relay + `h`-tag id. Concord
   * transports send replies via {@link ChatTransport.sendThreadReply} and don't
   * use these (they pass placeholder values).
   */
  relayUrl: string;
  /** Whether this conversation may offer bot commands (see ChatComposer). */
  botCommands?: boolean;
  /** Relays this conversation uses, for bot-manifest discovery (see ChatComposer). */
  conversationRelays?: string[];
  groupId: string;
  /** Whether the current user can post replies. */
  canWrite: boolean;
  /**
   * Explicit @-mention roster for the reply composer. Required for Concord
   * transports (`relayUrl="dm"` has no NIP-29 group to derive members from);
   * NIP-29 callers can omit it and the composer derives the roster itself.
   */
  mentionPubkeys?: string[];
  /** Focus the reply input on open (e.g. when launched via /thread). */
  autoFocus?: boolean;
  onClose: () => void;
  /** Called when the expand/collapse state changes. Parent uses this to resize the container. */
  onExpandChange?: (expanded: boolean) => void;
}

/**
 * Side panel showing a message thread: the root message, its replies, and a
 * composer for posting a new reply. Sits beside the channel timeline
 * (Slack/Discord style). It is transport-driven — NIP-29, Concord V1, and
 * Concord V2 all render through it, each supplying its own replies + reply-send
 * via the {@link ChatTransport} (`threadRepliesFor`/`sendThreadReply`), so
 * replies never appear in the main timeline (they're nested here instead).
 */
export function ThreadPanel({ root, transport, relayUrl, groupId, canWrite, mentionPubkeys, botCommands, conversationRelays, autoFocus = false, onClose, onExpandChange }: ThreadPanelProps) {
  const replies = transport.threadRepliesFor?.(root.id) ?? [];
  const isLoading = transport.threadLoading?.(root.id) ?? false;
  const { config } = useAppContext();
  const reactionsFor = transport.reactionsFor;
  const zapsFor = transport.zapsFor;
  const zapEnabled = config.zapsEnabled && Boolean(transport.zapsFor);
  const onSendZap = transport.sendZap;
  const isRumor = transport.isRumor ?? false;
  const canModerate = transport.canModerate;
  const onDelete = transport.deleteMessage;
  const editMessage = transport.editMessage;
  const composerBoundsRef = useRef<HTMLElement | null>(null);

  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [isExpanded, setIsExpanded] = useState(false);

  // Notify parent when expand state changes so it can resize the container.
  useEffect(() => {
    onExpandChange?.(isExpanded);
  }, [isExpanded, onExpandChange]);

  const handleEditSubmit = (original: ChatMsg, content: string) => {
    const trimmed = content.trim();
    if (!trimmed || trimmed === original.content.trim()) {
      setEditingId(undefined);
      return;
    }
    setEditingId(undefined);
    void editMessage?.(original, trimmed);
  };

  // --- Auto-scroll + jump-to-latest ---
  // The list is virtualized (react-virtuoso): it mounts at the newest reply
  // (`initialTopMostItemIndex`, re-applied per root via the `key`), and
  // `followOutput` snaps to newly-arrived replies.
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  const scrollToBottom = useCallback(() => {
    virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end", behavior: "smooth" });
    setShowJumpToLatest(false);
  }, []);

  const handleScroll = useCallback((e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowJumpToLatest(distanceFromBottom > 120);
  }, []);

  // Scrolls with the content above the replies: the root message (or its
  // tombstone), the reply-count divider, and the loading spinner.
  const listHeader = (
    <>
      {isTombstoneRoot(root) ? (
        <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground/70">
          <MessagesSquare className="size-4 shrink-0" />
          <span className="italic">Original message not loaded — it may be older than the channel window.</span>
        </div>
      ) : (
        <ThreadMessage event={root} reactions={reactionsFor?.(root.id)} zaps={zapsFor?.(root.id)} zapEnabled={zapEnabled} onSendZap={onSendZap} canReact={canWrite} canModerate={canModerate} isRumor={isRumor} onDelete={onDelete} isEditing={editingId === root.id} onEdit={(e) => setEditingId(e.id)} onEditSubmit={handleEditSubmit} onEditCancel={() => setEditingId(undefined)} />
      )}
      <div className="flex items-center gap-2 px-3 py-1 mt-1">
        <div className="h-px flex-1 bg-border/60" />
        {!isLoading && (
          <span className="text-[11px] text-muted-foreground/60 shrink-0">
            {replies.length === 0
              ? "No replies yet"
              : `${replies.length} ${replies.length === 1 ? "reply" : "replies"}`}
          </span>
        )}
        <div className="h-px flex-1 bg-border/60" />
      </div>
      {isLoading && (
        <div className="flex justify-center py-6">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      )}
    </>
  );

  return (
    <ComposerBoundsProvider value={composerBoundsRef}>
    <aside className={cn(
      "flex flex-col min-h-0 flex-1 min-w-0 m-2 sidebar:my-3 sidebar:mr-2 sidebar:ml-0 p-1.5 clip-corner-lg bg-chrome",
    )}>
      <div className="flex items-center justify-between px-2 py-1 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <MessagesSquare className="size-4 text-muted-foreground shrink-0" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground truncate">
            Thread{replies.length > 0 ? ` · ${replies.length}` : ""}
          </h3>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" aria-label={isExpanded ? "Collapse thread" : "Expand thread"} className="size-6 touch:size-10 hidden md:inline-flex" onClick={() => setIsExpanded(v => !v)}>
            {isExpanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </Button>
          <Button variant="ghost" size="icon" aria-label="Close thread" className="size-6 touch:size-10" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 relative">
        <Virtuoso<ChatMsg, ThreadListContext>
          key={root.id}
          ref={virtuosoRef}
          className="h-full overflow-x-clip overscroll-contain scrollbar-stable"
          data={isLoading ? NO_REPLIES : replies}
          context={{ header: listHeader }}
          components={THREAD_COMPONENTS}
          computeItemKey={(_i, reply) => reply.id}
          followOutput={alwaysFollow}
          initialTopMostItemIndex={{ index: "LAST", align: "end" }}
          increaseViewportBy={{ top: 400, bottom: 200 }}
          onScroll={handleScroll}
          itemContent={(index, reply) => {
            // Collapse consecutive same-author replies within a short window into
            // a compact continuation, mirroring the main timeline. The root never
            // continues into the first reply (they're separated by the divider).
            const prev = replies[index - 1];
            const continuation =
              !!prev &&
              prev.pubkey === reply.pubkey &&
              reply.created_at - prev.created_at < CONTINUATION_WINDOW_SECONDS;
            return (
              <div className="pt-1">
                <ThreadMessage event={reply} reactions={reactionsFor?.(reply.id)} zaps={zapsFor?.(reply.id)} zapEnabled={zapEnabled} onSendZap={onSendZap} canReact={canWrite} canModerate={canModerate} isRumor={isRumor} continuation={continuation} onDelete={onDelete} isEditing={editingId === reply.id} onEdit={(e) => setEditingId(e.id)} onEditSubmit={handleEditSubmit} onEditCancel={() => setEditingId(undefined)} />
              </div>
            );
          }}
        />
        {showJumpToLatest && (
          <div className="absolute bottom-3 inset-x-0 z-10 flex justify-center pointer-events-none">
            <button
              type="button"
              onClick={scrollToBottom}
              className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-secondary/90 backdrop-blur px-4 py-2 text-xs font-medium text-foreground shadow-lg hover:bg-secondary transition-colors"
              aria-label="Jump to latest replies"
            >
              <ChevronDown className="size-4" />
              Jump to latest
            </button>
          </div>
        )}
      </div>

      {canWrite ? (
        <ChatComposer
          relayUrl={relayUrl}
          botCommands={botCommands}
          conversationRelays={conversationRelays}
          groupId={groupId}
          messages={[]}
          mentionPubkeys={mentionPubkeys}
          placeholder="Reply in thread…"
          draftScope={`thread:${root.id}`}
          autoFocus={autoFocus}
          sendOverride={async (text, tags) => {
            await transport.sendThreadReply?.(root, text, tags);
          }}
        />
      ) : (
        <div className="p-3 shrink-0 pb-safe">
          <p className="text-xs text-muted-foreground text-center py-1">
            Join this channel to reply.
          </p>
        </div>
      )}
    </aside>
    </ComposerBoundsProvider>
  );
}
