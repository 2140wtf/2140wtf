import { PollCube } from '@/components/PollCube';

interface HostedPollCubeProps {
  pollId: string;
  title?: string;
  className?: string;
}

/**
 * Render a BAO-style 3D poll cube.
 *
 * The cube is built locally from the poll event, vote counts, and the BAO
 * cube-design API (for branding/wall images). This avoids the
 * X-Frame-Options restriction that blocks the hosted iframe on third-party
 * origins.
 */
export function HostedPollCube({ pollId, title, className }: HostedPollCubeProps) {
  return <PollCube pollId={pollId} title={title} className={className} />;
}
