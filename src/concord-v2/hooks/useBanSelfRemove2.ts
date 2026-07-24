import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useControlFold2 } from "@/concord-v2/hooks/useControlPlane2";
import { useCommunityEntry2, useUpdateCommunityList2 } from "@/concord-v2/hooks/useCommunityList2";
import { banlistLocator, bytesToHex } from "@/concord-v2/lib/derive";
import type { CommunityV2 } from "@/concord-v2/lib/types";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { toast } from "@/hooks/useToast";
import { logSync } from "@/lib/syncLog";

/**
 * Compliant self-removal on ban (CORD-04 §4): an honest client that finds its
 * OWN npub in the folded Banlist tears down its local copy and routes away.
 *
 * Network-SILENT by design: no Leave directive, no farewell, nothing published
 * to the community (every honest client already drops a banned npub's events,
 * so publishing anything is noise at best). The only write is the member's
 * private Community List vault, so their other devices don't resurrect the
 * entry.
 *
 * This is deliberately narrower than rekey-exclusion: a rotation that carries
 * no blob for me but no banlist entry keeps the read-only rail entry (the
 * stranded/excluded machinery) — a rotation can be a mistake; a ban is a
 * judgment.
 */
export function useBanSelfRemove2(community: CommunityV2 | undefined, onRemoved?: () => void): void {
  const { user } = useCurrentUser();
  const control = useControlFold2(community);
  const folded = control.data;
  const { mutateAsync: updateList } = useUpdateCommunityList2();
  const entry = useCommunityEntry2(community?.idHex);
  const queryClient = useQueryClient();
  const handled = useRef(new Set<string>());
  // Communities whose verdict we've seen once and forced a confirming refetch
  // for; cleared the moment the verdict lifts.
  const confirming = useRef(new Set<string>());

  useEffect(() => {
    if (!community || !entry || !folded || !user) return;
    // The fold's Banlist validator + roles engine already refuse the owner as
    // a target; the extra check just makes this hook's precondition explicit.
    if (user.pubkey === community.owner) return;

    const key = community.idHex;
    // The verdict must POSTDATE my membership. A compaction re-wraps banlist
    // editions verbatim (original timestamps survive), so a fresh joiner's
    // first fold can resurface a sentence older than their re-admission (the
    // unban edition may still be in flight). Only a banlist authored after I
    // (re)joined is a judgment on THIS membership.
    const banlistHead = folded.headEditions.get(bytesToHex(banlistLocator(community.id)));
    const underValidVerdict =
      folded.banned.has(user.pubkey) && !!banlistHead && banlistHead.createdAt * 1000 > entry.added_at;
    if (!underValidVerdict) {
      confirming.current.delete(key); // verdict absent/lifted — reset confirmation
      return;
    }
    if (handled.current.has(key)) return;

    // Self-removal is irreversible without a re-invite, so a lone sighting is
    // not enough: a legitimately-unbanned member returning through a relay
    // that withholds the unban head would tear down during the propagation
    // gap. Force one fresh fetch (the live stream keeps feeding the store) and
    // act only on a verdict that SURVIVES it.
    if (!confirming.current.has(key)) {
      confirming.current.add(key);
      void control.refetch();
      return;
    }
    if (control.isLoading || control.isFetching) return; // wait for the confirming fetch to settle

    handled.current.add(key);
    logSync("control", `${key.slice(0, 8)} banlist names ME — silent self-removal`);
    updateList({ type: "remove", communityId: community.idHex })
      .then(() => {
        queryClient.removeQueries({ queryKey: ["concord2", key] });
        toast({ title: "Removed from community", description: "You no longer have access to this community." });
        onRemoved?.();
      })
      .catch(() => {
        // The vault write failed (offline?) — retry on the next fold change.
        handled.current.delete(key);
      });
    // `control` is a fresh object each render; depend on its stable fields, not it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [community, entry, folded, user, control.isLoading, control.isFetching, control.refetch, updateList, queryClient, onRemoved]);
}
