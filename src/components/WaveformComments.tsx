/**
 * SoundCloud-style waveform diagram with timed comments for a music track.
 *
 * Renders the audio's real waveform (decoded & cached via `useWaveformPeaks`),
 * overlays the timed-comment avatars at their moments, and includes the
 * position composer. Used on the track detail page and in track rows.
 */

import { useState } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';

import { Waveform } from '@/components/Waveform';
import { TimedCommentMarker, TimedCommentComposer } from '@/components/TimedCommentLayer';
import { ReplyComposeModal } from '@/components/ReplyComposeModal';
import { isNostrId } from '@/lib/nostrId';
import { cn } from '@/lib/utils';
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

  const hasDuration = duration > 0 && Number.isFinite(duration);
  const progress = hasDuration ? Math.max(0, Math.min(1, currentTime / duration)) : 0;

  if (!isReal) return null;

  return (
    <div className={cn('border-t border-border bg-background', className)}>
      <div className="px-3 pt-2.5">
        <Waveform
          peaks={peaks}
          progress={progress}
          onSeek={hasDuration ? (ratio) => onSeek(ratio * duration) : undefined}
          className={waveformClassName}
          ariaLabel="Track waveform — click to seek"
        >
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
        </Waveform>
      </div>

      <TimedCommentComposer event={event} currentTime={currentTime} duration={duration} />

      <ReplyComposeModal
        event={replyTarget ?? undefined}
        open={!!replyTarget}
        onOpenChange={(open) => { if (!open) setReplyTarget(null); }}
      />
    </div>
  );
}
