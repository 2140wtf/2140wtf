import type { NostrEvent } from "@nostrify/nostrify";
import { useQueryClient } from "@tanstack/react-query";
import {
  Heart,
  MessageCircle,
  MoreHorizontal,
  Play,
  ShieldAlert,
  Volume2,
  VolumeX,
  Zap,
} from "lucide-react";
import { RepostIcon } from "@/components/icons/RepostIcon";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { NoteMoreMenu } from "@/components/NoteMoreMenu";
import { ProfileHoverCard } from "@/components/ProfileHoverCard";
import { ZapDialog } from "@/components/ZapDialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppContext } from "@/hooks/useAppContext";
import { useAuthor } from "@/hooks/useAuthor";
import { useBlossomFallback } from "@/hooks/useBlossomFallback";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDeleteEvent } from "@/hooks/useDeleteEvent";
import { useNostrPublish } from "@/hooks/useNostrPublish";
import { useProfileUrl } from "@/hooks/useProfileUrl";
import { useRepostStatus } from "@/hooks/useRepostStatus";
import { type EventStats, useEventStats } from "@/hooks/useTrending";
import { useUserReaction } from "@/hooks/useUserReaction";
import { DITTO_RELAY } from "@/lib/appRelays";
import { getAvatarShape } from "@/lib/avatarShape";
import { getContentWarning } from "@/lib/contentWarning";
import { getRepostKind } from "@/lib/feedUtils";
import { formatNumber } from "@/lib/formatNumber";
import { useFormatMoney } from "@/hooks/useFormatMoney";
import { getDisplayName } from "@/lib/getDisplayName";
import { impactLight } from "@/lib/haptics";
import { cn } from "@/lib/utils";

// ─── Global mute state shared across all short-form video players ─────────────

let muted = true;

function isShortVideoMuted(): boolean {
  return muted;
}

function setShortVideoMuted(value: boolean): void {
  muted = value;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse imeta tags for a short-form video event → { url, thumbnail }. */
function parseShortVideoImeta(tags: string[][]): {
  url?: string;
  thumbnail?: string;
} {
  const tag = tags.find(([n]) => n === "imeta");
  if (!tag) return {};
  const result: Record<string, string> = {};
  for (let i = 1; i < tag.length; i++) {
    const part = tag[i];
    const sp = part.indexOf(" ");
    if (sp === -1) continue;
    result[part.slice(0, sp)] = part.slice(sp + 1);
  }
  return { url: result.url, thumbnail: result.image };
}

function getTag(tags: string[][], name: string): string | undefined {
  return tags.find(([n]) => n === name)?.[1];
}

// ─── ShortVideoHeartButton ────────────────────────────────────────────────────

function ShortVideoHeartButton({
  event,
  label,
  noBackground,
}: {
  event: NostrEvent;
  label?: string;
  noBackground?: boolean;
}) {
  const { user } = useCurrentUser();
  const userReaction = useUserReaction(event.id);
  const { mutate: publishEvent } = useNostrPublish();
  const queryClient = useQueryClient();
  const hasReacted = !!userReaction;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user || hasReacted) return;
    impactLight();

    const prevStats = queryClient.getQueryData<EventStats>([
      "event-stats",
      event.id,
    ]);
    if (prevStats) {
      queryClient.setQueryData<EventStats>(["event-stats", event.id], {
        ...prevStats,
        reactions: prevStats.reactions + 1,
      });
    }
    queryClient.setQueryData(["user-reaction", event.id], { content: "👍" });

    publishEvent(
      {
        kind: 7,
        content: "+",
        tags: [
          ["e", event.id],
          ["p", event.pubkey],
          ["k", String(event.kind)],
        ],
      },
      {
        onError: () => {
          if (prevStats) {
            queryClient.setQueryData<EventStats>(
              ["event-stats", event.id],
              prevStats,
            );
          }
          queryClient.removeQueries({ queryKey: ["user-reaction", event.id] });
        },
      },
    );
  };

  return (
    <ShortVideoActionButton label={label}>
      <button
        className={cn(
          "size-11 rounded-full flex items-center justify-center transition-colors backdrop-blur-sm",
          !noBackground && "bg-black/20 hover:bg-white/10",
          hasReacted ? "text-pink-500" : "text-white hover:text-pink-400",
        )}
        onClick={handleClick}
      >
        <Heart className="size-6" fill={hasReacted ? "currentColor" : "none"} />
      </button>
    </ShortVideoActionButton>
  );
}

// ─── ShortVideoRepostButton ───────────────────────────────────────────────────

