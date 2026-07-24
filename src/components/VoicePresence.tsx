/**
 * STUB (voice cut). Armada's `VoicePresence` renders Discord-style voice
 * presence (participant rosters under voice channels). The ₿AO build ships no
 * voice stack (no CallProvider / LiveKit / voice broker), so both components
 * render nothing under the same props.
 */

/** Discord-style nested voice roster (voice cut — renders nothing). */
export function VoiceParticipantList({
  participants: _participants,
  speaking: _speaking,
  muted: _muted,
  raised: _raised,
  className: _className,
}: {
  participants: readonly string[];
  speaking?: ReadonlySet<string>;
  muted?: ReadonlySet<string>;
  raised?: ReadonlySet<string>;
  className?: string;
}) {
  return null;
}

/** Voice presence summary (voice cut — renders nothing). */
export function VoicePresence(_props: Record<string, unknown>) {
  return null;
}
