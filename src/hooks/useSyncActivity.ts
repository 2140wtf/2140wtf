import { useSyncExternalStore } from "react";

import { getSyncTasks, onSyncActivity, type SyncTask } from "@/lib/syncActivity";

function subscribe(onStoreChange: () => void): () => void {
  return onSyncActivity(onStoreChange);
}

/**
 * The background catch-up tasks currently in flight (oldest first) — see
 * src/lib/syncActivity.ts. Debounce with useDelayedFlag before painting an
 * indicator so fast syncs show nothing.
 */
export function useSyncTasks(): readonly SyncTask[] {
  return useSyncExternalStore(subscribe, getSyncTasks);
}
