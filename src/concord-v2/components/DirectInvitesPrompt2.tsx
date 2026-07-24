import { Loader2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import * as nip19 from "nostr-tools/nip19";

import { BaoMark as ArmadaCrest, BaoMarkKeyframes as ArmadaCrestKeyframes } from "@/components/brand/BaoMark";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  ChromeDialogContent,
} from "@/components/ui/dialog";
import {
  useAcceptDirectInvite2,
  useDeclineDirectInvite2,
  useDirectInvites2,
  type ParkedInvite2,
} from "@/concord-v2/hooks/useDirectInvites2";
import { BannedFromCommunityError } from "@/concord-v2/hooks/useCommunityActions2";
import { toast } from "@/hooks/useToast";

/** The seal-verified sender, rendered without any network reaction (npub). */
function senderLabel(pubkeyHex: string): string {
  try {
    return `${nip19.npubEncode(pubkeyHex).slice(0, 16)}…`;
  } catch {
    return `${pubkeyHex.slice(0, 16)}…`;
  }
}

/**
 * Consent-gated prompt for direct (gift-wrapped) Concord invites (CORD-05 §6).
 * A received invite is parked — it never auto-joins, and nothing beyond its
 * seal-verified sender and claimed name renders before the user decides.
 * Accepting keeps the keys (records the entry in the Community List vault) and
 * announces a Guestbook Join; declining tombstones it so it stops re-nagging.
 *
 * Mounted globally (MainLayout) so an invite that arrives on any screen prompts.
 */
export function DirectInvitesPrompt2() {
  const { data: invites } = useDirectInvites2();
  const { mutateAsync: accept, isPending: accepting } = useAcceptDirectInvite2();
  const { mutateAsync: decline, isPending: declining } = useDeclineDirectInvite2();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const pending = (invites ?? []).filter((i) => !dismissed.has(i.wrapId));
  const current: ParkedInvite2 | undefined = pending[0];
  const open = Boolean(current);
  const busy = accepting || declining;

  if (!current) return null;

  const handleAccept = async () => {
    try {
      const { communityId, name } = await accept({ invite: current });
      toast({ title: "Joined encrypted community", description: name });
      navigate(`/bao/c/${encodeURIComponent(communityId)}`);
    } catch (e) {
      if (e instanceof BannedFromCommunityError) {
        // A ban is terminal: stop re-nagging with this invite (the time-aware
        // tombstone still lets a post-unban re-invite through later).
        toast({ title: "You're banned", description: "You can't join this community.", variant: "destructive" });
        await handleDecline();
        return;
      }
      toast({
        title: "Couldn't join",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handleDecline = async () => {
    // A CATCH-UP is a key update for a community I'm already in — declining must
    // NOT tombstone (that would leave the community). Just dismiss it locally;
    // the sender can re-send, and re-following a refreshed link still heals.
    if (!current.catchUp) {
      try {
        await decline({ communityId: current.communityId });
      } catch {
        // Best-effort; dismiss locally regardless.
      }
    }
    setDismissed((prev) => new Set(prev).add(current.wrapId));
  };

  const isCatchUp = Boolean(current.catchUp);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleDecline()}>
      <ChromeDialogContent title={isCatchUp ? "Updated community keys" : "Encrypted community invite"}>
        <div className="flex flex-col items-center gap-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <ArmadaCrest size={72} />
            <div className="space-y-1">
              <h2 className="chrome-dialog-title font-mono font-bold lowercase tracking-tight text-foreground">
                {isCatchUp ? "updated community keys" : "encrypted community invite"}
              </h2>
              <p className="text-sm text-muted-foreground">
                {isCatchUp ? (
                  <>
                    An admin sent you the current keys for a community you're already in. Its keys
                    were rotated and yours were out of date. Accept to catch up and keep reading
                    new messages.
                  </>
                ) : (
                  <>
                    You've been handed the keys to an end-to-end-encrypted community. Accepting lets
                    you read and post; no host can see its messages.
                  </>
                )}
              </p>
            </div>
          </div>

          <div className="w-full clip-corner-lg border border-chrome bg-secondary/40 p-4">
            <div className="flex items-center gap-2 font-medium">
              <ShieldCheck className="size-4 shrink-0 text-success" />
              <span className="min-w-0 truncate">{current.name}</span>
            </div>
            <div className="mt-1 break-all text-xs text-muted-foreground">
              from {senderLabel(current.sender)}
            </div>
            {pending.length > 1 && (
              <div className="mt-2 text-xs text-muted-foreground">
                +{pending.length - 1} more invite{pending.length - 1 === 1 ? "" : "s"} after this
              </div>
            )}
          </div>

          <div className="flex w-full justify-end gap-2">
            <Button variant="ghost" className="clip-corner-lg" onClick={handleDecline} disabled={busy}>
              {isCatchUp ? "Not now" : "Decline"}
            </Button>
            <Button className="clip-corner-lg" onClick={handleAccept} disabled={busy}>
              {accepting ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" /> {isCatchUp ? "Updating…" : "Joining…"}
                </>
              ) : isCatchUp ? (
                "Update keys"
              ) : (
                "Accept"
              )}
            </Button>
          </div>
        </div>
        <ArmadaCrestKeyframes />
      </ChromeDialogContent>
    </Dialog>
  );
}
