import { Bell, Gavel, ScrollText, ShieldQuestion } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { sanitizeDisplayText, shortIdentifier } from "@/lib/displayText";
import {
  SUMMONS_SELECTION_KIND,
  type CourtSummonsNotice,
} from "@/hooks/useMySummons";

function kindLabel(kind: CourtSummonsNotice["kind"]): string {
  return kind === SUMMONS_SELECTION_KIND ? "Jury selection" : "Court summons";
}

function KindIcon({ kind }: { kind: CourtSummonsNotice["kind"] }) {
  return kind === SUMMONS_SELECTION_KIND
    ? <Gavel className="size-4 shrink-0 text-muted-foreground" />
    : <ScrollText className="size-4 shrink-0 text-muted-foreground" />;
}

export interface SummonsNoticeCardProps {
  /** Unseen (neither dismissed nor acked) summons, newest first. */
  readonly notices: readonly CourtSummonsNotice[];
  readonly ackedEventIds: readonly string[];
  readonly pendingAckEventId: string | null;
  readonly ackError: string | null;
  readonly onAck: (notice: CourtSummonsNotice) => void;
  /** Dismiss the whole panel (marks everything seen — NOT acked). */
  readonly onDismiss: () => void;
}

const MAX_VISIBLE = 5;

/**
 * The summons notification surface (R1): rostered jurors get a visible,
 * actionable list of their #p-tagged court summons with a one-click Ack
 * (§6 ack-on-receipt). Rendered at the top of the JurorDashboard; the unread
 * count also badges the dashboard tab.
 */
export function SummonsNoticeCard({
  notices,
  ackedEventIds,
  pendingAckEventId,
  ackError,
  onAck,
  onDismiss,
}: SummonsNoticeCardProps) {
  const actionable = notices.filter((n) => !ackedEventIds.includes(n.eventId));
  if (actionable.length === 0) return null;
  const visible = actionable.slice(0, MAX_VISIBLE);

  return (
    <Card className="border-amber-500/40 bg-amber-500/5">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="size-4 text-amber-500" />
            <p className="font-medium">
              You've been summoned
              {actionable.length > MAX_VISIBLE ? ` (${actionable.length})` : ""}
            </p>
            <Badge variant="outline" className="border-amber-500/60 text-amber-600">
              {actionable.length} pending
            </Badge>
          </div>
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>

        <ul className="space-y-2">
          {visible.map((notice) => {
            const isPending = pendingAckEventId === notice.eventId;
            // Attacker-controlled strings: rendered as TEXT only (React
            // escapes), but bidi/control characters and absurd lengths are
            // stripped so a hostile event cannot reorder or stretch the row.
            const caseLabel = shortIdentifier(notice.caseId, 20);
            const outcomeLabel = sanitizeDisplayText(notice.proposedOutcome, { maxChars: 32 });
            return (
              <li
                key={notice.eventId}
                className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <KindIcon kind={notice.kind} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{kindLabel(notice.kind)}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      Case {caseLabel}
                      {outcomeLabel ? ` · proposed ${outcomeLabel}` : ""}
                    </p>
                  </div>
                  {!notice.attributed && (
                    <span
                      className="flex shrink-0 items-center gap-1 text-xs text-amber-600 dark:text-amber-400"
                      data-testid="summons-unverified-publisher"
                      title="Any key can publish a #p-tagged event to this npub. This notice was not published by the pinned court authority; the summons board on the server is the authority for acknowledging it."
                    >
                      <ShieldQuestion className="size-3.5" aria-hidden />
                      unverified publisher
                    </span>
                  )}
                </div>
                <Button
                  size="sm"
                  onClick={() => onAck(notice)}
                  disabled={isPending}
                >
                  {isPending ? "Acknowledging…" : "Acknowledge"}
                </Button>
              </li>
            );
          })}
        </ul>

        {ackError && (
          <p className="text-xs text-destructive">
            Ack failed: {sanitizeDisplayText(ackError, { maxChars: 200 })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
