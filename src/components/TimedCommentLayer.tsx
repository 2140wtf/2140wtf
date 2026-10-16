/**
 * SoundCloud-style timed comments for audio/video posts.
 *
 * Renders two pieces of UI below a media surface:
 *   1. A marker rail: the avatar of every commenter positioned at the moment
 *      in the track their comment belongs to. Hovering an avatar shows the
 *      comment.
 *   2. A composer that posts a NIP-22 (kind 1111) comment anchored to the
 *      current playback position with a `["position", "<seconds>"]` tag.
 *
 * Timed comments are only shown when the parent passes a root `event` (the
 * audio/video post), so players used in chat/profile contexts are unaffected.
 */

import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock, Heart, RotateCcw, Send, MessageCircle } from 'lucide-react';
import type { NostrEvent } from '@nostrify/nostrify';
import { useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';

import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { ReplyComposeModal } from '@/components/ReplyComposeModal';
import { getAvatarShape } from '@/lib/avatarShape';
import { getDisplayName } from '@/lib/getDisplayName';
import { isNostrId } from '@/lib/nostrId';
import { sanitizeUrl } from '@/lib/sanitizeUrl';
import { cn } from '@/lib/utils';
import { timeAgo } from '@/lib/timeAgo';
import { formatCommentPosition, parseCommentPosition, buildPositionTag, type TimedComment } from '@/lib/timedComments';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { usePostComment } from '@/hooks/usePostComment';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { usePublishPreferences } from '@/hooks/usePublishPreferences';
import { useProfileUrl } from '@/hooks/useProfileUrl';
import { useUserReaction } from '@/hooks/useUserReaction';
import { useTimedComments } from '@/hooks/useTimedComments';
import { impactLight, notificationSuccess } from '@/lib/haptics';
import { toast } from '@/hooks/useToast';

interface TimedCommentLayerProps {
  /** The audio/video post being commented on (the comment root). */
  event: NostrEvent;
  /** Current playback position in seconds. */
  currentTime: number;
  /** Total track duration in seconds. Used to place markers. */
  duration: number;
  /** Seek the media element to a position in seconds. */
  onSeek: (seconds: number) => void;
  className?: string;
}

/**
 * Marker rail + composer for timed comments on a piece of media.
 *
 * The rail renders one small avatar per positioned comment, laid out by
 * `position / duration`. Hovering an avatar opens a card with the author, the
 * comment, a "jump to" seek button, Reply and Like actions.
 */
export function TimedCommentLayer({ event, currentTime, duration, onSeek, className }: TimedCommentLayerProps) {
  // Never offer timed comments on a synthetic event (e.g. the ComposeBox
  // preview's `mockEvent`, which has a non-hex id and empty signature).
  const isReal = isNostrId(event.id) && event.sig.length > 0;
  const { comments } = useTimedComments(isReal ? event : undefined);
  const [replyTarget, setReplyTarget] = useState<NostrEvent | null>(null);

  const hasDuration = duration > 0 && Number.isFinite(duration);

  if (!isReal) return null;

  return (
    <div className={cn('border-t border-border bg-background', className)}>
      {/* Marker rail — avatars of everyone who commented at a moment */}
      {comments.length > 0 && (
        <div className="relative h-9 mx-3 mt-1.5" aria-label="Timed comments">
          {!hasDuration && (
            <p className="absolute inset-0 flex items-center text-[11px] text-muted-foreground">
              {comments.length} timed comment{comments.length !== 1 ? 's' : ''}
            </p>
          )}
          {hasDuration && comments.map((comment, i) => (
            <TimedCommentMarker
              key={comment.event.id}
              comment={comment}
              duration={duration}
              index={i}
              onJump={onSeek}
              onReply={setReplyTarget}
            />
          ))}
        </div>
      )}

      <TimedCommentComposer event={event} currentTime={currentTime} duration={duration} />

      <ReplyComposeModal
        event={replyTarget ?? undefined}
        open={!!replyTarget}
        onOpenChange={(open) => { if (!open) setReplyTarget(null); }}
      />
    </div>
  );
}

// ── Marker ───────────────────────────────────────────────────────────────────

/** A single commenter avatar positioned along the marker rail. */
export function TimedCommentMarker({
  comment,
  duration,
  index,
  onJump,
  onReply,
  size = 'md',
}: {
  comment: TimedComment;
  duration: number;
  index: number;
  onJump: (seconds: number) => void;
  onReply: (event: NostrEvent) => void;
  /** Avatar size: `md` for the detail rail, `sm` for compact track rows. */
  size?: 'sm' | 'md';
}) {
  const author = useAuthor(comment.event.pubkey);
  const metadata = author.data?.metadata;
  const avatarShape = getAvatarShape(metadata);
  const displayName = getDisplayName(metadata, comment.event.pubkey);

  const leftPct = Math.min(100, Math.max(0, (comment.position / duration) * 100));
  // Nudge later markers of identical position slightly so none is fully hidden.
  const offset = (index % 3) * 3;

  return (
    <HoverCard openDelay={120} closeDelay={80}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onJump(comment.position); }}
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary hover:z-50 hover:scale-110 transition-transform"
          style={{ left: `calc(${leftPct}% + ${offset}px)` }}
          aria-label={`Comment at ${formatCommentPosition(comment.position)} by ${displayName}`}
        >
          <Avatar shape={avatarShape} className={cn(size === 'sm' ? 'size-5' : 'size-7', 'ring-2 ring-background shadow-sm')}>
            <AvatarImage src={sanitizeUrl(metadata?.picture)} alt={displayName} />
            <AvatarFallback className="bg-primary/20 text-primary text-[10px]">
              {displayName[0]?.toUpperCase() ?? '?'}
            </AvatarFallback>
          </Avatar>
        </button>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="center" className="w-72 p-0 rounded-2xl shadow-lg" onClick={(e) => e.stopPropagation()}>
        <TimedCommentCard comment={comment} onJump={onJump} onReply={onReply} />
      </HoverCardContent>
    </HoverCard>
  );
}

