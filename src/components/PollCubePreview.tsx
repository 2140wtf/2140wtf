import { HostedPollCube } from '@/components/HostedPollCube';

interface PollCubePreviewProps {
  pollId: string;
  title?: string;
}

/**
 * Renders a BAO cube embed preview for a poll.
 *
 * The cube is resolved via the BAO cube-design API (with deterministic fallback),
 * so a cube is shown for any poll.
 */
export function PollCubePreview({ pollId, title }: PollCubePreviewProps) {
  return <HostedPollCube pollId={pollId} title={title} className="mb-4 h-[420px] flex items-center justify-center" />;
}
