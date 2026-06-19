import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { MapPin } from 'lucide-react';
import type { NostrEvent } from '@nostrify/nostrify';
import { encodeEventAddress } from '@/lib/encodeEvent';
import { timeAgo } from '@/lib/timeAgo';
import { cn } from '@/lib/utils';
import {
  computeEffectiveExpiry,
  isRoadstrReportActive,
  parseRoadstrConfirmation,
  parseRoadstrReport,
  type RoadstrConfirmation,
} from '@/lib/roadstr';
import { ROADSTR_EVENT_TYPES } from '@/components/roadstr/roadstrTypes';

interface RoadstrReportContentProps {
  event: NostrEvent;
  /** If true, render the expanded detail view instead of the compact feed card. */
  expanded?: boolean;
  /** Optional confirmations to compute effective expiry; otherwise parsed from children events is not possible here. */
  confirmations?: RoadstrConfirmation[];
  className?: string;
}

/**
 * Render a Roadstr kind 1315 report inside feeds and detail pages.
 * Includes the event type, location, optional comment, and confirmation counts.
 */
export function RoadstrReportContent({
  event,
  expanded = false,
  confirmations = [],
  className,
}: RoadstrReportContentProps): React.JSX.Element | null {
  const report = useMemo(() => parseRoadstrReport(event), [event]);
  const reportConfirmations = useMemo(
    () => confirmations.filter((c) => c.reportId === event.id),
    [confirmations, event.id],
  );
  const stillThere = reportConfirmations.filter((c) => c.status === 'still_there').length;
  const noLongerThere = reportConfirmations.filter((c) => c.status === 'no_longer_there').length;

  const encodedId = useMemo(() => encodeEventAddress(event), [event]);

  if (!report) return null;

  const config = ROADSTR_EVENT_TYPES[report.type];
  const Icon = config.icon;
  const now = Math.floor(Date.now() / 1000);
  const active = isRoadstrReportActive(report, reportConfirmations, now);
  const effectiveExpiry = computeEffectiveExpiry(report, reportConfirmations);

  const coordinates = `${report.lat.toFixed(5)}, ${report.lon.toFixed(5)}`;

  return (
    <div className={cn('rounded-xl border border-border bg-card/50', className)}>
      <div className="p-3 sm:p-4">
        <div className="flex items-start gap-3">
          <div
            className="shrink-0 flex items-center justify-center size-10 rounded-full"
            style={{ backgroundColor: `${config.color}20`, color: config.color }}
          >
            <Icon className="size-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-foreground">{config.label}</span>
              {!active && (
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                  expired
                </span>
              )}
              <Link
                to={`/${encodedId}`}
                className="ml-auto text-xs text-muted-foreground hover:text-primary hover:underline shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                {timeAgo(report.createdAt)}
              </Link>
            </div>

            <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-1">
              <MapPin className="size-3.5 shrink-0" />
              <span className="truncate">{coordinates}</span>
            </div>

            {report.comment ? (
              <p className="mt-2 text-sm text-foreground whitespace-pre-wrap break-words">
                {report.comment}
              </p>
            ) : null}

            {(stillThere > 0 || noLongerThere > 0 || expanded) && (
              <div className="flex items-center gap-3 mt-2 text-xs">
                {stillThere > 0 && (
                  <span className="text-green-600 dark:text-green-400">
                    {stillThere} still there
                  </span>
                )}
                {noLongerThere > 0 && (
                  <span className="text-destructive">
                    {noLongerThere} gone
                  </span>
                )}
                {expanded && (
                  <span className="text-muted-foreground">
                    {active
                      ? `Expires ${timeAgo(effectiveExpiry)}`
                      : 'Expired'}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Render a kind 1316 Roadstr confirmation/denial when encountered directly.
 */
export function RoadstrConfirmationContent({
  event,
  className,
}: {
  event: NostrEvent;
  className?: string;
}): React.JSX.Element | null {
  const confirmation = useMemo(() => parseRoadstrConfirmation(event), [event]);
  const encodedId = useMemo(() => encodeEventAddress(event), [event]);

  if (!confirmation) return null;

  const label = confirmation.status === 'still_there' ? 'confirmed a road event' : 'marked a road event as gone';

  return (
    <div className={cn('text-sm text-muted-foreground', className)}>
      <Link to={`/${encodedId}`} className="hover:text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
        {label}
      </Link>
      {' · '}
      {timeAgo(confirmation.createdAt)}
    </div>
  );
}