/** Hover-card body: author, comment text, position badge, Reply and Like. */
function TimedCommentCard({
  comment,
  onJump,
  onReply,
}: {
  comment: TimedComment;
  onJump: (seconds: number) => void;
  onReply: (event: NostrEvent) => void;
}) {
  const { event } = comment;
  const author = useAuthor(event.pubkey);
  const metadata = author.data?.metadata;
  const avatarShape = getAvatarShape(metadata);
  const displayName = getDisplayName(metadata, event.pubkey);
  const profileUrl = useProfileUrl(event.pubkey, metadata);

  return (
    <div className="p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Link to={profileUrl} className="shrink-0">
          <Avatar shape={avatarShape} className="size-7">
            <AvatarImage src={sanitizeUrl(metadata?.picture)} alt={displayName} />
            <AvatarFallback className="bg-primary/20 text-primary text-[10px]">
              {displayName[0]?.toUpperCase() ?? '?'}
            </AvatarFallback>
          </Avatar>
        </Link>
        <div className="flex-1 min-w-0">
          <Link to={profileUrl} className="block text-xs font-semibold truncate hover:underline">
            {displayName}
          </Link>
          <span className="text-[10px] text-muted-foreground">{timeAgo(event.created_at)}</span>
        </div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onJump(comment.position); }}
          className="shrink-0 text-[10px] font-medium tabular-nums px-1.5 py-0.5 rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
          title="Jump to this moment"
        >
          {formatCommentPosition(comment.position)}
        </button>
      </div>

      <p className="text-xs text-foreground/90 leading-relaxed break-words whitespace-pre-wrap">
        {event.content}
      </p>

      <div className="flex items-center gap-3 pt-0.5">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onReply(event); }}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <MessageCircle className="size-3.5" />
          Reply
        </button>
        <TimedCommentLike event={event} />
      </div>
    </div>
  );
}

/** Lightweight "Like" toggle that publishes a kind 7 reaction to the comment. */
function TimedCommentLike({ event }: { event: NostrEvent }) {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { mutate: publishEvent } = useNostrPublish();
  const { isEnabled } = usePublishPreferences();
  const userReaction = useUserReaction(event.id);
  const queryClient = useQueryClient();
  const liked = !!userReaction;

  const handleClick = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) return;
    if (!isEnabled('reactions')) {
      toast({
        title: 'Reactions disabled',
        description: 'Turn on “Reactions” in Settings → Privacy & Publishing to like comments.',
      });
      return;
    }
    impactLight();

    if (liked) {
      const events = await nostr.query([{ kinds: [7], authors: [user.pubkey], '#e': [event.id], limit: 1 }]);
      if (events.length === 0) return;
      queryClient.setQueryData(['user-reaction', event.id], null);
      publishEvent(
        { kind: 5, content: '', tags: [['e', events[0].id], ['k', '7']] },
        { onSuccess: () => queryClient.invalidateQueries({ queryKey: ['user-reaction', event.id] }) },
      );
      return;
    }

    queryClient.setQueryData(['user-reaction', event.id], { content: '❤️' });
    publishEvent(
      { kind: 7, content: '❤️', tags: [['e', event.id], ['p', event.pubkey], ['k', String(event.kind)]] },
      {
        onSuccess: () => {
          notificationSuccess();
          queryClient.invalidateQueries({ queryKey: ['user-reaction', event.id] });
        },
      },
    );
  }, [user, isEnabled, liked, nostr, event, publishEvent, queryClient]);

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!user}
      className={cn(
        'inline-flex items-center gap-1 text-[11px] font-medium transition-colors disabled:opacity-50',
        liked ? 'text-pink-500' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Heart className="size-3.5" fill={liked ? 'currentColor' : 'none'} />
      Like
    </button>
  );
}

// ── Composer ─────────────────────────────────────────────────────────────────

