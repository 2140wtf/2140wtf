import { Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useGuestbook2, useGuestbookPublisher2 } from "@/concord-v2/hooks/useGuestbook2";
import type { CommunityV2 } from "@/concord-v2/lib/types";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { toast } from "@/hooks/useToast";

/**
 * Per-community display name editor (P1-1): the name travels ONLY inside the
 * community's encrypted Guestbook — members see it, no public kind-0 profile
 * is needed or published. Saving republishes a Join with the new name tag;
 * the latest Join wins, so this is also the rename path.
 */
export function ScopedNameEditor2({ community }: { community: CommunityV2 }) {
  const { user } = useCurrentUser();
  const { coalesced } = useGuestbook2(community);
  const currentName = user ? coalesced.get(user.pubkey)?.name : undefined;
  const publisher = useGuestbookPublisher2(community);
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const value = name ?? currentName ?? "";

  const save = async () => {
    if (!user || busy) return;
    setBusy(true);
    try {
      await publisher.mutateAsync({ type: "join", name: value.trim() || undefined });
      toast({
        title: value.trim() ? "Display name updated" : "Display name cleared",
        description: "Only members of this community can see it — nothing is published publicly.",
      });
    } catch (e) {
      toast({
        title: "Couldn't save the display name",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium">Your display name in this community</p>
      <p className="text-xs text-muted-foreground">
        Stays inside the encrypted community — visible to members only. Nothing public is published.
      </p>
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => setName(e.target.value)}
          placeholder={currentName ? "" : "Member"}
          maxLength={80}
          aria-label="Display name in this community"
          disabled={busy || !user}
          className="text-sm"
        />
        <Button type="button" size="sm" onClick={save} disabled={busy || !user} className="shrink-0">
          {busy ? <Loader2 className="size-4 animate-spin" /> : "Save"}
        </Button>
      </div>
    </div>
  );
}
