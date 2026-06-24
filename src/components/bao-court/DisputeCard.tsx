import { memo } from "react";
import { Gavel, Clock } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { BaoCourtDispute } from "@/hooks/useBaoCourtDisputes";

interface DisputeCardProps {
  dispute: BaoCourtDispute;
  onSelect: (dispute: BaoCourtDispute) => void;
  disabled?: boolean;
}

function formatDeadline(timestamp: number): string {
  if (!timestamp || timestamp <= 0) return "No deadline";
  return new Date(timestamp * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function truncatePubkey(pubkey: string): string {
  if (pubkey.length <= 12) return pubkey;
  return `${pubkey.slice(0, 6)}…${pubkey.slice(-6)}`;
}

export const DisputeCard = memo(function DisputeCard({ dispute, onSelect, disabled }: DisputeCardProps) {
  return (
    <Card className="flex flex-col hover:border-primary/50 transition-colors">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Gavel className="size-5 shrink-0 text-primary" />
            <CardTitle className="text-base leading-snug line-clamp-2">
              {dispute.proposedOutcome}
            </CardTitle>
          </div>
          <Badge
            variant={dispute.status === "open" ? "default" : "secondary"}
            className={cn(
              "shrink-0 capitalize",
              dispute.status === "open" && "bg-green-600 hover:bg-green-700",
            )}
          >
            {dispute.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-3">
        <p className="text-sm text-muted-foreground line-clamp-2">
          {dispute.originalOutcome
            ? `Original outcome: ${dispute.originalOutcome}`
            : "No original outcome provided."}
        </p>

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">{truncatePubkey(dispute.challengerPubkey)}</span>
          <span>•</span>
          <span className="flex items-center gap-1">
            <Clock className="size-3" />
            {formatDeadline(dispute.deadline)}
          </span>
        </div>

        <div className="mt-auto">
          <Button size="sm" className="w-full" onClick={() => onSelect(dispute)} disabled={disabled}>
            {disabled ? 'Assembling demo jury…' : 'View dispute'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
});