/**
 * Inline composer that posts a comment at a playback position.
 *
 * The time is ALWAYS visible in an editable chip — it follows the live
 * playback position until the user types a time, after which it stays pinned
 * until they snap it back to playback. This means the comment's timestamp is
 * never hidden (it used to live only in the input's placeholder, which
 * vanished as soon as the user started typing).
 */
export function TimedCommentComposer({ event, currentTime, duration }: { event: NostrEvent; currentTime: number; duration: number }) {
  const { user, metadata } = useCurrentUser();
  const avatarShape = getAvatarShape(metadata);
  const displayName = getDisplayName(metadata, user?.pubkey);
  const { mutateAsync: postComment, isPending } = usePostComment();
  const queryClient = useQueryClient();
  const [content, setContent] = useState('');
  // null = follow live playback; a number = a user-pinned position.
  const [pinnedPosition, setPinnedPosition] = useState<number | null>(null);
  const [editingTime, setEditingTime] = useState(false);
  const [timeDraft, setTimeDraft] = useState('');

  const livePosition = useMemo(() => Math.max(0, currentTime), [currentTime]);
  const following = pinnedPosition === null;
  const position = pinnedPosition ?? livePosition;
  const clamp = useCallback(
    (seconds: number) => (duration > 0 && Number.isFinite(duration) ? Math.min(seconds, duration) : seconds),
    [duration],
  );

  const beginEditTime = useCallback(() => {
    setTimeDraft(formatCommentPosition(position));
    setEditingTime(true);
  }, [position]);

  const commitTime = useCallback(() => {
    const parsed = parseCommentPosition(timeDraft);
    if (parsed !== undefined) setPinnedPosition(clamp(parsed));
    setEditingTime(false);
  }, [timeDraft, clamp]);

  const syncToPlayback = useCallback(() => {
    setPinnedPosition(null);
    setEditingTime(false);
  }, []);

  const submit = useCallback(async () => {
    const text = content.trim();
    if (!text || !user || isPending) return;
    try {
      await postComment({
        root: event,
        content: text,
        tags: [buildPositionTag(position)],
      });
      setContent('');
      setPinnedPosition(null);
      notificationSuccess();
      queryClient.invalidateQueries({ queryKey: ['nostr', 'comments', event.id] });
    } catch {
      // usePostComment surfaces its own toast on failure/disabled publishing.
    }
  }, [content, user, isPending, postComment, event, position, queryClient]);

  return (
    <div className="flex items-center gap-2 px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
      {user ? (
        <Avatar shape={avatarShape} className="size-7 shrink-0">
          <AvatarImage src={sanitizeUrl(metadata?.picture)} alt={displayName} />
          <AvatarFallback className="bg-primary/20 text-primary text-[10px]">
            {displayName[0]?.toUpperCase() ?? '?'}
          </AvatarFallback>
        </Avatar>
      ) : (
        <div className="size-7 shrink-0 rounded-full bg-muted" />
      )}

      <div className="flex-1 min-w-0 flex items-center gap-2">
        {/* Always-visible, editable time chip */}
        {editingTime ? (
          <span className="shrink-0 inline-flex items-center gap-1 rounded-full border border-primary/50 bg-primary/10 px-2 py-1">
            <Clock className="size-3 text-primary shrink-0" />
            <input
              autoFocus
              value={timeDraft}
              inputMode="numeric"
              aria-label="Comment time"
              onChange={(e) => setTimeDraft(e.target.value)}
              onBlur={commitTime}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitTime(); }
                if (e.key === 'Escape') { e.preventDefault(); setEditingTime(false); }
              }}
              className="w-12 bg-transparent text-xs font-medium tabular-nums text-primary outline-none"
            />
          </span>
        ) : (
          <button
            type="button"
            onClick={beginEditTime}
            disabled={!user}
            title={following ? 'Following playback — click to set a time' : 'Click to change the time'}
            className={cn(
              'shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium tabular-nums transition-colors disabled:opacity-60',
              following
                ? 'bg-primary/10 text-primary hover:bg-primary/20'
                : 'bg-amber-500/15 text-amber-600 hover:bg-amber-500/25',
            )}
          >
            <Clock className="size-3 shrink-0" />
            {formatCommentPosition(position)}
          </button>
        )}

        {/* Snap back to live playback once the user has pinned a time */}
        {!following && !editingTime && (
          <button
            type="button"
            onClick={syncToPlayback}
            title="Use current playback time"
            aria-label="Use current playback time"
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
          >
            <RotateCcw className="size-3.5" />
          </button>
        )}

        <input
          type="text"
          value={content}
          disabled={!user}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } }}
          placeholder={user ? 'Add a comment…' : 'Sign in to comment'}
          className="flex-1 min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        />
      </div>

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); void submit(); }}
        disabled={!user || !content.trim() || isPending}
        aria-label="Post timed comment"
        className={cn(
          'shrink-0 size-8 rounded-full flex items-center justify-center transition-colors',
          content.trim() && user
            ? 'bg-primary text-primary-foreground hover:bg-primary/90'
            : 'bg-muted text-muted-foreground',
        )}
      >
        <Send className="size-4" />
      </button>
    </div>
  );
}
