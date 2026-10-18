import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, Music, MessageCircle, ArrowUpRight } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';
import { useAudioPlayer } from '@/contexts/audioPlayerContextDef';
import { useAuthor } from '@/hooks/useAuthor';
import { useWaveformPeaks } from '@/hooks/useWaveformPeaks';
import { useTimedComments } from '@/hooks/useTimedComments';
import { parseMusicTrack, toAudioTrack } from '@/lib/musicHelpers';
import { sanitizeUrl } from '@/lib/sanitizeUrl';
import { formatTime } from '@/lib/formatTime';
import { isNostrId } from '@/lib/nostrId';
import { layoutTimedComments } from '@/lib/timedComments';
import { Waveform } from '@/components/Waveform';
import { TimedCommentMarker, TimedCommentComposer } from '@/components/TimedCommentLayer';
import { ReplyComposeModal } from '@/components/ReplyComposeModal';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface MusicTrackRowProps {
  /** The music track event. */
  event: NostrEvent;
  /** Optional row index (displayed when not hovering/playing). */
  index?: number;
}

/**
 * How long a single click waits before it commits to its action (open the
 * composer), so the first half of a double click never opens one on its way to
 * the track page. Kept short — the composer is the row's primary action.
 */
const SINGLE_CLICK_DELAY_MS = 250;

/** True for a plain left click — modified and middle clicks must keep their
 *  native link behaviour (open in a new tab / window). */
function isPlainLeftClick(e: React.MouseEvent): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

/**
 * Compact track row for "Recently Added" sections and the Tracks tab.
 *
 * Layout: [index/play] [artwork] [title + artist] [duration]
 *
 * **States**:
 * - Default: Shows row index, muted text
 * - Hover: Index replaced with play icon
 * - Now playing: Primary-colored title, pause icon, subtle bg tint
 * - No artwork: Small Music icon placeholder
 *
 * **Click behaviour**: a single click comments (starts the track and opens the
 * timed-comment composer at the playhead), a double click opens the track's own
 * page. Signed-out listeners have no composer, so a single click opens the track
 * page for them. The row stays a real link, so modified/middle clicks, keyboard
 * activation and the explicit "open track page" button keep working.
 */
