import { AtSign, Ban, ChevronDown, ChevronLeft, Bell, BellOff, Eraser, GitBranch, HandCoins, Hash, HeartPulse, Link as LinkIcon, Loader2, Lock, LogOut, Maximize2, MessagesSquare, Minimize2, Plus, ScrollText, Settings, Shield, Trash2, UserPlus, Users } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { ChatComposer } from "@/components/chat/ChatComposer";
import { ChatMessage, ReplyContextLine, ReplyPreview, ReplyThumbnail } from "@/components/chat/ChatMessage";
import { firstImageRef, getQuoteReplyToId } from "@/components/chat/messageHelpers";
import { LoginArea } from "@/components/auth/LoginArea";
import { JoinButton } from "@/components/auth/JoinButton";
import { MemberList } from "@/components/chat/MemberList";
import { MessageTimeline, type MessageTimelineHandle } from "@/components/chat/MessageTimeline";
import { ThreadPanel } from "@/components/chat/ThreadPanel";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { CommunityInfoDialog2 } from "@/concord-v2/components/CommunityInfoDialog2";
import { DisappearTimerButton2 } from "@/concord-v2/components/DisappearTimerButton2";
import { FundView2 } from "@/concord-v2/components/FundView2";
import { ProjectWorkspace2 } from "@/concord-v2/components/ProjectWorkspace2";
import { ImageLightbox2 } from "@/concord-v2/components/ImageLightbox2";
import { InviteDialog2 } from "@/concord-v2/components/InviteDialog2";
import { RolesDialog2 } from "@/concord-v2/components/RolesDialog2";
import { AuditLogView } from "@/concord-v2/components/AuditLogView2";
import { BannedView } from "@/concord-v2/components/BannedView2";
import { useBanSelfRemove2 } from "@/concord-v2/hooks/useBanSelfRemove2";
import { useLinkAuthorityWatch2, useSingleUseSweep2 } from "@/concord-v2/hooks/useInvites2";
import { InvitesView } from "@/concord-v2/components/InvitesView2";
import { DebugHealView } from "@/concord-v2/components/DebugHealView2";
import { ChannelSidebarView } from "@/components/layout/ChannelSidebarView";
import { SwipeReveal } from "@/components/layout/SwipeReveal";
import { SyncStatusIndicator } from "@/components/SyncStatusIndicator";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { openUrl } from "@/lib/downloadFile";
import { sanitizeUrl } from "@/lib/sanitizeUrl";
import { ChannelNavContext } from "@/contexts/ChannelNavContext";
import { useLayoutOptions } from "@/contexts/LayoutContext";
import { ComposerBoundsProvider } from "@/contexts/ComposerBoundsContext";
import { useAppContext } from "@/hooks/useAppContext";
import { useActiveRoom } from "@/hooks/useActiveRoom";
import { useChannelNavValue } from "@/hooks/useChannelNav";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useIsTouch } from "@/hooks/useIsMobile";
import { useAuthor } from "@/hooks/useAuthor";
import { useScopedDisplayName } from "@/hooks/useScopedDisplayName";
import { useDelayedFlag } from "@/hooks/useDelayedFlag";
import { useSyncTasks } from "@/hooks/useSyncActivity";
import { concordChannelMuteKey, useMutes } from "@/hooks/useMutes";
import { useNotifLevels, concordChannelScopeKey } from "@/hooks/useNotifLevels";
import { useWot } from "@/hooks/useWot";
import { NotifLevelMenu } from "@/components/NotifLevelMenu";
import { toast } from "@/hooks/useToast";
import { useCommunity2, useIsExcluded2 } from "@/concord-v2/hooks/useCommunityList2";
import { useCommunityManagement2, useStrandedRecovery2 } from "@/concord-v2/hooks/useCommunityActions2";
import { useChannels2, useControlFold2, useDissolved2 } from "@/concord-v2/hooks/useControlPlane2";
import { BanMemberDialog } from "@/concord-v2/components/BanMemberDialog2";
import { PurgeCommunityDialog2 } from "@/concord-v2/components/PurgeCommunityDialog2";
import { isAdminPubkey } from "@/lib/admins";
import type { BanPhase } from "@/concord-v2/hooks/useModeration2";
import { hasForeignLiveLinks } from "@/concord-v2/lib/control";
import { useDecryptedImage2 } from "@/concord-v2/hooks/useDecryptedImage2";
import { useGuestbook2 } from "@/concord-v2/hooks/useGuestbook2";
import { useModeration2, useReadCutRetry2 } from "@/concord-v2/hooks/useModeration2";
import { useChannelRekeyWatch2, useLinkRefreshWatch2, useRekeyWatch2 } from "@/concord-v2/hooks/useRekey2";
import { useRelayFollow2 } from "@/concord-v2/hooks/useRelayFollow2";
import { useRoles2 } from "@/concord-v2/hooks/useRoles2";
import { useSendMessage2 } from "@/concord-v2/hooks/useChannel2";
import { useTransport2 } from "@/concord-v2/hooks/useTransport2";
import { useConcord2Unread, type Concord2Unread } from "@/concord-v2/hooks/useConcord2Unread";
import { useConcord2Mentions } from "@/concord-v2/hooks/useConcord2Mentions";
import { useConcord2Threads, type Concord2Thread } from "@/concord-v2/hooks/useConcord2Threads";
import { useTyping2, useTypingPublisher2 } from "@/concord-v2/hooks/useTyping2";
import { completeMemberlist } from "@/concord-v2/lib/guestbook";
import { badgeOf, isAuthorized, Permissions } from "@/concord-v2/lib/roles";
import type { ChannelV2, CommunityV2, ImagePointer } from "@/concord-v2/lib/types";
import { cn, pickDefaultChannel } from "@/lib/utils";
import { getAvatarShape } from "@/lib/avatarShape";
import { shortTimeAgo } from "@/lib/formatTime";
import { partitionMembersByWot } from "@/lib/wotFilter";
import { parseRepoNaddr } from "@/lib/nip34Project";

import { authorsByRecency, threadSummary } from "@/components/chat/transport";
import type { ChatMsg, ChatTransport, MessageReactions, MessageZaps, SendStatus, ZapPayment } from "@/components/chat/transport";

/** Stable empty replies array so a thread-less row keeps a constant prop. */
const EMPTY_REPLIES: ChatMsg[] = [];

/** The community's decrypted icon for the channel-list title. Renders nothing
 *  when the community has no icon (the header falls back to a name-only
 *  layout). */
function TitleIcon2({ icon }: { icon: ImagePointer | undefined }) {
  const url = useDecryptedImage2(icon);
  if (!url) return null;
  return <img src={url} alt="" className="size-6 rounded object-cover shrink-0" />;
}

/** Larger community avatar for the mobile chat header, with an initial fallback. */
function TitleAvatar2({ icon, name }: { icon: ImagePointer | undefined; name: string | undefined }) {
  const url = useDecryptedImage2(icon);
  if (url) {
    return <img src={url} alt="" className="size-8 rounded object-cover shrink-0" />;
  }
  return (
    <div className="size-8 rounded shrink-0 bg-muted text-muted-foreground flex items-center justify-center text-sm font-semibold uppercase">
      {name?.trim()?.[0] ?? "#"}
    </div>
  );
}