function ShortVideoRepostButton({
  event,
  label,
}: {
  event: NostrEvent;
  label?: string;
}) {
  const { user } = useCurrentUser();
  const { mutate: publishEvent } = useNostrPublish();
  const { mutate: deleteEvent } = useDeleteEvent();
  const queryClient = useQueryClient();
  const repostEventId = useRepostStatus(event.id);
  const isReposted = !!repostEventId;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) return;
    impactLight();

    const repostKind = getRepostKind(event.kind);
    const prevStats = queryClient.getQueryData<EventStats>([
      "event-stats",
      event.id,
    ]);

    if (isReposted && repostEventId) {
      if (prevStats) {
        queryClient.setQueryData<EventStats>(["event-stats", event.id], {
          ...prevStats,
          reposts: Math.max(0, prevStats.reposts - 1),
        });
      }
      const prevRepostStatus = queryClient.getQueryData([
        "user-repost",
        event.id,
      ]);
      queryClient.setQueryData(["user-repost", event.id], null);

      deleteEvent(
        { eventId: repostEventId, eventKind: repostKind },
        {
          onError: () => {
            if (prevStats)
              queryClient.setQueryData<EventStats>(
                ["event-stats", event.id],
                prevStats,
              );
            queryClient.setQueryData(
              ["user-repost", event.id],
              prevRepostStatus,
            );
          },
        },
      );
    } else {
      if (prevStats) {
        queryClient.setQueryData<EventStats>(["event-stats", event.id], {
          ...prevStats,
          reposts: prevStats.reposts + 1,
        });
      }
      queryClient.setQueryData(["user-repost", event.id], "optimistic");

      const tags: string[][] = [
        ["e", event.id, DITTO_RELAY],
        ["p", event.pubkey],
      ];
      if (repostKind === 16) {
        tags.push(["k", String(event.kind)]);
        if (event.kind >= 30000 && event.kind < 40000) {
          const dTag = event.tags.find(([name]) => name === "d")?.[1] ?? "";
          tags.push(["a", `${event.kind}:${event.pubkey}:${dTag}`]);
        }
      }

      publishEvent(
        { kind: repostKind, content: "", tags },
        {
          onError: () => {
            if (prevStats)
              queryClient.setQueryData<EventStats>(
                ["event-stats", event.id],
                prevStats,
              );
            queryClient.setQueryData(["user-repost", event.id], null);
          },
        },
      );
    }
  };

  return (
    <ShortVideoActionButton label={label}>
      <button
        className={cn(
          "size-11 rounded-full flex items-center justify-center transition-colors backdrop-blur-sm bg-black/20 hover:bg-white/10",
          isReposted ? "text-accent" : "text-white hover:text-accent",
        )}
        onClick={handleClick}
      >
        <RepostIcon className="size-6" />
      </button>
    </ShortVideoActionButton>
  );
}

// ─── ShortVideoActionButton ───────────────────────────────────────────────────

interface ShortVideoActionButtonProps {
  icon?: React.ReactNode;
  label?: string;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  children?: React.ReactNode;
}

function ShortVideoActionButton({
  icon,
  label,
  onClick,
  className,
  children,
}: ShortVideoActionButtonProps) {
  return (
    <div className="flex flex-col items-center gap-1">
      {children ?? (
        <button
          className={cn(
            "size-11 rounded-full flex items-center justify-center transition-colors backdrop-blur-sm bg-black/20 hover:bg-white/10",
            className,
          )}
          onClick={onClick}
        >
          {icon}
        </button>
      )}
      {label && (
        <span className="text-white text-xs tabular-nums font-medium drop-shadow">
          {label}
        </span>
      )}
    </div>
  );
}

// ─── ShortVideoCard ───────────────────────────────────────────────────────────

export interface ShortVideoCardProps {
  event: NostrEvent;
  isActive: boolean;
  /** True for the card immediately before or after the active one — used to preload video. */
  isNearActive: boolean;
  onCommentClick: () => void;
  /** Called when the active card's playing state changes. */
  onPlayingChange?: (playing: boolean) => void;
}

