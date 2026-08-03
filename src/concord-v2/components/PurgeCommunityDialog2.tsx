import { Loader2, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { purgeCommunityLocalData } from "@/concord-v2/lib/purgeCommunity";
import type { CommunityV2 } from "@/concord-v2/lib/types";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { toast } from "@/hooks/useToast";
import { useQueryClient } from "@tanstack/react-query";

interface PurgeCommunityDialog2Props {
  community: CommunityV2 | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Confirm + run the per-community local purge (P1-5). Manual and explicit by
 * design: this wipes the community's DECRYPTED data on this device only — the
 * membership and its keys stay, nothing changes for other members or devices,
 * and the community re-syncs from its relays on next open.
 */
export function PurgeCommunityDialog2({ community, open, onOpenChange }: PurgeCommunityDialog2Props) {
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!community || busy) return;
    setBusy(true);
    setError(null);
    try {
      await purgeCommunityLocalData(community, { userPubkey: user?.pubkey, queryClient });
      toast({
        title: "Local data deleted",
        description: "Decrypted copies on this device were wiped. The community re-syncs from its relays when you open it.",
      });
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete the local data.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete local data for {community?.name ?? "this community"}?</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2">
              <p>
                This wipes the community&apos;s decrypted messages, roster caches, invite copies, and
                read state <span className="text-foreground font-medium">on this device only</span>.
              </p>
              <p>
                You stay a member — keys are kept, nothing changes for other members or your other
                devices, and the community re-downloads from its relays the next time you open it.
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={run} disabled={busy || !community}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            {busy ? "Deleting" : "Delete local data"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
