import { Check, Eye, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { timeAgo } from '@/lib/timeAgo';
import { ROADSTR_EVENT_TYPES } from './roadstrTypes';
import { type RoadstrReport } from '@/lib/roadstr';

interface RoadstrPopupContentProps {
  report: RoadstrReport;
  stillThere: number;
  noLongerThere: number;
  onConfirm: (status: 'still_there' | 'no_longer_there') => void;
  onViewDetails: () => void;
}

export function RoadstrPopupContent({
  report,
  stillThere,
  noLongerThere,
  onConfirm,
  onViewDetails,
}: RoadstrPopupContentProps): React.JSX.Element {
  const { user } = useCurrentUser();
  const cfg = ROADSTR_EVENT_TYPES[report.type];

  return (
    <div className="font-sans text-[13px] min-w-[180px] max-w-[260px]">
      <div className="font-semibold mb-0.5" style={{ color: cfg.color }}>
        {cfg.label}
      </div>
      <div className="text-xs text-muted-foreground">
        {report.lat.toFixed(5)}, {report.lon.toFixed(5)}
      </div>
      <div className="text-xs text-muted-foreground mt-0.5">
        {timeAgo(report.createdAt)}
      </div>
      {report.comment && (
        <div className="text-xs text-foreground mt-2 line-clamp-3">
          {report.comment}
        </div>
      )}

      <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Check className="size-3 text-emerald-500" />
          {stillThere}
        </span>
        <span className="flex items-center gap-1">
          <X className="size-3 text-rose-500" />
          {noLongerThere}
        </span>
      </div>

      <div className="flex flex-col gap-2 mt-3">
        {user ? (
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="flex-1 h-8 text-xs gap-1"
              onClick={() => onConfirm('still_there')}
            >
              <Check className="size-3" />
              Still there
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="flex-1 h-8 text-xs gap-1"
              onClick={() => onConfirm('no_longer_there')}
            >
              <X className="size-3" />
              Gone
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic">Log in to confirm this report.</p>
        )}

        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="w-full h-8 text-xs gap-1"
          onClick={onViewDetails}
        >
          <Eye className="size-3" />
          View details
        </Button>
      </div>
    </div>
  );
}
