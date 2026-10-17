/**
 * SoundCloud-style waveform diagram with timed comments for a music track.
 *
 * Renders the audio's real waveform (decoded & cached via `useWaveformPeaks`),
 * overlays the timed-comment avatars at their moments, and includes the
 * position composer. Used on the track detail page and in track rows.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';

import { Waveform } from '@/components/Waveform';
import { TimedCommentMarker, TimedCommentComposer } from '@/components/TimedCommentLayer';
import { ReplyComposeModal } from '@/components/ReplyComposeModal';
import { isNostrId } from '@/lib/nostrId';
import { layoutTimedComments } from '@/lib/timedComments';
import { cn } from '@/lib/utils';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useTimedComments } from '@/hooks/useTimedComments';
import { useWaveformPeaks } from '@/hooks/useWaveformPeaks';

interface WaveformCommentsProps {
  /** The music track (comment root; also the event the waveform belongs to). */
  event: NostrEvent;
  /** Audio URL to decode and draw. */
  src: string;
  /** Track duration in seconds. */
  duration: number;
  /** Current playback position in seconds. */
  currentTime: number;
  /** Seek to an absolute position in seconds. */
  onSeek: (seconds: number) => void;
  /** Class for the outer wrapper. */
  className?: string;
  /** Diagram height class (default `h-16`). */
  waveformClassName?: string;
}

export function WaveformComments({
  event,
  src,
  duration,
  currentTime,
  onSeek,
  className,
  waveformClassName = 'h-16',
}: WaveformCommentsProps) {
  const isReal = isNostrId(event.id) && event.sig.length > 0;
  const peaks = useWaveformPeaks(src, isReal && !!src);
  const { comments } = useTimedComments(isReal ? event : undefined);
  const [replyTarget, setReplyTarget] = useState<NostrEvent | null>(null);
  const { user } = useCurrentUser();
  // Hover-to-comment: resting the pointer over the diagram for 2s pins the
  // composer to the hovered point and focuses it (parity with the track rows).
  const [hoverCommentAt, setHoverCommentAt] = useState<number | null>(null);
  const [focusToken, setFocusToken] = useState(0);
  const hoverTimerRef = useRef<number | null>(null);
  const hoverRatioRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
  }, []);

  const hasDuration = duration > 0 && Number.isFinite(duration);
  const progress = hasDuration ? Math.max(0, Math.min(1, currentTime / duration)) : 0;

  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  /**
   * After 2s of resting over the diagram, pin the composer to the hovered point
   * and focus it. Does not seek — a click still owns seeking, so a rest of the
   * pointer can never move the track.
   */
  const startHoverTimer = useCallback(() => {
    clearHoverTimer();
    // Signed-in only: the composer input is disabled for everyone else.
    if (!isReal || !user) return;
    hoverTimerRef.current = window.setTimeout(() => {
      hoverTimerRef.current = null;
      const ratio = hoverRatioRef.current;
      const at = ratio !== null && hasDuration ? ratio * duration : currentTime;
      setHoverCommentAt(Math.max(0, at));
      setFocusToken((n) => n + 1);
    }, 2000);
  }, [clearHoverTimer, isReal, user, hasDuration, duration, currentTime]);

  if (!isReal) return null;

  return (
    <div className={cn('border-t border-border bg-background', className)}>
      <div className="px-3 pt-2.5">
        <div
          className="relative"
          onMouseEnter={startHoverTimer}
          onMouseLeave={clearHoverTimer}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            hoverRatioRef.current = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          }}
        >
          <Waveform
            peaks={peaks}
            progress={progress}
            onSeek={hasDuration ? (ratio) => onSeek(ratio * duration) : undefined}
            className={waveformClassName}
            ariaLabel="Track waveform — click to seek"
            tilt
          >
            {hasDuration && (
              <div className="absolute inset-x-0 bottom-0 h-6 mx-2 pointer-events-none">
                {layoutTimedComments(comments, duration, 1.6, 4).map(({ comment, lane }) => (
                  <TimedCommentMarker
                    key={comment.event.id}
                    comment={comment}
                    duration={duration}
                    lane={lane}
                    size="sm"
                    onJump={onSeek}
                    onReply={setReplyTarget}
                  />
                ))}
              </div>
            )}
          </Waveform>
        </div>
      </div>

      <TimedCommentComposer
        event={event}
        currentTime={currentTime}
        duration={duration}
        position={hoverCommentAt ?? undefined}
        focusToken={focusToken}
      />

      <ReplyComposeModal
        event={replyTarget ?? undefined}
        open={!!replyTarget}
        onOpenChange={(open) => { if (!open) setReplyTarget(null); }}
      />
    </div>
  );
}
