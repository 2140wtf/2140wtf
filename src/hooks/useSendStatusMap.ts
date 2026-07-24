import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

/**
 * Optimistic send status for a locally-published, not-yet-confirmed message.
 * `"pending"` while the publish is in flight (rendered immediately on sign),
 * `"failed"` if no relay accepted it (offers retry). A message with neither is
 * confirmed/delivered.
 */
export type SendStatus = "pending" | "failed";

/** Message id → optimistic send status. */
export type SendStatusMap = Record<string, SendStatus>;

/**
 * A per-channel optimistic-send-status map, held in its own react-query cache
 * entry (so it survives re-renders and is shared across the hooks that read and
 * write it, without being recomputed by any queryFn).
 *
 * Shared by NIP-29 group chat and Concord — both render a `pending`/`failed`
 * badge on optimistically-inserted messages and clear it when the relay echoes
 * the event back. `queryKey` namespaces the map (e.g. by relay+group, or by
 * Concord channel id); pass `undefined` segments to disable until ready.
 */
export function useSendStatusMap(queryKey: readonly unknown[]): {
  status: SendStatusMap;
  setStatus: (id: string, value: SendStatus | undefined) => void;
} {
  const queryClient = useQueryClient();

  const { data: status = {} } = useQuery<SendStatusMap>({
    queryKey,
    queryFn: () => ({}),
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const setStatus = useCallback(
    (id: string, value: SendStatus | undefined) => {
      queryClient.setQueryData<SendStatusMap>(queryKey, (old = {}) => {
        if (value === undefined) {
          if (!(id in old)) return old;
          const next = { ...old };
          delete next[id];
          return next;
        }
        if (old[id] === value) return old;
        return { ...old, [id]: value };
      });
    },
    // queryKey is an array literal at the call site; spread it so the callback
    // is stable across renders with the same logical key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient, ...queryKey],
  );

  return { status, setStatus };
}

/** Read-only accessor for a send-status map (no setter). */
export function useSendStatusMapValue(queryKey: readonly unknown[]): SendStatusMap {
  const { data = {} } = useQuery<SendStatusMap>({
    queryKey,
    queryFn: () => ({}),
    staleTime: Infinity,
    gcTime: Infinity,
  });
  return data;
}
