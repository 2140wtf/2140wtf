import { useEffect, useRef } from "react";

import { useControlFold2 } from "@/concord-v2/hooks/useControlPlane2";
import { useCommunityEntry2, useUpdateCommunityList2 } from "@/concord-v2/hooks/useCommunityList2";
import { capRelays, type CommunityV2 } from "@/concord-v2/lib/types";
import { logSync } from "@/lib/syncLog";

/**
 * Follow the fold's relay list (CORD-02 §6: "a metadata edition replaces aged
 * or retired relays, clients follow the fold").
 *
 * The Community List's `current.relays` is a join-time snapshot — bootstrap
 * material that gets a fresh device connected well enough to reach the fold.
 * The fold is the authority: whenever the folded Metadata names a different
 * relay set, this watcher writes it back into the list entry, and everything
 * downstream re-points through {@link rehydrateCommunity} (subscriptions,
 * sweeps, publishes, stream-key auth scopes all read `community.relays`).
 *
 * The write-back also keeps the bootstrap ladder fresh: the member's OTHER
 * devices sync the 13302 and reconnect on the new relays even if they never
 * saw the edition on the old ones.
 */
export function useRelayFollow2(community: CommunityV2 | undefined): void {
  const { data: folded } = useControlFold2(community);
  const { mutateAsync: updateList } = useUpdateCommunityList2();
  const entry = useCommunityEntry2(community?.idHex);
  // Guards only the IN-FLIGHT write (the effect re-fires on every fold/entry
  // change): once the mutation lands, the list's optimistic cache makes the
  // equality check the gate, so the key is dropped — a later flip back to a
  // previously-seen set must still be followed.
  const handled = useRef(new Set<string>());

  useEffect(() => {
    if (!community || !entry || !folded?.metadata) return;
    // The fold truncates on read (capRelays), so compare what members actually
    // honor. An empty folded set is treated as "no instruction" — a metadata
    // edition that names no relays must not disconnect the community from
    // everything (a bundle or edition MUST stay usable when trimmed, §6).
    const foldRelays = capRelays(Array.isArray(folded.metadata.relays) ? folded.metadata.relays : []);
    if (foldRelays.length === 0) return;
    const listRelays = Array.isArray(entry.current.relays) ? entry.current.relays : [];
    if (foldRelays.length === listRelays.length && foldRelays.every((r, i) => r === listRelays[i])) return;

    const key = `${community.idHex}|${foldRelays.join(",")}`;
    if (handled.current.has(key)) return;
    handled.current.add(key);

    logSync(
      "relays",
      `${community.idHex.slice(0, 8)} fold moved relays: [${listRelays.join(", ")}] → [${foldRelays.join(", ")}]`,
    );
    updateList({ type: "refresh-relays", communityId: community.idHex, relays: foldRelays })
      .catch(() => undefined) // a failed publish re-arms below; the next fold pass retries
      .finally(() => {
        handled.current.delete(key);
      });
  }, [community, entry, folded, updateList]);
}