export function MusicTrackRow({ event, index }: MusicTrackRowProps) {
  const player = useAudioPlayer();
  const parsed = useMemo(() => parseMusicTrack(event), [event]);
  const author = useAuthor(event.pubkey);
  const [imgError, setImgError] = useState(false);
  // Decode the waveform only when the row is hovered or is the current track —
  // decoding downloads the audio, so doing it for every row up front is costly.
  const [hovered, setHovered] = useState(false);
  const [replyTarget, setReplyTarget] = useState<NostrEvent | null>(null);
  const [commentTime, setCommentTime] = useState<number | null>(null);
  const { user } = useCurrentUser();
  const navigate = useNavigate();
  // Hover-to-comment timer (opens the composer after 2s over the waveform).
  const hoverTimer = useRef<number | null>(null);
  const hoverRatio = useRef<number | null>(null);
  // Pending single-click action (see SINGLE_CLICK_DELAY_MS).
  const clickTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    if (clickTimer.current !== null) window.clearTimeout(clickTimer.current);
  }, []);
  const isNowPlaying = player.currentTrack?.id === event.id;
  const peaks = useWaveformPeaks(parsed?.url, hovered || isNowPlaying);
  const isReal = isNostrId(event.id) && event.sig.length > 0;
  const { comments } = useTimedComments(isReal ? event : undefined);

  const naddrPath = useMemo(() => {
    const d = event.tags.find(([n]) => n === 'd')?.[1] ?? '';
    return '/' + nip19.naddrEncode({ kind: event.kind, pubkey: event.pubkey, identifier: d });
  }, [event]);

  if (!parsed) return null;

  const dur = parsed.duration ? formatTime(parsed.duration) : undefined;

  const handlePlay = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isNowPlaying && player.isPlaying) {
      player.pause();
    } else if (isNowPlaying) {
      player.resume();
    } else {
      const track = toAudioTrack(event, parsed);
      track.artwork ??= sanitizeUrl(author.data?.metadata?.picture);
      player.playTrack(track);
    }
  };

  /** Start the track (if needed) and seek to an absolute position in seconds. */
  const seekTo = (seconds: number) => {
    const total = parsed.duration ?? 0;
    const target = total > 0 ? Math.min(seconds, total) : seconds;
    if (isNowPlaying) {
      player.seek(target);
    } else {
      const track = toAudioTrack(event, parsed);
      track.artwork ??= sanitizeUrl(author.data?.metadata?.picture);
      // Play from the clicked point: the player applies startTime once the
      // media metadata loads (a fixed timeout raced the load and played from 0).
      player.playTrack({ ...track, startTime: target });
    }
  };

  /** Clicking the waveform starts the track (if needed) and seeks to the point. */
  const handleWaveformSeek = (ratio: number) => {
    const total = parsed.duration ?? 0;
    if (total <= 0) return;
    seekTo(ratio * total);
    // Signed-in listeners can also drop a timed comment at the clicked point.
    if (user && isReal) setCommentTime(ratio * total);
  };

  /** Open the inline timed-comment composer (at the playback position if this
   *  track is playing, else at 0 — the composer's time chip is editable). */
  const openComment = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user || !isReal) return;
    setCommentTime(isNowPlaying ? Math.max(0, player.currentTime) : 0);
  };

  // Hovering the waveform for 2s opens the comment composer at the hovered
  // point, so commenting is discoverable without a click.
  const clearHoverTimer = () => {
    if (hoverTimer.current !== null) { window.clearTimeout(hoverTimer.current); hoverTimer.current = null; }
  };
  const startHoverTimer = () => {
    clearHoverTimer();
    if (!user || !isReal || commentTime !== null) return;
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null;
      const total = parsed?.duration ?? 0;
      const at = hoverRatio.current !== null && total > 0
        ? hoverRatio.current * total
        : (isNowPlaying ? player.currentTime : 0);
      setCommentTime(Math.max(0, at));
    }, 2000);
  };

  /** Start the track, keeping its artwork fallback consistent everywhere. */
  const startTrack = () => {
    const track = toAudioTrack(event, parsed);
    track.artwork ??= sanitizeUrl(author.data?.metadata?.picture);
    player.playTrack(track);
  };

  /** Open the track's page; start it in the global player so the mini player
   *  keeps playing across the navigation. */
  const openTrack = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isNowPlaying) startTrack();
    navigate(naddrPath);
  };

  const clearClickTimer = () => {
    if (clickTimer.current !== null) {
      window.clearTimeout(clickTimer.current);
      clickTimer.current = null;
    }
  };

  /**
   * Single click = comment, double click = open the track page.
   *
   * Playback still starts on the very first click (no delay), so the track is
   * already playing when the second click navigates — the mini player then keeps
   * it going on the track page.
   */
  const handleRowClick = (e: React.MouseEvent) => {
    if (!isPlainLeftClick(e)) return;
    e.preventDefault();

    const commentAt = isNowPlaying ? Math.max(0, player.currentTime) : 0;
    if (!isNowPlaying) startTrack();

    // Keyboard/assistive activation (a click with `detail: 0`) must follow the
    // link, and a signed-out listener has no composer to open — both keep the
    // row's old behaviour of going straight to the track page.
    if (e.detail === 0 || !user || !isReal) {
      navigate(naddrPath);
      return;
    }

    if (clickTimer.current !== null) {
      // Second click inside the window: a double click, not a comment.
      clearClickTimer();
      setCommentTime(null);
      navigate(naddrPath);
      return;
    }

    clickTimer.current = window.setTimeout(() => {
      clickTimer.current = null;
      if (user && isReal) setCommentTime(commentAt);
    }, SINGLE_CLICK_DELAY_MS);
  };

  /** The OS double-click window can outlast SINGLE_CLICK_DELAY_MS, in which case
   *  the composer is already open — close it before leaving for the track page. */
  const handleRowDoubleClick = (e: React.MouseEvent) => {
    if (!isPlainLeftClick(e)) return;
    clearClickTimer();
    setCommentTime(null);
    navigate(naddrPath);
  };

  const progress = isNowPlaying && player.duration > 0
    ? Math.max(0, Math.min(1, player.currentTime / player.duration))
    : 0;

  return (
    <>
    <Link
      to={naddrPath}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      // Single click comments at the playhead; double click opens the track
      // page. Playback starts on the first click either way, so it continues
      // seamlessly in the mini player across the navigation.
      onClick={handleRowClick}
      onDoubleClick={handleRowDoubleClick}
      className={cn(
        'flex items-center gap-3 px-4 py-2.5 transition-colors cursor-pointer group',
        isNowPlaying ? 'bg-primary/5' : 'hover:bg-secondary/30',
      )}
    >
      {/* Index / Play button */}
      <button
        onClick={handlePlay}
        className="size-8 flex items-center justify-center shrink-0"
        aria-label={isNowPlaying && player.isPlaying ? 'Pause' : 'Play'}
      >
        {isNowPlaying && player.isPlaying ? (
          <Pause className="size-4 text-primary" fill="currentColor" />
        ) : (
          <>
            <span className="text-sm text-muted-foreground group-hover:hidden tabular-nums">
              {index !== undefined ? index + 1 : ''}
            </span>
            <Play className="size-4 text-muted-foreground hidden group-hover:block" fill="currentColor" />
          </>
        )}
      </button>

      {/* Artwork */}
      <div className="size-12 rounded-lg overflow-hidden shrink-0 bg-muted">
        {parsed.artwork && !imgError ? (
          <img src={parsed.artwork} alt={parsed.title} className="size-full object-cover" loading="lazy" onError={() => setImgError(true)} />
        ) : (
          <div className="size-full flex items-center justify-center bg-primary/10">
            <Music className="size-5 text-primary/30" />
          </div>
        )}
      </div>

      {/* Info + waveform diagram with commenter avatars */}
      <div className="flex-1 min-w-0">
        <p className={cn(
          'text-sm font-medium truncate',
          isNowPlaying && 'text-primary',
        )}>
          {parsed.title}
        </p>
        <p className="text-xs text-muted-foreground truncate">{parsed.artist}</p>
        <div
          className="relative mt-1.5"
          onClick={(e) => e.stopPropagation()}
          onMouseEnter={startHoverTimer}
          onMouseLeave={clearHoverTimer}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            hoverRatio.current = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          }}
        >
          <Waveform
            peaks={peaks}
            progress={progress}
            onSeek={parsed.duration ? handleWaveformSeek : undefined}
            className="h-9"
            ariaLabel={`${parsed.title} waveform`}
          >
            {parsed.duration && comments.length > 0 && (
              <div className="absolute inset-x-0 bottom-0 h-6 mx-1 pointer-events-none">
                {layoutTimedComments(comments, parsed.duration, 1.6, 3).map(({ comment, lane }) => (
                  <TimedCommentMarker
                    key={comment.event.id}
                    comment={comment}
                    duration={parsed.duration!}
                    lane={lane}
                    size="sm"
                    onJump={seekTo}
                    onReply={setReplyTarget}
                  />
                ))}
              </div>
            )}
          </Waveform>
          {user && isReal && (
            <button
              type="button"
              onClick={openComment}
              title="Comment at a time"
              aria-label="Comment at a time"
              className="absolute bottom-0.5 right-0 inline-flex items-center gap-1 rounded-full bg-background/85 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm ring-1 ring-border hover:text-foreground hover:bg-background transition-colors"
            >
              <MessageCircle className="size-3" />
              comment
            </button>
          )}
        </div>
      </div>

      {/* Actions: comment-at-time + open track (playback continues), + duration */}
      <div className="flex items-center gap-1 shrink-0">
        {user && isReal && (
          <button
            onClick={openComment}
            title="Comment at a time"
            aria-label="Comment at a time"
            className="p-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <MessageCircle className="size-4" />
          </button>
        )}
        <button
          onClick={openTrack}
          title="Open track page"
          aria-label="Open track page"
          className="p-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <ArrowUpRight className="size-4" />
        </button>
        {dur && (
          <span className="text-xs text-muted-foreground tabular-nums">{dur}</span>
        )}
      </div>
    </Link>
    {commentTime !== null && (
      <div className="border-b border-border bg-background">
        <TimedCommentComposer
          event={event}
          currentTime={commentTime}
          duration={parsed.duration ?? 0}
          position={commentTime}
          onClose={() => setCommentTime(null)}
          autoFocus
        />
      </div>
    )}
    {replyTarget && (
      <ReplyComposeModal
        event={replyTarget}
        open
        onOpenChange={(open) => { if (!open) setReplyTarget(null); }}
      />
    )}
    </>
  );
}

/** Loading skeleton matching MusicTrackRow dimensions. */
export function MusicTrackRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <Skeleton className="size-8 rounded" />
      <Skeleton className="size-12 rounded-lg" />
      <div className="flex-1 min-w-0 space-y-1">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      <Skeleton className="h-3 w-8" />
    </div>
  );
}
