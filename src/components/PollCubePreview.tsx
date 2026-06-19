import { HostedPollCube } from '@/components/HostedPollCube';
import { useHostedCubeEmbed } from '@/hooks/useHostedCubeEmbed';

interface PollCubePreviewProps {
  pollId: string;
  title?: string;
}

/**
 * Silently checks whether a hosted BAO cube exists for a poll and renders it.
 * Shows nothing while loading or when no cube is available, so it is safe to
 * embed inline on poll detail pages without cluttering polls without cubes.
 */
export function PollCubePreview({ pollId, title }: PollCubePreviewProps) {
  const { data: embedUrl, isLoading } = useHostedCubeEmbed(pollId);
  if (isLoading || !embedUrl) return null;
  return <HostedPollCube pollId={pollId} title={title} className="mb-4 h-80" />;
}