function Banner2({ banner }: { banner: ImagePointer | undefined }) {
  const url = useDecryptedImage2(banner);
  const [open, setOpen] = useState(false);
  if (!url) return null;
  return (
    <>
      <button
        type="button"
        className="size-full overflow-hidden cursor-zoom-in"
        aria-label="View banner"
        onClick={() => setOpen(true)}
      >
        <img src={url} alt="" className="size-full object-cover" />
      </button>
      {open && <ImageLightbox2 src={url} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Concord V2 inline-reply context: resolve the replied-to rumor from the
 *  in-memory decoded set (rumors aren't relay-fetchable) and render the shared
 *  "replying to …" chrome. Clicking jumps the timeline to the parent. */
function ReplyContext2({ parent, onJump }: { parent: ChatMsg | undefined; onJump: (id: string) => void }) {
  const author = useAuthor(parent?.pubkey);
  const name = useScopedDisplayName(parent?.pubkey, author.data?.metadata);
  if (!parent) return null;
  const image = firstImageRef(parent);
  return (
    <ReplyContextLine
      name={name}
      preview={<ReplyPreview content={parent.content} hideMediaPlaceholder={!!image} />}
      thumbnail={image ? <ReplyThumbnail image={image} /> : undefined}
      onClick={() => onJump(parent.id)}
    />
  );
}

interface ChatMessage2Props {
  event: ChatMsg;
  reactions: MessageReactions;
  zaps: MessageZaps | undefined;
  onSendZap: ((target: ChatMsg, payment: ZapPayment) => Promise<void>) | undefined;
  /** This message's thread replies (stable ref from the transport), for the badge. */
  replies: ChatMsg[];
  continuation: boolean;
  canWrite: boolean;
  canModerate: boolean;
  sendStatus: SendStatus | undefined;
  active: boolean;
  onToggleActive: (id: string) => void;
  onOpenThread: ((event: ChatMsg) => void) | undefined;
  onReply: ((event: ChatMsg) => void) | undefined;
  /** Resolved "replying to …" line for an inline reply (undefined otherwise). */
  replyContext: ReactNode;
  onDelete: ((event: ChatMsg) => void) | undefined;
  onRetry: ((event: ChatMsg) => void) | undefined;
  onDiscard: ((id: string) => void) | undefined;
  isEditing: boolean;
  onEdit: ((event: ChatMsg) => void) | undefined;
  onEditSubmit: ((event: ChatMsg, content: string) => Promise<void>) | undefined;
  onEditCancel: () => void;
}

/** Memoized per-message binding (mirrors V1's ConcordChatMessage). A normal
 *  reply quotes the parent inline (`onReply`); "reply in thread" opens the
 *  thread panel (`onOpenThread`). */
const ChatMessage2 = memo(function ChatMessage2({
  event,
  reactions,
  zaps,
  onSendZap,
  replies,
  continuation,
  canWrite,
  canModerate,
  sendStatus,
  active,
  onToggleActive,
  onOpenThread,
  onReply,
  replyContext,
  onDelete,
  onRetry,
  onDiscard,
  isEditing,
  onEdit,
  onEditSubmit,
  onEditCancel,
}: ChatMessage2Props) {
  const threadInfo = threadSummary(replies);
  // Concord V2 messages are unsigned rumors sealed at the channel's stream
  // address — there's no relay-addressable event id, so the "Copy message ID" /
  // "View on 2140.wtf" off-ramps are nonsensical. Pass the rumor through so the
  // context menu offers "View event JSON" instead. Drop the synthetic empty
  // `sig` the transport adds for rendering (a rumor has no signature).
  const rumor = useMemo(() => {
    const { sig: _sig, ...rest } = event;
    return rest;
  }, [event]);
  return (
    <ChatMessage
      event={event}
      rumor={rumor}
      canWrite={canWrite}
      canModerate={canModerate}
      reactions={reactions}
      zapEnabled={Boolean(onSendZap)}
      zaps={zaps}
      onSendZap={onSendZap}
     
      sendStatus={sendStatus}
      continuation={continuation}
      active={active}
      onToggleActive={onToggleActive}
      replyCount={replies.length}
      threadParticipants={threadInfo.participants}
      lastReplyAt={threadInfo.lastReplyAt}
      onOpenThread={onOpenThread}
      onReply={onReply}
      replyContext={replyContext}
      onDelete={onDelete}
      onRetry={onRetry ? () => onRetry(event) : undefined}
      onDiscard={onDiscard ? () => onDiscard(event.id) : undefined}
      isEditing={isEditing}
      onEdit={onEdit}
      onEditSubmit={onEditSubmit}
      onEditCancel={onEditCancel}
    />
  );
});

/**
 * The pinned footer for the V2 channel sidebar: the account area. Each
 * rendered instance (desktop pane + mobile drawer) renders its own copy.
 * (Armada also portaled a persistent voice call-bar here; voice is not part
 * of the ₿AO build.)
 */
function SidebarFooter2() {
  const { user } = useCurrentUser();
  return (
    <div className="px-3 pb-safe shrink-0">
      {user ? (
        <div className="pb-2">
          <LoginArea className="w-full flex" />
        </div>
      ) : (
        <div className="p-2 flex justify-center">
          <JoinButton className="w-full max-w-xs clip-corner-lg font-medium" />
        </div>
      )}
    </div>
  );
}

function ChannelRow2({
  community,
  channel,
  active,
  unread,
  onSelect,
}: {
  community: CommunityV2 | undefined;
  channel: ChannelV2;
  active: boolean;
  unread?: Concord2Unread;
  onSelect: () => void;
}) {
  const { isConcordChannelMuted } = useMutes();
  const { concordChannelLevel, setLevel: setNotifLevel } = useNotifLevels();
  const muted = community
    ? isConcordChannelMuted("c2", community.idHex, channel.idHex)
    : false;

  const Icon = channel.isPrivate ? Lock : Hash;
  const hasUnread = Boolean(unread);
  const hasMention = Boolean(unread?.mention);
  return (
    <ContextMenu>
      <ContextMenuTrigger className="block">
        <div
          className={cn(
            "group/row relative flex w-full items-center",
            !active && "hover:bg-foreground/5 clip-corner-lg",
            active && "clip-corner-lg bg-primary text-primary-foreground",
          )}
        >
          <button
            type="button"
            onClick={() => {
              onSelect();
            }}
            className={cn(
              // Slack-style selection: the active channel sits on a filled primary
              // rectangle with the house cut-corner chamfer (matches ChannelSidebar).
              "flex flex-1 min-w-0 items-center gap-2 pl-3 pr-2 py-1.5 touch:py-3 text-sm transition-colors text-left",
              !active && "text-muted-foreground group-hover/row:text-foreground",
              // Unread (but not selected) channels read brighter + bold (Slack).
              // Muted channels never bold — their unread is deliberately silent.
              !active && hasUnread && !muted && "text-foreground font-semibold",
              // Muted channels read dimmer (Discord-style).
              !active && muted && "opacity-60",
              active && "font-medium",
            )}
          >
            <Icon className="size-4 shrink-0" />
            <span className="truncate flex-1 min-w-0">{channel.name}</span>
            {muted && <BellOff className="size-3 shrink-0 opacity-60" aria-label="Muted" />}
            {/* Mention indicator: an "@" pill. Plain unread is conveyed by the row's
                brighter + bold text (no dot). */}
            {hasMention ? (
              <span
                className="shrink-0 flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold leading-none"
                aria-label="You were mentioned"
              >
                @
              </span>
            ) : null}
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        {community && (
          <NotifLevelMenu
            label="Channel notifications"
            level={concordChannelLevel("c2", community.idHex, channel.idHex)}
            onChange={(lvl) =>
              setNotifLevel(concordChannelScopeKey("c2", community.idHex, channel.idHex), lvl)
            }
          />
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * The community-wide "@ Mentions" pane: every cached kind-9 message that
 * p-tags the current user, across all channels, newest-first — read purely
 * from the local decrypted rumor cache. Each message is grouped under a header
 * naming its source channel; clicking a mention jumps to that message in its
 * channel. The rows reuse the shared `ChatMessage` shell (read-only — no
 * react/reply/delete in this aggregate view).
 */
function MentionsView({
  channels,
  mentions,
  isLoading,
  onJump,
}: {
  channels: ChannelV2[];
  mentions: ChatMsg[];
  isLoading: boolean;
  onJump: (channelIdHex: string, messageId: string) => void;
}) {
  const nameByChannel = useMemo(() => {
    const m = new Map<string, ChannelV2>();
    for (const c of channels) m.set(c.idHex, c);
    return m;
  }, [channels]);

  if (mentions.length === 0) {
    return (
      <p className="px-2 py-8 text-center text-sm text-muted-foreground">
        {isLoading ? "Loading mentions…" : "No mentions yet. When someone @-mentions you, it'll show up here."}
      </p>
    );
  }

  return (
    <div className="flex flex-col py-2 px-2">
      {mentions.map((msg) => {
        const channelIdHex = msg.tags.find((t) => t[0] === "channel")?.[1] ?? "";
        const ch = nameByChannel.get(channelIdHex);
        return (
          <div key={msg.id} className="pb-1">
            <div className="flex items-center gap-1 px-3 pt-2 pb-0.5 text-xs font-medium text-muted-foreground">
              {ch?.isPrivate ? (
                <Lock className="size-3 shrink-0" />
              ) : (
                <Hash className="size-3 shrink-0" />
              )}
              <span className="truncate">{ch?.name ?? "unknown channel"}</span>
            </div>
            <MentionMessage
              event={msg}
              onJump={ch ? () => onJump(channelIdHex, msg.id) : undefined}
            />
          </div>
        );
      })}
    </div>
  );
}

/**
 * A single read-only mention row (unsigned rumor → "View event JSON" menu).
 * The row is a button that jumps to the message in its channel; the inner
 * `ChatMessage`'s own controls (context menu, links) stop propagation so they
 * still work, and text remains selectable.
 */
const MentionMessage = memo(function MentionMessage({
  event,
  onJump,
}: {
  event: ChatMsg;
  onJump?: () => void;
}) {
  const rumor = useMemo(() => {
    const { sig: _sig, ...rest } = event;
    return rest;
  }, [event]);
  return (
    <div
      role={onJump ? "button" : undefined}
      tabIndex={onJump ? 0 : undefined}
      onClick={onJump ? () => onJump() : undefined}
      onKeyDown={
        onJump
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onJump();
              }
            }
          : undefined
      }
      className={cn("clip-corner-lg", onJump && "cursor-pointer hover:bg-foreground/5 transition-colors")}
      aria-label={onJump ? "Jump to this message" : undefined}
    >
      <ChatMessage event={event} rumor={rumor} canWrite={false} canModerate={false} />
    </div>
  );
});

/**
 * The community-wide "Threads" pane: every thread the current user has
 * participated in (authored the root or a reply), newest-reply first, read
 * purely from the local rumor cache. Each row shows the thread root plus a
 * reply summary; clicking it switches to that channel and opens the thread
 * panel. Unread rows (a newer reply than last opened) light up.
 */
function ThreadsView({
  channels,
  threads,
  isLoading,
  onOpen,
}: {
  channels: ChannelV2[];
  threads: Concord2Thread[];
  isLoading: boolean;
  onOpen: (thread: Concord2Thread) => void;
}) {
  const nameByChannel = useMemo(() => {
    const m = new Map<string, ChannelV2>();
    for (const c of channels) m.set(c.idHex, c);
    return m;
  }, [channels]);

  if (threads.length === 0) {
    return (
      <p className="px-2 py-8 text-center text-sm text-muted-foreground">
        {isLoading
          ? "Loading threads…"
          : "No threads yet. Threads you start or reply in will show up here."}
      </p>
    );
  }

  return (
    <div className="flex flex-col py-2 px-2">
      {threads.map((t) => {
        const ch = nameByChannel.get(t.channelIdHex);
        return (
          <div key={t.root.id} className="pb-1">
            <div className="flex items-center gap-1 px-3 pt-2 pb-0.5 text-xs font-medium text-muted-foreground">
              {ch?.isPrivate ? (
                <Lock className="size-3 shrink-0" />
              ) : (
                <Hash className="size-3 shrink-0" />
              )}
              <span className="truncate">{ch?.name ?? "unknown channel"}</span>
              {t.hasNew ? (
                <span
                  className="ml-1 shrink-0 size-1.5 rounded-full bg-primary"
                  aria-label="New replies"
                />
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => onOpen(t)}
              className={cn(
                "block w-full text-left clip-corner-lg cursor-pointer hover:bg-foreground/5 transition-colors",
                t.hasNew && "bg-primary/5",
              )}
              aria-label="Open thread"
            >
              <ThreadRootPreview event={t.root} />
              <div className="flex items-center gap-2 pl-[3.875rem] pr-3 pb-1.5 -mt-1">
                <ThreadReplyAvatars pubkeys={t.participants} />
                <span
                  className={cn(
                    "text-xs font-medium",
                    t.hasNew ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  {t.replyCount} {t.replyCount === 1 ? "reply" : "replies"}
                </span>
                <span className="text-xs text-muted-foreground">· {shortTimeAgo(t.lastReplyAt)}</span>
              </div>
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** The thread root message, read-only (its click is handled by the row wrapper). */
const ThreadRootPreview = memo(function ThreadRootPreview({ event }: { event: ChatMsg }) {
  const rumor = useMemo(() => {
    const { sig: _sig, ...rest } = event;
    return rest;
  }, [event]);
  return (
    <div className="pointer-events-none">
      <ChatMessage event={event} rumor={rumor} canWrite={false} canModerate={false} />
    </div>
  );
});

/** A small newest-first avatar stack of the thread's repliers. */
function ThreadReplyAvatars({ pubkeys }: { pubkeys: string[] }) {
  const shown = pubkeys.slice(0, 4);
  if (shown.length === 0) return null;
  return (
    <div className="flex -space-x-1.5">
      {shown.map((pk) => (
        <ThreadReplyAvatar key={pk} pubkey={pk} />
      ))}
    </div>
  );
}

function ThreadReplyAvatar({ pubkey }: { pubkey: string }) {
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;
  const name = metadata?.name ?? pubkey.slice(0, 8);
  return (
    <Avatar shape={getAvatarShape(metadata)} className="size-5 ring-2 ring-chrome" title={name}>
      <AvatarImage src={metadata?.picture} alt={name} />
      <AvatarFallback className="bg-primary/20 text-primary text-[9px] font-semibold uppercase">
        {name.slice(0, 1)}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * A Concord V2 community — CORD-01..06 Private Streams over interchangeable
 * relays, no host, no `#z` tags: every plane is kind-1059 traffic at derived
 * stream addresses. Lives at `/bao/c/:communityId`, rehydrated from the
 * self-encrypted Community List. Renders through the SAME shared chat
 * components as NIP-29 / DMs / Concord V1; only the transport differs.
 */
export function ConcordV2Page() {
  // Full-bleed chat surface: take the whole center column (no widget rail),
  // like the map pages, and manage scrolling internally.
  useLayoutOptions({ noMaxWidth: true, noOverscroll: true, rightSidebar: null });
  const { communityId, channelId: routeChannelId } = useParams<{ communityId: string; channelId: string }>();
  const { user } = useCurrentUser();
  const isTouchDevice = useIsTouch();
  const composerBoundsRef = useRef<HTMLElement | null>(null);
  const { config, updateConfig } = useAppContext();
  const { mutedChannels, isCommunityMuted, toggleCommunityMute, toggleConcordChannelMute } = useMutes();
  const lastChannelKey = communityId ? `c2:${communityId}` : "";

  const baseCommunity = useCommunity2(communityId);
  const { data: folded } = useControlFold2(baseCommunity);
  const projectPointer = useMemo(() => parseRepoNaddr(folded?.metadata?.repo_naddr), [folded?.metadata?.repo_naddr]);
  // Overlay the folded, owner-controlled metadata onto the bundle preview.
  const community = useMemo<CommunityV2 | undefined>(() => {
    if (!baseCommunity) return undefined;
    if (!folded?.metadata) return baseCommunity;
    return { ...baseCommunity, name: folded.metadata.name || baseCommunity.name };
  }, [baseCommunity, folded]);
  const channels = useChannels2(baseCommunity);
  // Only show channel skeletons if there's nothing to render yet AND that has
  // lasted long enough to be worth a placeholder. On a cache hit the bundle
  // resolves within a frame or two, so the skeleton would otherwise flash for a
  // nanosecond — which reads as a glitch. Delay it so fast loads show nothing.
  const showChannelSkeleton = useDelayedFlag(!community || channels.length === 0);

  // Per-channel unread badges, computed purely from the local rumor cache
  // (which the wire keeps fed for every channel of every community).
  const { byChannel: unreadByChannel, markRead: markChannelRead } = useConcord2Unread(channels);

  // Community-wide "@ Mentions" — every cached kind-9 that p-tags the user,
  // across all channels, served from the local rumor cache only. Its unread
  // indicator has its OWN read state (not the channel read state), so opening
  // the Mentions tab clears it without visiting every mentioning channel
  // (issue #53; see the auto-mark effect below).
  const {
    mentions,
    isLoading: mentionsLoading,
    hasNew: hasUnreadMention,
    markAllRead: markAllMentionsRead,
  } = useConcord2Mentions(channels, community?.idHex);

  // Community-wide "Threads" — threads the user participated in (authored the
  // root or a reply), newest-reply first, from the local rumor cache only.
  // Lights up when any has replies newer than the user last opened it; opening
  // the Threads pane marks everything in it read (see the auto-mark effect
  // below).
  const {
    threads,
    isLoading: threadsLoading,
    hasNew: hasNewThreadReplies,
    markRead: markThreadRead,
    markAllRead: markAllThreadsRead,
  } = useConcord2Threads(channels);

  // Authenticate the connection as this community's per-channel stream keys
  // (control/guestbook/dissolved keys are registered app-wide in MainLayout).

  // React to base-rekey rotations (adopt the new epoch, or discover removal).
  // `stranded`: a stale invite dropped us onto a superseded epoch with no wire
  // path forward — the link is out of date and only a refresh/Direct Invite heals.
  const { stranded } = useRekeyWatch2(baseCommunity);
  // And per-held-private-channel rotations (CORD-06 §2): adopt fresh channel
  // keys or drop a channel we've been removed from. No-op without any.
  useChannelRekeyWatch2(baseCommunity);
  // Keep our OWN live invite links vending the current epoch (CORD-05 §2), so a
  // rotation on another device / by another admin doesn't leave them stale.
  useLinkRefreshWatch2(baseCommunity);
  // Follow the fold's relay list (CORD-02 §6): a Metadata edition that moves
  // the community's relays re-points this member (and, via the 13302
  // write-back, their other devices) at the new set.
  useRelayFollow2(baseCommunity);
  // Honest-client compliance: a stripped CREATE_INVITE means my own live
  // links must die — only my signer_sk can tombstone their bundles.
  useLinkAuthorityWatch2(baseCommunity);
  // Single-use links die after their first Join: tombstone the bundle the
  // moment the Guestbook shows a Join citing the link's token commitment.
  useSingleUseSweep2(baseCommunity);
  // Durable read-cut: finish a rotating ban's rotation that a relay outage
  // dropped, from the keep-list persisted at ban time. Mounted ONCE here.
  useReadCutRetry2(baseCommunity);
  // Stranded self-heal: while stranded, quietly re-resolve the link we joined
  // through; once its creator refreshes the bundle, merge the fresh epoch in.
  const { canRecover, checking: recoveryChecking, checkNow: recoveryCheckNow } = useStrandedRecovery2(baseCommunity, stranded);

  // Kicked/banned: the community stays on the rail but goes read-only (the
  // composer is swapped for a banner). Cleared automatically if re-included.
  const excluded = useIsExcluded2(communityId);

  const [channelIdHex, setChannelIdHex] = useState<string | null>(routeChannelId ?? null);
  useEffect(() => {
    if (routeChannelId) setChannelIdHex(routeChannelId);
  }, [routeChannelId]);
  // Which pane the main area shows: the selected channel's chat, the
  // community-wide "@ Mentions" list, or the "Threads" list. Selecting a
  // channel returns to chat.
  const [view, setView] = useState<"channel" | "mentions" | "threads" | "fund" | "project" | "audit" | "invites" | "banned" | "health">("channel");
  useEffect(() => {
    if (routeChannelId) setView("channel");
  }, [routeChannelId]);
  const selectChannel = useCallback((idHex: string) => {
    setChannelIdHex(idHex);
    setView("channel");
  }, []);
  // A pending "jump to message" target set by clicking a mention: switch to its
  // channel, then scroll+highlight it once that channel's timeline has loaded
  // it (an effect below fires when the message appears in `allMessages`).
  const [jumpTarget, setJumpTarget] = useState<{ channelIdHex: string; messageId: string } | null>(null);
  const timelineRef = useRef<MessageTimelineHandle | null>(null);
  const jumpToMention = useCallback(
    (channelIdHex: string, messageId: string) => {
      setJumpTarget({ channelIdHex, messageId });
      selectChannel(channelIdHex);
      setChannelsOpen(false);
    },
    [selectChannel],
  );
  // Opening a thread from the Threads tab: switch to its channel, then open the
  // thread panel once that channel's transport has the root loaded (an effect
  // below fires when the root appears in `allMessages`). Marks the thread read
  // and drops its "new" highlight (the auto-mark below keeps rows lit for the
  // visit, but actually opening one means it's been read for real).
  const [pendingThread, setPendingThread] = useState<Concord2Thread | null>(null);
  const openThreadFromList = useCallback(
    (thread: Concord2Thread) => {
      markThreadRead(thread.root.id, thread.lastReplyAt);
      setFreshThreadIds((prev) => {
        if (!prev.has(thread.root.id)) return prev;
        const next = new Set(prev);
        next.delete(thread.root.id);
        return next;
      });
      setPendingThread(thread);
      selectChannel(thread.channelIdHex);
      setChannelsOpen(false);
    },
    [selectChannel, markThreadRead],
  );

  // Having the Mentions pane on screen counts as reading it, same as Threads
  // below: the list is flat and newest-first, so the pane being visible means
  // the newest mention is too — advance the last-seen stamp immediately, and
  // again as new mentions land while the pane stays open. Visibility-gated so
  // a background tab doesn't silently eat the badge. (Unlike Threads there's
  // no per-row "new" highlight to preserve, so no snapshot.)
  useEffect(() => {
    if (view !== "mentions" || !user || !hasUnreadMention) return;
    const stamp = () => {
      if (document.visibilityState === "visible") markAllMentionsRead();
    };
    stamp();
    document.addEventListener("visibilitychange", stamp);
    return () => document.removeEventListener("visibilitychange", stamp);
  }, [view, user, hasUnreadMention, markAllMentionsRead]);

  // Having the Threads pane on screen counts as reading it: every listed
  // thread with unseen replies is marked read (the sidebar dot clears by just
  // looking — no manual "mark all"), immediately and as new replies or the
  // initial scan land while the pane stays open. The rows keep their "new"
  // highlight for the visit, though: `freshThreadIds` snapshots each root as
  // it's auto-cleared so the visual survives the read map advancing, and
  // resets on leaving the pane. Visibility-gated like the channel read stamp
  // below, so a background tab doesn't silently eat unread threads.
  const [freshThreadIds, setFreshThreadIds] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (view !== "threads") {
      setFreshThreadIds((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }
    if (!user || !hasNewThreadReplies) return;
    const stamp = () => {
      if (document.visibilityState !== "visible") return;
      setFreshThreadIds((prev) => {
        let next: Set<string> | undefined;
        for (const t of threads) {
          if (t.hasNew && !prev.has(t.root.id)) (next ??= new Set(prev)).add(t.root.id);
        }
        return next ?? prev;
      });
      markAllThreadsRead();
    };
    stamp();
    document.addEventListener("visibilitychange", stamp);
    return () => document.removeEventListener("visibilitychange", stamp);
  }, [view, user, hasNewThreadReplies, threads, markAllThreadsRead]);

  // What the Threads pane renders: the live list, with the just-auto-cleared
  // roots still lit as "new" for this visit.
  const displayedThreads = useMemo(
    () =>
      threads.map((t) =>
        !t.hasNew && freshThreadIds.has(t.root.id) ? { ...t, hasNew: true } : t,
      ),
    [threads, freshThreadIds],
  );
  // Let `#channel-name` hashtags in chat jump to that local channel.
  const navChannels = useMemo(
    () => channels.map((c) => ({ name: c.name, go: () => selectChannel(c.idHex) })),
    [channels, selectChannel],
  );
  const channelNav = useChannelNavValue(navChannels);

  const channel = useMemo(() => {
    if (channels.length === 0) return undefined;
    if (channelIdHex) return channels.find((c) => c.idHex === channelIdHex) ?? channels[0];
    return pickDefaultChannel(
      channels,
      config.lastChannelByServer?.[lastChannelKey],
      (c) => c.idHex,
      (c) => c.name,
    );
  }, [channels, channelIdHex, config.lastChannelByServer, lastChannelKey]);

  // Individual mute states for the ⋮ menu. Like GroupPage, the side-by-side
  // "Mute channel" / "Mute community" items each reflect only their own scope
  // (no cascade), so a muted community doesn't flip the channel item.
  const channelMuted = Boolean(
    community && channel &&
    mutedChannels.has(concordChannelMuteKey("c2", community.idHex, channel.idHex)),
  );
  const communityMuted = Boolean(community && isCommunityMuted(`c2:${community.idHex}`));

  useEffect(() => {
    if (!lastChannelKey || !channel) return;
    updateConfig((c) =>
      c.lastChannelByServer?.[lastChannelKey] === channel.idHex
        ? c
        : { ...c, lastChannelByServer: { ...c.lastChannelByServer, [lastChannelKey]: channel.idHex } },
    );
  }, [channel, lastChannelKey, updateConfig]);

  const { setTier } = useRoles2(community);
  const ownerHex = folded?.ownerHex ?? community?.owner;
  const iAmOwner = Boolean(user && ownerHex && user.pubkey === ownerHex);
  // The 2140wtf operator can purge any BAO (the relay's write policy honors
  // admin-moderated NIP-09 — see docs/BAO_RELAY_ADMIN_DELETION.md).
  const canPurgeRemote = iAmOwner || isAdminPubkey(user?.pubkey);
  const roster = folded?.roster;
  const canManageRoles = Boolean(user && folded && isAuthorized(folded.roster, user.pubkey, ownerHex, Permissions.MANAGE_ROLES));
  const canManageMetadata = Boolean(user && folded && isAuthorized(folded.roster, user.pubkey, ownerHex, Permissions.MANAGE_METADATA));
  const canManageChannels = Boolean(user && folded && isAuthorized(folded.roster, user.pubkey, ownerHex, Permissions.MANAGE_CHANNELS));
  const canCreateInvite = Boolean(user && folded && isAuthorized(folded.roster, user.pubkey, ownerHex, Permissions.CREATE_INVITE));
  const canKickAny = Boolean(user && folded && isAuthorized(folded.roster, user.pubkey, ownerHex, Permissions.KICK));
  const canBanAny = Boolean(user && folded && isAuthorized(folded.roster, user.pubkey, ownerHex, Permissions.BAN));
  const canModerateMessages = Boolean(user && folded && isAuthorized(folded.roster, user.pubkey, ownerHex, Permissions.MANAGE_MESSAGES));
  // A dissolved community is terminal: the owner has torn it down, so no key
  // rotation or new messages will ever land. Keep it fully readable (members
  // asked to still see the history), but freeze every write path.
  //
  // `excluded` (a moderator rotated the keys without us) and `stranded` (a stale
  // invite dropped us onto a superseded epoch) are equally write-dead: our new
  // messages would be encrypted to keys nobody keeps. All three replace the main
  // composer with a notice; folding them into `canWrite` freezes the same write
  // paths everywhere else too — timeline reply/edit and the thread composer.
  const { data: dissolved } = useDissolved2(community);
  const canWrite = Boolean(user && channel && !dissolved && !excluded && !stranded);

  const { transport: baseTransport, reactionsFor, allMessages } = useTransport2(community, channel, canWrite, canModerateMessages);
  const { mutateAsync: send } = useSendMessage2(community, channel);

  // (useActiveRoom is called below, after `threadRoot` is defined, so it can
  // also pass thread-level keys for notification suppression.)

  // Fulfil a pending mention jump: once the target channel is active AND its
  // timeline has loaded the target message, scroll+highlight it, then clear
  // the target. `scrollToMessage` is a no-op if the row isn't mounted yet, so
  // we retry as `allMessages` grows (backfill) until it lands or the channel
  // changes out from under us.
  useEffect(() => {
    if (!jumpTarget || view !== "channel") return;
    if (channel?.idHex !== jumpTarget.channelIdHex) return;
    if (!allMessages.some((m) => m.id === jumpTarget.messageId)) return;
    const id = jumpTarget.messageId;
    const t = setTimeout(() => timelineRef.current?.scrollToMessage(id), 60);
    setJumpTarget(null);
    return () => clearTimeout(t);
  }, [jumpTarget, view, channel?.idHex, allMessages]);

  // Mark the open channel read up to its newest message while it's on screen —
  // immediately and again on tab refocus (mirrors GroupChat's NIP-29 behavior).
  const channelIdForRead = channel?.idHex;
  useEffect(() => {
    if (!user || !channelIdForRead || allMessages.length === 0) return;
    const latest = allMessages[allMessages.length - 1]?.created_at ?? 0;
    if (latest <= 0) return;
    const stamp = () => {
      if (document.visibilityState === "visible") markChannelRead(channelIdForRead, latest);
    };
    stamp();
    document.addEventListener("visibilitychange", stamp);
    return () => document.removeEventListener("visibilitychange", stamp);
  }, [user, channelIdForRead, allMessages, markChannelRead]);

  const { leave, isLeaving, dissolve, isDissolving, purgeRemote, isPurging, createChannel, isAddingChannel } = useCommunityManagement2(community);
  const { coalesced } = useGuestbook2(community);

  // (Armada's CORD-07 voice join logic lived here; voice is not part of the
  // ₿AO build.)

  const navigateTo = useNavigate();
  // Compliant self-removal: if the folded Banlist names ME, silently tear
  // down the local copy and route to the communities list (CORD-04 §4).
  useBanSelfRemove2(baseCommunity, useCallback(() => navigateTo("/bao/baocommunity"), [navigateTo]));
  const [creatingChannel, setCreatingChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");

  // Close the inline create-channel form when switching communities — the
  // user's MANAGE_CHANNELS permission doesn't carry over.
  useEffect(() => {
    setCreatingChannel(false);
    setNewChannelName("");
    setCommunityMenuOpen(false);
  }, [communityId]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [rolesOpen, setRolesOpen] = useState(false);
  const [banTarget, setBanTarget] = useState<string | null>(null);
  const [purgeOpen, setPurgeOpen] = useState(false);
  // The community-name header menu (Discord-style): expands inline below the
  // header, pushing the channel list down with a height animation.
  const [communityMenuOpen, setCommunityMenuOpen] = useState(false);
  /** Member roster pane. Defaults OFF on touch devices (a landscape phone
   * crosses the 900px breakpoint but is too short to spare the roster width);
   * openable from the header toggle. On real desktop it stays on. */
  const [membersVisible, setMembersVisible] = useState(() => !isTouchDevice);
  const [membersOpen, setMembersOpen] = useState(false);
  // Focus mode: one toggle in the header collapses BOTH side panels — the
  // channel list on the left and the members panel on the right — so the chat
  // column takes the full width. Second click restores.
  const [focusMode, setFocusMode] = useState(false);
  // Mobile: landing on the community root (no channel in the URL) shows the
  // channel list, not a chat pane — selecting a community should let you pick a
  // channel, not auto-dive into one. A deep link with a channel opens chat
  // directly. (On desktop the SwipeReveal is inert — both panes always show.)
  const [channelsOpen, setChannelsOpen] = useState(!routeChannelId);
  // This page instance is reused across community switches (the route pattern
  // is stable), so the initial state above only applies to the first mount.
  // Reset the reveal state to match the destination route *during render* (not
  // in a post-paint effect): switching community navigates to its root
  // (no channel), so `channelsOpen` must already be `true` on the first render
  // after the route change. A lagging effect would paint one frame of the
  // (stale) chat pane first — the "flash of the previous chat" glitch. A deep
  // link with a channel opens chat directly.
  const [navKey, setNavKey] = useState(`${communityId}\u0000${routeChannelId ?? ""}`);
  const curNavKey = `${communityId}\u0000${routeChannelId ?? ""}`;
  if (navKey !== curNavKey) {
    setNavKey(curNavKey);
    setChannelsOpen(!routeChannelId);
  }
  const [threadRoot, setThreadRoot] = useState<ChatMsg | undefined>(undefined);
  const [threadAutoFocus, setThreadAutoFocus] = useState(false);
  const [lastThreadRoot, setLastThreadRoot] = useState<ChatMsg | undefined>(undefined);
  const [threadExpanded, setThreadExpanded] = useState(false);
  // Close the thread panel when the channel or community changes. The scope
  // key includes `communityId` because the page is reused across concord
  // switches (no route `key`), and `channel?.idHex` alone can lag during the
  // transition. `lastThreadRoot` is cleared here (not just via the slide-out
  // timeout) because the timeout only re-runs when `threadRoot` changes; if
  // the panel was already closed, it wouldn't fire.
  const threadScopeKey = `${communityId}\u0000${channel?.idHex ?? ""}`;
  const [threadChannelKey, setThreadChannelKey] = useState(threadScopeKey);
  if (threadChannelKey !== threadScopeKey) {
    setThreadChannelKey(threadScopeKey);
    if (!pendingThread) {
      setThreadRoot(undefined);
      setLastThreadRoot(undefined);
    }
  }
  const [replyTo, setReplyTo] = useState<ChatMsg | undefined>(undefined);
  const [activeId, setActiveId] = useState<string | undefined>(undefined);
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const toggleActive = useCallback((id: string) => setActiveId((cur) => (cur === id ? undefined : id)), []);

  // Tell the native notification service this channel (and, if a thread panel
  // is open, that specific thread) is on screen, so it suppresses redundant
  // tray entries. Cleared on unmount/background. The roomKey shapes must match
  // the service: `c2:<channelIdHex>` for the channel, `c2:<channelIdHex>:t:<rootId>`
  // for a specific open thread.
  useActiveRoom(
    channel?.idHex ? `c2:${channel.idHex}` : undefined,
    channel?.idHex && threadRoot ? `c2:${channel.idHex}:t:${threadRoot.id}` : undefined,
  );

  // Member list: the coalesced Guestbook (joins) ∪ observed authors ∪ roster,
  // minus the banned — the Complete Memberlist (CORD-02 §5).
  const memberAdmins = useMemo(() => {
    const out: Array<{ pubkey: string; roles: string[] }> = [];
    if (ownerHex) out.push({ pubkey: ownerHex, roles: ["owner"] });
    if (roster) {
      for (const g of roster.grants) {
        if (g.member === ownerHex) continue;
        const badge = badgeOf(roster, g.member);
        if (badge) out.push({ pubkey: g.member, roles: [badge] });
      }
    }
    return out;
  }, [roster, ownerHex]);

  const memberPubkeys = useMemo(() => {
    const banned = folded?.banned ?? new Set<string>();
    // Observed authors: newest ms each pubkey was seen publishing. `created_at`
    // is seconds; the Guestbook fold compares against millisecond kick/leave
    // times, so scale up. This lets `completeMemberlist` drop a kicked member
    // whose only presence is stale chat history, while an author still active
    // AFTER their kick correctly re-enters.
    const observed = new Map<string, number>();
    for (const m of allMessages) {
      const seenMs = m.created_at * 1000;
      const prev = observed.get(m.pubkey);
      if (prev === undefined || seenMs > prev) observed.set(m.pubkey, seenMs);
    }
    const set = completeMemberlist(coalesced, observed, banned, folded?.bannedAt);
    for (const g of roster?.grants ?? []) if (g.roleIds.length > 0 && !banned.has(g.member)) set.add(g.member);
    if (ownerHex) set.add(ownerHex);
    if (user && !banned.has(user.pubkey)) set.add(user.pubkey);
    return [...set];
  }, [coalesced, allMessages, roster, ownerHex, user, folded]);

  // ── Web-of-trust agent filter (task #24 phase B) ──────────────────────────
  // Scores from the viewer's follow graph drive (a) the trust dots in the
  // member list and (b) the per-community "filter agents by web of trust"
  // toggle, which collapses out-of-trust members in the roster and hides
  // their timeline messages. Concord V2 has no explicit bot marker on its
  // roster, so the filter applies to every non-exempt member (role holders
  // and the viewer are exempt — see `wotExempt`); it is surfaced as an
  // "agent filter" because agents are who it catches in practice.
  const { scores: wotScores, isSuccess: wotSuccess, data: wotGraphEvents } = useWot(memberPubkeys);
  // Fail open until scores are real: a loading query yields all-zero scores
  // indistinguishable from "unreachable", and an anchor with no kind 3 at all
  // (empty graph) can't tell friends from spam either — both stay unfiltered.
  const wotResolved = wotSuccess && (wotGraphEvents?.length ?? 0) > 0;
  const agentFilterEnabled = Boolean(
    lastChannelKey && config.wotAgentFilterByCommunity?.[lastChannelKey],
  );
  const setAgentFilterEnabled = useCallback(
    (enabled: boolean) => {
      if (!lastChannelKey) return;
      updateConfig((c) => ({
        ...c,
        wotAgentFilterByCommunity: { ...c.wotAgentFilterByCommunity, [lastChannelKey]: enabled },
      }));
    },
    [lastChannelKey, updateConfig],
  );
  // Community-role holders are vouched for by the community's own trust
  // structure (and moderators must always see each other), so they — and the
  // viewer — can never be filtered out.
  const wotExempt = useMemo(() => {
    const set = new Set(memberAdmins.map((a) => a.pubkey));
    if (user) set.add(user.pubkey);
    return set;
  }, [memberAdmins, user]);
  const filteredAgentPubkeys = useMemo(() => {
    if (!agentFilterEnabled) return new Set<string>();
    return new Set(
      partitionMembersByWot(memberPubkeys, wotScores, {
        enabled: true,
        resolved: wotResolved,
        exempt: wotExempt,
      }).filtered,
    );
  }, [agentFilterEnabled, memberPubkeys, wotScores, wotResolved, wotExempt]);

  const openThread = useCallback((event: ChatMsg, focusReply = false) => {
    setThreadAutoFocus(focusReply);
    setThreadRoot(event);
    // Mark the thread read up to its newest reply so the Threads tab clears
    // its "new" highlight no matter which entry point opened it (inline
    // reply badge, reply icon, /thread command, or the Threads-tab list).
    // `openThreadFromList` stamps eagerly on click; this is the catch-all.
    const replies = baseTransport.threadRepliesFor?.(event.id) ?? EMPTY_REPLIES;
    const latest = replies.length > 0 ? replies[replies.length - 1].created_at : event.created_at;
    markThreadRead(event.id, latest);
  }, [baseTransport, markThreadRead]);

  // Inline-reply plumbing: a by-id lookup over the decoded set (rumors aren't
  // relay-fetchable, so the "replying to …" line resolves the parent locally),
  // and a jump-to-message handler for clicking that line.
  const messagesById = useMemo(() => {
    const m = new Map<string, ChatMsg>();
    for (const msg of allMessages) m.set(msg.id, msg);
    return m;
  }, [allMessages]);
  const jumpWithinChannel = useCallback((id: string) => {
    timelineRef.current?.scrollToMessage(id);
  }, []);

  // Fulfil a pending Threads-tab open: once its channel is active and the
  // transport has loaded the root, open the thread panel with the freshly
  // resolved root (so replies bucket correctly), then clear the target.
  useEffect(() => {
    if (!pendingThread) return;
    if (channel?.idHex !== pendingThread.channelIdHex) return;
    const loaded = allMessages.find((m) => m.id === pendingThread.root.id);
    if (!loaded) return;
    openThread(loaded);
    setPendingThread(null);
  }, [pendingThread, channel?.idHex, allMessages, openThread]);

  // Auto-open the thread panel when arrived via a notification deep-link
  // (`?thread=<rootId>` — the service appends it for kind-1111 Concord
  // replies). Mirrors the NIP-29 GroupChat behavior: fires once per param,
  // then clears it so a later load doesn't snap back.
  const [searchParams, setSearchParams] = useSearchParams();
  const threadParam = searchParams.get("thread");
  useEffect(() => {
    if (!threadParam || threadRoot || view !== "channel") return;
    const root = allMessages.find((m) => m.id === threadParam);
    if (root) {
      openThread(root);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("thread");
          return next;
        },
        { replace: true },
      );
    }
  }, [threadParam, threadRoot, view, allMessages, openThread, setSearchParams]);

  // Keep the thread panel content mounted through its slide-out animation.
  useEffect(() => {
    if (threadRoot) {
      setLastThreadRoot(threadRoot);
      return;
    }
    const t = setTimeout(() => setLastThreadRoot(undefined), 200);
    return () => clearTimeout(t);
  }, [threadRoot]);

  // Inject `openThread` (page-owned panel state) onto the data transport.
  const transport = useMemo(() => ({ ...baseTransport, openThread }), [baseTransport, openThread]);
  // Agent filter choke point: the timeline renders `transport.messages`, so a
  // filtered copy here hides filtered agents' top-level messages without
  // touching MessageTimeline (shared with NIP-29/DMs/mesh) or the wire
  // engine. Thread panels and reply context keep the unfiltered transport.
  const timelineTransport = useMemo<ChatTransport>(() => {
    if (filteredAgentPubkeys.size === 0) return transport;
    return {
      ...transport,
      messages: transport.messages.filter((m) => !filteredAgentPubkeys.has(m.pubkey)),
    };
  }, [transport, filteredAgentPubkeys]);
  // Recently-active members, for a bot command's `user`-argument picker. Concord
  // hands its timeline to ChatComposer as `messages: []`, so it must supply this.
  const recentAuthors = useMemo(() => authorsByRecency(transport.messages), [transport.messages]);

  // Background catch-up. `channelSyncing` = a sync task scoped to the channel
  // on screen (its backfill/gap-bridge round is running); the timeline uses it
  // for its own quiet catching-up affordance. The passive corner indicator on
  // the header icon surfaces whatever is in flight (self-gated so a
  // sub-second sync never paints), so it needn't hide once the focused channel
  // is live — it simply goes away when there's no work left.
  const syncTasks = useSyncTasks();
  const channelScope = channel ? `c2:${channel.idHex}` : undefined;
  const channelSyncing = Boolean(channelScope && syncTasks.some((t) => t.scope === channelScope));

  const onOpenThreadCb = useMemo(
    () => (canWrite ? (event: ChatMsg) => openThread(event, true) : undefined),
    [canWrite, openThread],
  );

  // Keep the open thread's read stamp advancing as new replies land while its
  // panel is on screen — mirrors the channel read effect above so the Threads
  // tab's "new" highlight clears for replies that arrive mid-view, not just
  // for replies that were present at open time. Visibility-gated so a
  // backgrounded tab doesn't silently eat the badge.
  const threadRootId = threadRoot?.id;
  useEffect(() => {
    if (!user || !threadRootId) return;
    const replies = transport.threadRepliesFor?.(threadRootId) ?? EMPTY_REPLIES;
    const latest = replies.length > 0 ? replies[replies.length - 1].created_at : threadRoot?.created_at ?? 0;
    if (latest <= 0) return;
    const stamp = () => {
      if (document.visibilityState === "visible") markThreadRead(threadRootId, latest);
    };
    stamp();
    document.addEventListener("visibilitychange", stamp);
    return () => document.removeEventListener("visibilitychange", stamp);
  }, [user, threadRootId, threadRoot?.created_at, transport, markThreadRead]);

  const moderation = useModeration2(community, memberPubkeys);

  const publishTyping = useTypingPublisher2(community, channel);
  const typingPubkeys = useTyping2(community, channel);

  // A dissolved community stays viewable (read-only) rather than redirecting
  // home — members asked to keep seeing the history. `canWrite` (above) is
  // already false when `dissolved`, freezing every write path; the timeline
  // renders a banner + explicit "Remove" button (below) so the member can
  // reap their own list entry when they're ready. The owner's dissolution
  // can't reach into each member's self-encrypted list, so removal MUST be a
  // local, per-member action.

  if (!communityId) return <Navigate to="/bao/baocommunity" replace />;

  const handleSend = async (content: string, tags: string[][]) => {
    // The composer's content-derived tags (emoji, imeta, mentions) are sealed
    // verbatim; NIP-29 `h` and stray `e` tags are always dropped. An INLINE
    // reply keeps its NIP-C7 `q` (+ the `p` notifying the replied-to author) so
    // it renders quoted in the timeline; a top-level message keeps neither.
    // THREAD replies are a separate path (kind-1111, via `sendThreadReply`).
    const isReply = Boolean(replyTo);
    const extraTags = tags.filter(([name]) =>
      name !== "h" && name !== "e" && (isReply || name !== "q"),
    );
    await send({ content, extraTags });
    setReplyTo(undefined);
  };

  const handleEditSubmit = async (original: ChatMsg, content: string) => {
    const trimmed = content.trim();
    if (!trimmed || trimmed === original.content.trim()) {
      setEditingId(undefined);
      return;
    }
    setEditingId(undefined);
    try {
      await transport.editMessage?.(original, trimmed);
    } catch {
      toast({
        title: "Edit failed",
        description: "Could not publish the edit.",
        variant: "destructive",
      });
    }
  };

  const handleCreateChannel = async () => {
    const name = newChannelName.trim();
    if (!name || !community) return;
    try {
      const { channelIdHex: created } = await createChannel({ name });
      selectChannel(created);
      setNewChannelName("");
      setCreatingChannel(false);
    } catch {
      // keep the input open so the user can retry
    }
  };

  const handleLeave = async () => {
    const accepted = confirm(
      dissolved
        ? "Remove this community from your account? Downloaded history may remain on this device."
        : "Leave this community? This removes it from your account and stops this app syncing it. It does not revoke keys already shared with you or erase downloaded history from this device.",
    );
    if (!accepted) return;
    try {
      await leave();
      navigateTo("/bao/baocommunity");
    } catch {
      // best-effort
    }
  };

  const handleDissolve = async () => {
    if (!confirm("Permanently dissolve this community for everyone? This cannot be undone.")) return;
    try {
      await dissolve();
      toast({ title: "Community dissolved" });
      navigateTo("/bao/baocommunity");
    } catch (e) {
      toast({ title: "Couldn't dissolve", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    }
  };

  const handlePurgeRemote = async () => {
    if (!confirm("Permanently dissolve this BAO and request deletion of its relay data? This cannot be undone.")) return;
    if (!confirm("Final warning: relay deletion is best-effort, but this will erase the founder-controlled BAO history from configured relays where NIP-09 is honored.")) return;
    try {
      const report = await purgeRemote();
      toast({
        title: "BAO purge requested",
        description: `${report.accepted} deletion request${report.accepted === 1 ? "" : "s"} accepted; ${report.failed} rejected or timed out.`,
      });
      navigateTo("/bao/baocommunity");
    } catch (e) {
      toast({ title: "Couldn't purge BAO", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    }
  };

  const handleSetRole = async (pubkey: string, roles: string[]) => {
    const tier = roles.includes("admin") ? ("admin" as const) : roles.includes("moderator") ? ("moderator" as const) : null;
    try {
      await setTier({ member: pubkey, tier });
      toast({ title: tier === "admin" ? "Made admin" : tier === "moderator" ? "Made moderator" : "Role removed" });
    } catch (e) {
      toast({ title: "Couldn't change role", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    }
  };

  // A ban rotates keys unless someone ELSE holds a live link (a rotation
  // would strand it; my own links refresh with the rotation). Judged as-of
  // after this ban: the target's links die with their authority.
  const banWillRotate =
    banTarget !== null && !!folded && !!user && !hasForeignLiveLinks(folded, user.pubkey, banTarget) &&
    moderation.canRekey;

  const runBan = async (target: string, onPhase: (phase: BanPhase) => void) => {
    const { rekeyed, publicBan } = await moderation.ban({ target, onPhase });
    if (rekeyed) {
      toast({ title: "Member banned", description: "Member silenced; keys rotated. Previously shared history remains readable." });
    } else if (publicBan) {
      toast({ title: "Member banned", description: "Member silenced in compatible clients. Access keys were not rotated." });
    } else {
      toast({ title: "Member banned", description: "Member silenced; key rotation is pending and will retry." });
    }
  };

  const channelList = (onNavigate?: () => void, className?: string) => (
    <ChannelSidebarView
      className={className ?? (onNavigate ? "flex-1" : "hidden sidebar:flex")}
      title={
        <button
          type="button"
          className="group flex w-full items-center gap-1 min-w-0 text-left cursor-pointer rounded outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default"
          onClick={() => community && setCommunityMenuOpen((v) => !v)}
          disabled={!community}
          aria-label="Community menu"
          aria-expanded={communityMenuOpen}
        >
          <TitleIcon2 icon={folded?.metadata?.icon} />
          <span className="flex-1 truncate">{community?.name ?? "…"}</span>
          {community && (
            <ChevronDown
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
                communityMenuOpen && "rotate-180",
              )}
            />
          )}
        </button>
      }
      titleExpansion={
        community ? (
          <Collapsible open={communityMenuOpen} onOpenChange={setCommunityMenuOpen}>
            <CollapsibleContent className="overflow-hidden data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up">
              <div className="mx-2 mb-2 mt-1 p-1 space-y-0.5 clip-corner-lg bg-secondary">
                {[
                  {
                    show: true,
                    icon: <Settings className="size-4" />,
                    label: "Community settings",
                    onClick: () => setInfoOpen(true),
                  },
                  {
                    show: !!user && !dissolved,
                    icon: <UserPlus className="size-4" />,
                    label: "Invite people and agents",
                    onClick: () => setInviteOpen(true),
                  },
                  {
                    show: canManageChannels && !dissolved,
                    icon: <Plus className="size-4" />,
                    label: "Create channel",
                    onClick: () => setCreatingChannel(true),
                  },
                  {
                    show: canManageRoles && !dissolved,
                    icon: <Shield className="size-4" />,
                    label: "Manage roles",
                    onClick: () => setRolesOpen(true),
                  },
                  {
                    show: true,
                    icon: <ScrollText className="size-4" />,
                    label: "Audit log",
                    // Also close the mobile channel drawer so the view slides
                    // into the <main> overlay (inert on desktop).
                    onClick: () => {
                      setView("audit");
                      setChannelsOpen(false);
                    },
                  },
                  {
                    show: true,
                    icon: <LinkIcon className="size-4" />,
                    label: "Invite links",
                    onClick: () => {
                      setView("invites");
                      setChannelsOpen(false);
                    },
                  },
                  {
                    show: canBanAny,
                    icon: <Ban className="size-4" />,
                    label: "Banned members",
                    onClick: () => {
                      setView("banned");
                      setChannelsOpen(false);
                    },
                  },
                  {
                    show: canManageRoles || canKickAny || canBanAny || canCreateInvite,
                    icon: <HeartPulse className="size-4" />,
                    label: "Member health",
                    onClick: () => {
                      setView("health");
                      setChannelsOpen(false);
                    },
                  },
                  {
                    show: true,
                    icon: communityMuted ? <Bell className="size-4" /> : <BellOff className="size-4" />,
                    label: communityMuted ? "Unmute community" : "Mute community",
                    onClick: () => toggleCommunityMute(`c2:${community.idHex}`),
                  },
                  {
                    show: !!user,
                    icon: <Eraser className="size-4" />,
                    label: "Delete local data…",
                    onClick: () => setPurgeOpen(true),
                  },
                ]
                  .filter((i) => i.show)
                  .map((i) => (
                    <button
                      key={i.label}
                      type="button"
                      className="flex w-full items-center gap-3 px-3 py-2 text-sm text-left transition-colors clip-corner-lg hover:bg-foreground/10"
                      onClick={() => {
                        i.onClick();
                        setCommunityMenuOpen(false);
                      }}
                    >
                      {i.icon}
                      {i.label}
                    </button>
                  ))}
                {user && (
                  <>
                    <div className="mx-1 my-1 h-px bg-border" />
                    <button
                      type="button"
                      disabled={isLeaving}
                      className="flex w-full items-center gap-3 px-3 py-2 text-sm text-left text-destructive transition-colors clip-corner-lg hover:bg-destructive/10 disabled:opacity-50"
                      onClick={() => {
                        handleLeave();
                        setCommunityMenuOpen(false);
                      }}
                    >
                      <LogOut className="size-4" />
                      {dissolved ? "Remove community" : "Leave community"}
                    </button>
                    {iAmOwner && !dissolved && (
                      <button
                        type="button"
                        className="flex w-full items-center gap-3 px-3 py-2 text-sm text-left text-destructive transition-colors clip-corner-lg hover:bg-destructive/10"
                        onClick={() => {
                          handleDissolve();
                          setCommunityMenuOpen(false);
                        }}
                      >
                        <Trash2 className="size-4" />
                        Dissolve community
                      </button>
                    )}
                    {canPurgeRemote && (
                      <button
                        type="button"
                        disabled={isPurging || isDissolving}
                        className="flex w-full items-center gap-3 px-3 py-2 text-sm text-left text-destructive transition-colors clip-corner-lg hover:bg-destructive/10 disabled:opacity-50"
                        onClick={() => {
                          void handlePurgeRemote();
                          setCommunityMenuOpen(false);
                        }}
                      >
                        <Trash2 className="size-4" />
                        {isPurging ? "Purging BAO…" : "Purge BAO from relays…"}
                      </button>
                    )}
                  </>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        ) : undefined
      }
      banner={folded?.metadata?.banner ? <Banner2 banner={folded.metadata.banner} /> : undefined}
      addChannelLabel={user && community && canManageChannels ? "Add channel" : undefined}
      onAddChannel={user && community && canManageChannels ? () => setCreatingChannel((v) => !v) : undefined}
      addChannelOpen={creatingChannel}
      footer={<SidebarFooter2 />}
      preChannels={
        user && community ? (
          <>
            <button
              type="button"
              onClick={() => {
                setView("mentions");
                onNavigate?.();
              }}
              className={cn(
                "flex w-full items-center gap-2 pl-3 pr-2 py-1.5 touch:py-3 text-sm transition-colors text-left clip-corner-lg",
                view === "mentions"
                  ? "bg-primary text-primary-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-foreground/5",
                // Unread (but not selected) mentions read brighter + bold, matching
                // an unread channel row.
                view !== "mentions" && hasUnreadMention && "text-foreground font-semibold",
              )}
              aria-current={view === "mentions"}
            >
              <AtSign className="size-4 shrink-0" />
              <span className="truncate flex-1 min-w-0">Mentions</span>
              {view !== "mentions" && hasUnreadMention ? (
                <span
                  className="shrink-0 flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold leading-none"
                  aria-label="You have unread mentions"
                >
                  @
                </span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => {
                setView("threads");
                onNavigate?.();
              }}
              className={cn(
                "flex w-full items-center gap-2 pl-3 pr-2 py-1.5 touch:py-3 text-sm transition-colors text-left clip-corner-lg",
                view === "threads"
                  ? "bg-primary text-primary-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-foreground/5",
                // Unread (but not selected) thread replies read brighter + bold.
                view !== "threads" && hasNewThreadReplies && "text-foreground font-semibold",
              )}
              aria-current={view === "threads"}
            >
              <MessagesSquare className="size-4 shrink-0" />
              <span className="truncate flex-1 min-w-0">Threads</span>
              {view !== "threads" && hasNewThreadReplies ? (
                <span
                  className="shrink-0 size-2 rounded-full bg-primary"
                  aria-label="New thread replies"
                />
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => {
                setView("fund");
                onNavigate?.();
              }}
              className={cn(
                "flex w-full items-center gap-2 pl-3 pr-2 py-1.5 touch:py-3 text-sm transition-colors text-left clip-corner-lg",
                view === "fund"
                  ? "bg-primary text-primary-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-foreground/5",
              )}
              aria-current={view === "fund"}
            >
              <HandCoins className="size-4 shrink-0" />
              <span className="truncate flex-1 min-w-0">Fund</span>
              {folded?.metadata?.fund_id && view !== "fund" ? (
                <span className="shrink-0 size-2 rounded-full bg-green-500" aria-label="Fundraiser linked" />
              ) : null}
            </button>
            {projectPointer ? (
              <button
                type="button"
                onClick={() => {
                  setView("project");
                  onNavigate?.();
                }}
                className={cn(
                  "flex w-full items-center gap-2 pl-3 pr-2 py-1.5 touch:py-3 text-sm transition-colors text-left clip-corner-lg",
                  view === "project" ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:text-foreground hover:bg-foreground/5",
                )}
                aria-current={view === "project"}
              >
                <GitBranch className="size-4 shrink-0" />
                <span className="truncate flex-1 min-w-0">Project</span>
              </button>
            ) : null}
          </>
        ) : undefined
      }
      channelsHeaderExtra={
        creatingChannel ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleCreateChannel();
            }}
            className="mx-2 my-1 p-1.5 space-y-1.5 clip-corner-lg bg-foreground/5"
          >
            <div className="flex items-center gap-1">
              <Input
                value={newChannelName}
                onChange={(e) => setNewChannelName(e.target.value)}
                placeholder="e.g. general, memes, dev-talk"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setCreatingChannel(false);
                    setNewChannelName("");
                  }
                }}
                className="h-7 text-sm"
              />
              <Button
                type="submit"
                size="icon"
                className="size-7 shrink-0 clip-corner-lg"
                aria-label="Create channel"
                disabled={isAddingChannel || !newChannelName.trim()}
              >
                {isAddingChannel ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              </Button>
            </div>
          </form>
        ) : undefined
      }
    >
      {!community || channels.length === 0 ? (
        showChannelSkeleton ? (
          <div className="space-y-2 px-2 py-1">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-full" />
            ))}
          </div>
        ) : null
      ) : (
        channels.map((c) => (
          <ChannelRow2
            key={c.idHex}
            community={community}
            channel={c}
            active={Boolean(view === "channel" && channel && channel.idHex === c.idHex)}
            unread={unreadByChannel[c.idHex]}
            onSelect={() => {
              selectChannel(c.idHex);
              onNavigate?.();
            }}
          />
        ))
      )}
    </ChannelSidebarView>
  );

  return (
    <ChannelNavContext.Provider value={channelNav}>
      {/* Flex-row, full-height frame for the two panes. On desktop SwipeReveal
          renders its panes in flow and expects a side-by-side flex row; on
          mobile both panes are `absolute inset-0`, so without this wrapper the
          center column has no in-flow height and collapses to a sliver (the
          channel list renders 40px tall — unusable). Heights mirror the chat
          <main>'s own mobile/desktop heights. */}
      <div className="relative flex h-[calc(100dvh-4rem)] sidebar:h-dvh">
      <SwipeReveal
        open={channelsOpen}
        onReveal={() => setChannelsOpen(true)}
        onClose={() => setChannelsOpen(false)}
        underlay={
          // (Armada rendered its ServerRail beside the channel list here; in
          // ₿AO cross-community navigation lives on the /bao/baocommunity list page.)
          channelList(() => setChannelsOpen(false), focusMode ? "hidden" : "flex-1 sidebar:flex-none")
        }
      >
        <main className="flex-1 min-w-0 flex flex-col safe-area-top h-[calc(100dvh-4rem)] sidebar:h-dvh">
          <header className="relative h-12 touch:h-14 max-sidebar:h-auto max-sidebar:py-2 mx-2 mt-3 px-2 sidebar:px-3 flex items-center gap-1.5 shrink-0 clip-corner-lg bg-chrome">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Back to channels"
              className="size-9 touch:size-11 shrink-0 sidebar:hidden"
              onClick={() => setChannelsOpen(true)}
            >
              <ChevronLeft className="size-5" />
            </Button>

            {/* Desktop / wide: "# channel-name" (or "@ Mentions" / "Threads"). */}
            <div className="relative hidden sidebar:flex items-center gap-1.5 min-w-0">
              {/* Passive background-sync indicator, pinned to the corner of the
                  leading title icon (replaces the old full-width sync bar). */}
              <SyncStatusIndicator
                priorityScope={channelScope}
                className="absolute -bottom-0.5 left-2 z-10"
              />
              {view === "mentions" ? (
                <>
                  <AtSign className="size-5 text-muted-foreground shrink-0" />
                  <h1 className="font-semibold truncate leading-tight">Mentions</h1>
                </>
              ) : view === "audit" ? (
                <>
                  <ScrollText className="size-5 text-muted-foreground shrink-0" />
                  <h1 className="font-semibold truncate leading-tight">Audit log</h1>
                </>
              ) : view === "fund" ? (
                <>
                  <HandCoins className="size-5 text-muted-foreground shrink-0" />
                  <h1 className="font-semibold truncate leading-tight">Fund</h1>
                </>
              ) : view === "project" ? (
                <>
                  <GitBranch className="size-5 text-muted-foreground shrink-0" />
                  <h1 className="font-semibold truncate leading-tight">Project</h1>
                </>
              ) : view === "invites" ? (
                <>
                  <LinkIcon className="size-5 text-muted-foreground shrink-0" />
                  <h1 className="font-semibold truncate leading-tight">Invite links</h1>
                </>
              ) : view === "banned" ? (
                <>
                  <Ban className="size-5 text-muted-foreground shrink-0" />
                  <h1 className="font-semibold truncate leading-tight">Banned members</h1>
                </>
              ) : view === "health" ? (
                <>
                  <HeartPulse className="size-5 text-muted-foreground shrink-0" />
                  <h1 className="font-semibold truncate leading-tight">Member health</h1>
                </>
              ) : view === "threads" ? (
                <>
                  <MessagesSquare className="size-5 text-muted-foreground shrink-0" />
                  <h1 className="font-semibold truncate leading-tight">Threads</h1>
                </>
              ) : (
                <>
                  {channel?.isPrivate ? (
                    <Lock className="size-5 text-muted-foreground shrink-0" />
                  ) : (
                    <Hash className="size-5 text-muted-foreground shrink-0" />
                  )}
                  <h1 className="font-semibold truncate leading-tight">{channel?.name ?? "…"}</h1>
                </>
              )}
            </div>

            {/* Mobile: community avatar + name large, channel muted below */}
            <div className="relative flex sidebar:hidden items-center min-w-0">
              {/* Passive background-sync indicator, pinned to the avatar corner
                  (can't live inside the info button — nested buttons). */}
              <SyncStatusIndicator
                priorityScope={channelScope}
                className="absolute bottom-0 left-5 z-10"
              />
              <button
                type="button"
                className="flex items-center gap-2.5 min-w-0 text-left"
                onClick={() => community && setInfoOpen(true)}
                disabled={!community}
                aria-label="Community info"
              >
              <TitleAvatar2 icon={folded?.metadata?.icon} name={community?.name} />
              <div className="min-w-0 flex flex-col">
                <span className="font-semibold text-base leading-tight truncate">{community?.name ?? "…"}</span>
                <span className="text-xs text-muted-foreground leading-tight truncate flex items-center gap-0.5">
                  {view === "mentions" ? (
                    <>
                      <AtSign className="size-3 shrink-0" />
                      Mentions
                    </>
                  ) : view === "audit" ? (
                    <>
                      <ScrollText className="size-3 shrink-0" />
                      Audit log
                    </>
                  ) : view === "fund" ? (
                    <><HandCoins className="size-3 shrink-0" />Fund</>
                  ) : view === "project" ? (
                    <><GitBranch className="size-3 shrink-0" />Project</>
                  ) : view === "invites" ? (
                    <>
                      <LinkIcon className="size-3 shrink-0" />
                      Invite links
                    </>
                  ) : view === "banned" ? (
                    <>
                      <Ban className="size-3 shrink-0" />
                      Banned members
                    </>
                  ) : view === "health" ? (
                    <>
                      <HeartPulse className="size-3 shrink-0" />
                      Member health
                    </>
                  ) : view === "threads" ? (
                    <>
                      <MessagesSquare className="size-3 shrink-0" />
                      Threads
                    </>
                  ) : (
                    <>
                      {channel?.isPrivate ? (
                        <Lock className="size-3 shrink-0" />
                      ) : (
                        <Hash className="size-3 shrink-0" />
                      )}
                      {channel?.name ?? "…"}
                    </>
                  )}
                </span>
              </div>
            </button>
            </div>
            <div className="ml-auto flex items-center gap-0.5">
              {sanitizeUrl(folded?.metadata?.repo) && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 touch:size-11"
                      aria-label="Open community repository"
                      onClick={() => {
                        const safeRepo = sanitizeUrl(folded?.metadata?.repo);
                        if (safeRepo) void openUrl(safeRepo);
                      }}
                    >
                      <GitBranch className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{folded?.metadata?.repo as string}</TooltipContent>
                </Tooltip>
              )}
              {user && channel && canWrite && (
                <DisappearTimerButton2 channelIdHex={channel.idHex} />
              )}
              {user && !dissolved && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-8 touch:size-11" aria-label="Invite people and agents" onClick={() => setInviteOpen(true)}>
                      <UserPlus className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Invite people and agents</TooltipContent>
                </Tooltip>
              )}
              <Button
                variant="ghost"
                size="icon"
                aria-label="Members"
                aria-pressed={membersOpen}
                className="size-8 touch:size-11 sidebar:hidden"
                onClick={() => setMembersOpen((v) => !v)}
              >
                <Users className="size-4" />
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn("size-8 touch:size-11", focusMode && "text-primary")}
                    aria-label={focusMode ? "Exit focus mode" : "Focus mode — chat only"}
                    aria-pressed={focusMode}
                    onClick={() => setFocusMode((v) => !v)}
                  >
                    {focusMode ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{focusMode ? "Show side panels" : "Focus mode — collapse both side panels"}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn("size-8 hidden sidebar:inline-flex text-muted-foreground", membersVisible && "text-foreground")}
                    aria-label={membersVisible ? "Hide members" : "Show members"}
                    aria-pressed={membersVisible}
                    onClick={() => setMembersVisible((v) => !v)}
                  >
                    <Users className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{membersVisible ? "Hide members" : "Show members"}</TooltipContent>
              </Tooltip>
              {user && community && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 touch:size-11"
                      disabled={!channel}
                      aria-label={channelMuted ? "Unmute channel" : "Mute channel"}
                      onClick={() => {
                        if (channel) toggleConcordChannelMute("c2", community.idHex, channel.idHex);
                      }}
                    >
                      {channelMuted ? <Bell className="size-4" /> : <BellOff className="size-4" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{channelMuted ? "Unmute channel" : "Mute channel"}</TooltipContent>
                </Tooltip>
              )}
            </div>
          </header>

          <div className="relative flex flex-1 min-h-0">
            <ComposerBoundsProvider value={composerBoundsRef}>
            <div className={cn(
              "flex-1 min-w-0 flex flex-col",
              "sidebar:transition-[width,opacity] sidebar:duration-300 sidebar:ease-out",
              threadRoot && threadExpanded && "sidebar:flex-none sidebar:w-0 sidebar:opacity-0 sidebar:overflow-hidden sidebar:pointer-events-none",
            )}>
              {view === "mentions" ? (
                <div className="flex-1 min-h-0 overflow-y-auto overflow-x-clip overscroll-contain scrollbar-stable pb-safe">
                  <MentionsView
                    channels={channels}
                    mentions={mentions}
                    isLoading={mentionsLoading}
                    onJump={jumpToMention}
                  />
                </div>
              ) : view === "audit" ? (
                <div className="flex-1 min-h-0 overflow-y-auto overflow-x-clip overscroll-contain scrollbar-stable pb-safe">
                  {community && <AuditLogView community={community} />}
                </div>
              ) : view === "invites" ? (
                <div className="flex-1 min-h-0 overflow-y-auto overflow-x-clip overscroll-contain scrollbar-stable pb-safe">
                  {community && <InvitesView community={community} />}
                </div>
              ) : view === "banned" ? (
                <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain scrollbar-stable pb-safe">
                  {community && <BannedView community={community} />}
                </div>
              ) : view === "health" ? (
                <div className="flex-1 min-h-0 overflow-y-auto overflow-x-clip overscroll-contain scrollbar-stable pb-safe">
                  {community && (
                    <DebugHealView
                      community={community}
                      canHeal={canManageRoles || canKickAny || canBanAny || canCreateInvite}
                    />
                  )}
                </div>
              ) : view === "threads" ? (
                <div className="flex-1 min-h-0 overflow-y-auto overflow-x-clip overscroll-contain scrollbar-stable pb-safe">
                  <ThreadsView
                    channels={channels}
                    threads={displayedThreads}
                    isLoading={threadsLoading}
                    onOpen={openThreadFromList}
                  />
                </div>
              ) : view === "fund" && community ? (
                <FundView2
                  community={community}
                  metadata={folded?.metadata}
                  canManage={canManageMetadata}
                />
              ) : view === "project" && projectPointer ? (
                <ProjectWorkspace2 repoNaddr={projectPointer.naddr} fundId={folded?.metadata?.fund_id} communityName={folded?.metadata?.name || community?.name || "Project"} repoUrl={folded?.metadata?.repo} />
              ) : (
                <>
                  <MessageTimeline
                    key={channel?.idHex ?? "none"}
                    transport={timelineTransport}
                    handleRef={timelineRef}
                    syncing={channelSyncing}
                    className="flex-1 min-h-0"
                    emptyState={
                      <p className="px-2 py-8 text-center text-sm text-muted-foreground">
                        No messages yet. Say something — only members can read it.
                      </p>
                    }
                    renderMessage={(msg, continuation) => {
                      const replyId = getQuoteReplyToId(msg);
                      return (
                      <ChatMessage2
                        key={msg.id}
                        event={msg}
                        reactions={reactionsFor(msg.id)}
                        zaps={transport.zapsFor?.(msg.id)}
                        onSendZap={config.zapsEnabled ? transport.sendZap : undefined}
                        replies={transport.threadRepliesFor?.(msg.id) ?? EMPTY_REPLIES}
                        continuation={continuation}
                        canWrite={transport.canWrite}
                        canModerate={transport.canModerate}
                        sendStatus={transport.sendStatusFor?.(msg.id)}
                        active={activeId === msg.id}
                        onToggleActive={toggleActive}
                        onOpenThread={onOpenThreadCb}
                        onReply={canWrite ? setReplyTo : undefined}
                        replyContext={
                          replyId ? (
                            <ReplyContext2 parent={messagesById.get(replyId)} onJump={jumpWithinChannel} />
                          ) : undefined
                        }
                        onDelete={transport.deleteMessage}
                        onRetry={transport.retry}
                        onDiscard={transport.discard}
                        isEditing={editingId === msg.id}
                        onEdit={canWrite ? (e) => setEditingId(e.id) : undefined}
                        onEditSubmit={handleEditSubmit}
                        onEditCancel={() => setEditingId(undefined)}
                      />
                      );
                    }}
                  />

                  {typingPubkeys.length > 0 && <TypingIndicator pubkeys={typingPubkeys} />}
                  {dissolved ? (
                    <div className="mx-2 mb-3 mt-1 px-3 py-3 clip-corner-lg bg-destructive/10 flex items-center gap-3">
                      <Trash2 className="size-5 shrink-0 text-destructive" />
                      <div className="min-w-0 flex-1 text-sm">
                        <p className="font-medium text-destructive">This community was dissolved by its owner.</p>
                        <p className="text-muted-foreground">
                          It's now read-only. You can still browse the history, or remove it from your list.
                        </p>
                      </div>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="shrink-0 clip-corner-lg"
                        disabled={isLeaving}
                        onClick={handleLeave}
                      >
                        {isLeaving ? <Loader2 className="size-4 animate-spin" /> : "Remove"}
                      </Button>
                    </div>
                  ) : excluded ? (
                    <div className="mx-2 mb-3 mt-1 px-3 py-3 clip-corner-lg bg-muted/60 flex items-center gap-3">
                      <Lock className="size-5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1 text-sm">
                        <p className="font-medium">You no longer have access to this community.</p>
                        <p className="text-muted-foreground">
                          A moderator rotated its keys without you. Your history stays readable; new
                          messages won't. It reappears if you're re-invited — or you can leave.
                        </p>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="shrink-0 clip-corner-lg"
                        disabled={isLeaving}
                        onClick={handleLeave}
                      >
                        {isLeaving ? <Loader2 className="size-4 animate-spin" /> : "Leave"}
                      </Button>
                    </div>
                  ) : stranded ? (
                    <div className="mx-2 mb-3 mt-1 px-3 py-3 clip-corner-lg bg-muted/60 flex items-center gap-3">
                      <Lock className="size-5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1 text-sm">
                        <p className="font-medium">This invite link is out of date.</p>
                        <p className="text-muted-foreground">
                          The community rotated its keys after this link was made, so you're on an
                          older version and can't read new messages.
                          {canRecover
                            ? " This checks for updated keys automatically; you can also ask whoever invited you for a fresh invite, or ask a moderator to send you the current keys."
                            : " Ask whoever invited you for a fresh invite, or ask a moderator to send you the current keys."}
                        </p>
                      </div>
                      {canRecover && (
                        <Button
                          variant="secondary"
                          size="sm"
                          className="shrink-0 clip-corner-lg"
                          disabled={recoveryChecking}
                          onClick={() => void recoveryCheckNow()}
                        >
                          {recoveryChecking ? <Loader2 className="size-4 animate-spin" /> : "Check again"}
                        </Button>
                      )}
                    </div>
                  ) : (
                    channel && (
                      <ChatComposer
                        relayUrl="dm"
                        groupId={channel.idHex}
                        messages={[]}
                        mentionPubkeys={memberPubkeys}
                        botCommands
                        recentAuthors={recentAuthors}
                        conversationRelays={community?.relays}
                        placeholder={user ? `Message #${channel.name}` : "Sign in to send"}
                        sendOverride={handleSend}
                        replyTo={replyTo}
                        replyMarker="nipc7"
                        onCancelReply={() => setReplyTo(undefined)}
                        onTyping={publishTyping}
                        encryptAttachments
                      />
                    )
                  )}
                </>
              )}
            </div>
            </ComposerBoundsProvider>

            {/* Thread panel. Desktop: in-flow sibling whose width animates open.
                Mobile: overlays the chat. Mirrors GroupChat. */}
            <div
              className={cn(
                "overflow-hidden",
                "absolute inset-0 z-20 sidebar:static sidebar:z-auto",
                "sidebar:transition-[width] sidebar:duration-200 sidebar:ease-out",
                threadRoot
                  ? (threadExpanded ? "sidebar:flex-1 sidebar:w-full" : "sidebar:shrink-0 sidebar:w-[23rem]")
                  : "sidebar:shrink-0 sidebar:w-0 pointer-events-none sidebar:pointer-events-auto",
              )}
            >
              <div
                className={cn(
                  "absolute inset-0 bg-background transition-opacity duration-200 ease-out sidebar:hidden",
                  threadRoot ? "opacity-100" : "opacity-0",
                )}
              />
              <div
                className={cn(
                  "relative h-full flex w-full transition-transform duration-200 ease-out",
                  threadRoot ? "translate-x-0" : "translate-x-full",
                  threadExpanded ? "sidebar:w-full" : "sidebar:w-[23rem]",
                )}
              >
                {lastThreadRoot && channel && (
                  <ThreadPanel
                    root={lastThreadRoot}
                    transport={transport}
                    relayUrl="dm"
                    groupId={channel.idHex}
                    canWrite={canWrite}
                    mentionPubkeys={memberPubkeys}
                    botCommands
                    conversationRelays={community?.relays}
                    autoFocus={threadAutoFocus}
                    onClose={() => { setThreadRoot(undefined); setThreadExpanded(false); }}
                    onExpandChange={setThreadExpanded}
                  />
                )}
              </div>
            </div>

            {/* Member panel: width-animated on desktop, slide overlay on mobile. */}
            <div
              className={cn(
                "overflow-hidden",
                "absolute inset-0 z-20 sidebar:static sidebar:z-auto",
                "sidebar:shrink-0 sidebar:w-0 sidebar:transition-[width] sidebar:duration-200 sidebar:ease-out",
                membersOpen && !focusMode ? "" : "pointer-events-none sidebar:pointer-events-auto",
                membersVisible && !focusMode && "sidebar:w-[16.5rem]",
              )}
            >
              <div
                className={cn(
                  "absolute inset-0 bg-background transition-opacity duration-200 ease-out sidebar:hidden",
                  membersOpen && !focusMode ? "opacity-100" : "opacity-0",
                )}
              />
              <div
                className={cn(
                  "relative h-full flex w-full sidebar:w-[16.5rem] transition-transform duration-200 ease-out",
                  membersOpen && !focusMode ? "translate-x-0" : "translate-x-full",
                  membersVisible && !focusMode ? "sidebar:translate-x-0" : "sidebar:translate-x-full",
                )}
              >
                <MemberList
                  admins={memberAdmins}
                  members={memberPubkeys}
                  canModerate={canManageRoles || canKickAny || canBanAny}
                  viewerIsAdmin={iAmOwner}
                  currentUserPubkey={user?.pubkey}
                  wot={{
                    scores: wotScores,
                    resolved: wotResolved,
                    filterEnabled: agentFilterEnabled,
                    onFilterEnabledChange: setAgentFilterEnabled,
                  }}
                  onSetRole={canManageRoles ? handleSetRole : undefined}
                  onKick={canKickAny ? (pk) => moderation.kick({ target: pk }).catch(() => {}) : undefined}
                  onBan={canBanAny ? setBanTarget : undefined}
                  banLabel={(pk) =>
                    folded && user && moderation.canRekey && !hasForeignLiveLinks(folded, user.pubkey, pk)
                      ? "Ban & lock out"
                      : "Ban"
                  }
                  onUnban={canBanAny ? (pk) => moderation.unban({ target: pk }).catch(() => {}) : undefined}
                  bannedPubkeys={moderation.banned}
                  onClose={() => setMembersOpen(false)}
                />
              </div>
            </div>
          </div>
        </main>
      </SwipeReveal>
      </div>

      <InviteDialog2 community={community} open={inviteOpen} onOpenChange={setInviteOpen} />
      <PurgeCommunityDialog2 community={community} open={purgeOpen} onOpenChange={setPurgeOpen} />
      <BanMemberDialog
        target={banTarget}
        willRotate={banWillRotate}
        onClose={() => setBanTarget(null)}
        onConfirm={runBan}
      />
      <CommunityInfoDialog2
        community={community}
        metadata={folded?.metadata}
        ownerHex={ownerHex}
        memberCount={memberPubkeys.length}
        canManageMetadata={canManageMetadata}
        canManageChannels={canManageChannels}
        open={infoOpen}
        onOpenChange={setInfoOpen}
      />
      <RolesDialog2 community={community} open={rolesOpen} onOpenChange={setRolesOpen} />
    </ChannelNavContext.Provider>
  );
}
