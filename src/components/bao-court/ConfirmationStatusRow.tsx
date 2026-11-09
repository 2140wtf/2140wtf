/**
 * ConfirmationStatusRow - compact pending/confirmed/final row with a
 * batch-verified checkmark, shared by DisputeCard and DisputeStatusCard.
 * Derived exclusively from observed relay events (see
 * useCourtConfirmations.ts for the derivation contract).
 */
import { ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import type { CourtConfirmationStatus } from "@/hooks/useCourtConfirmations";

const STAGE_LABELS: Record<CourtConfirmationStatus["stage"], string> = {
  pending: "pending",
  confirmed: "confirmed",
  final: "final",
};

const STAGE_CLASSES: Record<CourtConfirmationStatus["stage"], string> = {
  pending: "bg-muted text-muted-foreground",
  confirmed: "bg-green-600/15 text-green-700 dark:text-green-400",
  final: "bg-green-600 text-primary-foreground",
};

export function ConfirmationStatusRow({
  status,
  className,
}: {
  status: CourtConfirmationStatus | null | undefined;
  className?: string;
}) {
  if (!status) return null;
  return (
    <div
      className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)}
      data-testid="court-confirmation-status"
      data-stage={status.stage}
    >
      <span>Confirmations:</span>
      <span
        className={cn(
          "rounded-full px-2 py-0.5 font-medium capitalize",
          STAGE_CLASSES[status.stage],
        )}
      >
        {STAGE_LABELS[status.stage]}
      </span>
      <span
        aria-label={`${status.confirmations} of ${status.threshold} juror confirmations`}
        title="Distinct pubkeys observed on the relay; not verified to be empaneled jurors"
      >
        {status.confirmations}/{status.threshold}
      </span>
      {status.challenged && (
        <span className="text-amber-600 dark:text-amber-400" title="A challenge was observed">
          challenged
        </span>
      )}
      {status.verified && (
        <span
          className="flex items-center gap-1 text-green-700 dark:text-green-400"
          title="Included in a verified epoch batch attestation"
        >
          <ShieldCheck className="size-3.5" aria-hidden />
          batch verified
        </span>
      )}
    </div>
  );
}
