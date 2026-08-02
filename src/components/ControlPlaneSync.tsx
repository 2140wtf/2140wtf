import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import { useCommunityList2 } from "@/concord-v2/hooks/useCommunityList2";
import { liveEntries, rehydrateCommunity } from "@/concord-v2/lib/communityList";
import type { CommunityV2 } from "@/concord-v2/lib/types";
import { syncControlPlane } from "@/lib/controlPlaneSync";

/**
 * Sync the control plane of every Concord V2 community on pageload.
 * The NIP-42 auth hold lives inside planeSync, where it covers every caller.
 * Driven by a `useQuery` keyed on membership identity; the sweep is
 * cursor-gated, so a re-run is cheap. (V2-only: Armada's V1 plane is not part
 * of the ₿AO build.)
 */
function useControlPlaneSync(): void {
  const queryClient = useQueryClient();

  const { data: v2Data } = useCommunityList2();

  // Rehydrate every live membership into a runtime community. Memoized on the
  // decrypted list so a stable set feeds the query (and its key).
  const v2: CommunityV2[] = useMemo(() => {
    if (!v2Data) return [];
    const out: CommunityV2[] = [];
    for (const entry of liveEntries(v2Data.list)) {
      // V2 planes live ONLY on the community's own relays (the bundle/fold's
      // relay set). Never union the deployment's app/platform relays in: they
      // don't store Concord wraps, and their instant empty answers can starve
      // the real relays (issue #19).
      const community = rehydrateCommunity(entry);
      if (community) out.push(community);
    }
    return out;
  }, [v2Data]);

  // A signature that changes only when the set of communities (or their held
  // epochs, which change the derived control addresses) changes.
  const sig = useMemo(
    () =>
      v2
        .map((c) => `2:${c.idHex}:${c.heldRoots.map((r) => r.epoch).join("-")}`)
        .sort()
        .join(","),
    [v2],
  );

  useQuery({
    queryKey: ["control-plane-sync", sig],
    enabled: v2.length > 0,
    // The sweep advances a persisted cursor, so a re-run is cheap; keep it fresh
    // for a while and let a focus/interval-driven refetch catch up.
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      await syncControlPlane(queryClient, v2);
      return sig;
    },
  });

}

/**
 * Headless mount that syncs every Concord community's control plane on pageload
 * (see {@link useControlPlaneSync}). No UI.
 */
export function ControlPlaneSync() {
  useControlPlaneSync();
  return null;
}