export function ShortVideoCard({
  event,
  isActive,
  isNearActive,
  onCommentClick,
  onPlayingChange,
}: ShortVideoCardProps) {
  const { config } = useAppContext();
  const { user } = useCurrentUser();
  const author = useAuthor(event.pubkey);
  const metadata = author.data?.metadata;
  const avatarShape = getAvatarShape(metadata);
  const displayName = getDisplayName(metadata, event.pubkey);
  const profileUrl = useProfileUrl(event.pubkey, metadata);
  const { data: stats } = useEventStats(event.id, event);
  const { format: formatMoney } = useFormatMoney();
  const canZapAuthor = !!user && user.pubkey !== event.pubkey;

  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [isAttemptingPlay, setIsAttemptingPlay] = useState(isActive);
  const [isMuted, setIsMuted] = useState(isShortVideoMuted);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);

  const contentWarning = getContentWarning(event);
  const hasCW = contentWarning !== undefined;
  const cwPolicy = config.contentWarningPolicy;
  const [cwRevealed, setCwRevealed] = useState(false);
  const showCwOverlay = hasCW && cwPolicy === "blur" && !cwRevealed;

  const videoRef = useRef<HTMLVideoElement>(null);

  const imeta = useMemo(() => parseShortVideoImeta(event.tags), [event.tags]);
  const title = getTag(event.tags, "title");
  const hashtags = event.tags.filter(([n]) => n === "t").map(([, v]) => v);

  const { src, onError: onBlossomError } = useBlossomFallback(imeta.url ?? "");

  useEffect(() => {
    setIsVideoReady(false);
    setIsBuffering(false);
    setHasStarted(false);
    setIsPlaying(false);
  }, [src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !imeta.url) return;
    if (isActive && !showCwOverlay) {
      video.currentTime = 0;
      video.muted = isShortVideoMuted();
      setIsMuted(isShortVideoMuted());
      setIsAttemptingPlay(true);
      video.play().catch(() => {
        setIsAttemptingPlay(false);
      });
    } else {
      video.pause();
      video.currentTime = 0;
      setIsAttemptingPlay(false);
      setIsBuffering(false);
    }
  }, [isActive, imeta.url, showCwOverlay]);

  const togglePlay = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
  }, []);

  const toggleMute = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const video = videoRef.current;
    if (!video) return;
    const next = !video.muted;
    video.muted = next;
    setShortVideoMuted(next);
    setIsMuted(next);
  }, []);

  if (showCwOverlay) {
    return (
      <div className="relative w-full h-full bg-neutral-900 overflow-hidden flex-shrink-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="flex items-center justify-center size-14 rounded-full bg-white/10 backdrop-blur-sm">
          <ShieldAlert className="size-7 text-white/70" />
        </div>
        <div className="space-y-1.5 max-w-xs">
          <p className="text-base font-semibold text-white">Content Warning</p>
          {contentWarning ? (
            <p className="text-sm text-white/60 leading-relaxed">
              &ldquo;{contentWarning}&rdquo;
            </p>
          ) : (
            <p className="text-sm text-white/60 leading-relaxed">
              The author flagged this video as sensitive.
            </p>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 mt-1 rounded-full px-6 bg-white/10 border-white/20 text-white hover:bg-white/20 hover:text-white backdrop-blur-sm"
          onClick={(e) => {
            e.stopPropagation();
            setCwRevealed(true);
          }}
        >
          <Play className="size-3.5" />
          Show Video
        </Button>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-neutral-900 overflow-hidden flex-shrink-0">
      {/* Video */}
      {imeta.url ? (
        <>
          <video
            ref={videoRef}
            src={src}
            className="absolute inset-0 w-full h-full object-cover"
            loop
            playsInline
            muted={isMuted}
            preload={isActive ? "auto" : isNearActive ? "metadata" : "none"}
            onCanPlay={() => setIsVideoReady(true)}
            onPlay={() => {
              setIsPlaying(true);
              setHasStarted(true);
              setIsAttemptingPlay(false);
              setIsBuffering(false);
              onPlayingChange?.(true);
            }}
            onPause={() => {
              setIsPlaying(false);
              setIsAttemptingPlay(false);
              onPlayingChange?.(false);
            }}
            onWaiting={() => {
              if (hasStarted) setIsBuffering(true);
            }}
            onStalled={() => {
              if (hasStarted) setIsBuffering(true);
            }}
            onPlaying={() => setIsBuffering(false)}
            onError={onBlossomError}
            onClick={togglePlay}
          />

          {!isVideoReady && imeta.thumbnail && (
            <img
              src={imeta.thumbnail}
              alt=""
              aria-hidden
              className="absolute inset-0 w-full h-full object-cover pointer-events-none"
            />
          )}

          {!isVideoReady && !imeta.thumbnail && (
            <div className="absolute inset-0 bg-neutral-900 pointer-events-none" />
          )}

          {isVideoReady && !hasStarted && !isAttemptingPlay && (
            <div
              className="absolute inset-0 flex items-center justify-center cursor-pointer"
              onClick={togglePlay}
            >
              <div className="size-20 rounded-full bg-black/40 flex items-center justify-center backdrop-blur-sm border border-white/20">
                <Play className="size-10 text-white ml-1.5" fill="white" />
              </div>
            </div>
          )}

          {hasStarted && !isPlaying && !isBuffering && (
            <div
              className="absolute inset-0 flex items-center justify-center cursor-pointer"
              onClick={togglePlay}
            >
              <div className="size-16 rounded-full bg-black/40 flex items-center justify-center backdrop-blur-sm border border-white/20 animate-in zoom-in-50 duration-150">
                <Play className="size-8 text-white ml-1" fill="white" />
              </div>
            </div>
          )}

          {isBuffering && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="size-14 rounded-full bg-black/40 backdrop-blur-sm border border-white/10 flex items-center justify-center">
                <svg
                  className="size-7 text-white animate-spin"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  aria-hidden
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="3"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                  />
                </svg>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="absolute inset-0 bg-neutral-900 flex items-center justify-center">
          <span className="text-white/40 text-sm">No video</span>
        </div>
      )}

      {isVideoReady && (
        <>
          <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/60 to-transparent pointer-events-none" />
          <div className="absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-black/90 via-black/40 to-transparent pointer-events-none" />
        </>
      )}

      {isVideoReady && (
        <button
          className="absolute bottom-[calc(1rem+var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px)))] right-4 z-10 size-9 rounded-full bg-black/40 backdrop-blur-sm border border-white/20 flex items-center justify-center text-white hover:bg-black/60 transition-colors"
          onClick={toggleMute}
          aria-label={isMuted ? "Unmute" : "Mute"}
        >
          {isMuted ? (
            <VolumeX className="size-4" />
          ) : (
            <Volume2 className="size-4" />
          )}
        </button>
      )}

      {isVideoReady && (
        <div className="absolute right-3 bottom-[calc(6rem+var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px)))] z-10 flex flex-col items-center gap-5">
          <ProfileHoverCard pubkey={event.pubkey} asChild>
            <Link
              to={profileUrl}
              onClick={(e) => e.stopPropagation()}
              className="block"
            >
              {author.isLoading ? (
                <Skeleton className="size-11 rounded-full" />
              ) : (
                <Avatar
                  shape={avatarShape}
                  className="size-11 border-2 border-white shadow-lg"
                >
                  <AvatarImage src={metadata?.picture} alt={displayName} />
                  <AvatarFallback className="bg-primary/80 text-white text-sm font-bold">
                    {displayName[0]?.toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              )}
            </Link>
          </ProfileHoverCard>

          <ShortVideoHeartButton
            event={event}
            label={stats?.reactions ? formatNumber(stats.reactions) : undefined}
          />

          <ShortVideoActionButton
            icon={<MessageCircle className="size-6" />}
            label={stats?.replies ? formatNumber(stats.replies) : undefined}
            onClick={(e) => {
              e.stopPropagation();
              onCommentClick();
            }}
            className="text-white hover:text-blue-400"
          />

          <ShortVideoRepostButton
            event={event}
            label={
              stats?.reposts || stats?.quotes
                ? formatNumber((stats?.reposts ?? 0) + (stats?.quotes ?? 0))
                : undefined
            }
          />

          {canZapAuthor && (
            <ZapDialog target={event}>
              <ShortVideoActionButton
                icon={<Zap className="size-6" fill="none" />}
                label={
                  stats?.zapAmount ? formatMoney(stats.zapAmount, { layout: 'compact' }) : undefined
                }
                className="text-white hover:text-amber-400"
              />
            </ZapDialog>
          )}

          <ShortVideoActionButton
            icon={<MoreHorizontal className="size-6" />}
            onClick={(e) => {
              e.stopPropagation();
              setMoreMenuOpen(true);
            }}
            className="text-white/80 hover:text-white"
          />
        </div>
      )}

      {isVideoReady && (
        <div className="absolute bottom-[calc(1.5rem+var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px)))] left-4 right-20 z-10 space-y-1.5">
          <ProfileHoverCard pubkey={event.pubkey} asChild>
            <Link
              to={profileUrl}
              className="block"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="font-bold text-white text-[15px] leading-tight drop-shadow hover:underline">
                {displayName}
              </span>
            </Link>
          </ProfileHoverCard>

          {title && (
            <p className="text-white/90 text-sm leading-snug line-clamp-2 drop-shadow">
              {title}
            </p>
          )}

          {hashtags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {hashtags.slice(0, 4).map((tag) => (
                <Link
                  key={tag}
                  to={`/t/${encodeURIComponent(tag)}`}
                  className="text-xs text-white/70 hover:text-white transition-colors"
                  onClick={(e) => e.stopPropagation()}
                >
                  #{tag}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      <NoteMoreMenu
        event={event}
        open={moreMenuOpen}
        onOpenChange={setMoreMenuOpen}
      />
    </div>
  );
}
