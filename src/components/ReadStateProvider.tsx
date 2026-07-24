import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ReadStateContext,
  type ReadStateMap,
} from "@/contexts/ReadStateContext";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useEncryptedSettings } from "@/hooks/useEncryptedSettings";

const EMPTY: ReadStateMap = {};

/** Per-user localStorage key for the read-state cache. */
function storageKey(pubkey: string): string {
  return `bao:read-state:${pubkey}`;
}

function loadLocal(pubkey: string): ReadStateMap {
  try {
    const raw = localStorage.getItem(storageKey(pubkey));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as ReadStateMap) : {};
  } catch {
    return {};
  }
}

function saveLocal(pubkey: string, map: ReadStateMap): void {
  try {
    localStorage.setItem(storageKey(pubkey), JSON.stringify(map));
  } catch {
    // localStorage unavailable — ignore.
  }
}

/** Merge two read-state maps, keeping the newer (max) timestamp per key. */
function mergeReadState(a: ReadStateMap, b: ReadStateMap): ReadStateMap {
  const out: ReadStateMap = { ...a };
  for (const [key, ts] of Object.entries(b)) {
    if (!out[key] || ts > out[key]) out[key] = ts;
  }
  return out;
}

/** Debounce window (ms) before flushing read-state to encrypted settings. */
const SYNC_DEBOUNCE_MS = 4000;

/**
 * Provides per-conversation read-state (last-read timestamps) for unread and
 * mention badges. Backed by a per-user localStorage cache for instant/offline
 * reads and mirrored into the user's encrypted NIP-78 settings (debounced) so
 * unread carries across devices.
 */
export function ReadStateProvider({ children }: { children: React.ReactNode }) {
  const { user } = useCurrentUser();
  const { updateSettings, hasNip44Support } = useEncryptedSettings();  const pubkey = user?.pubkey;

  const [readState, setReadState] = useState<ReadStateMap>(() =>
    pubkey ? loadLocal(pubkey) : EMPTY,
  );

  // Re-load the cache when the account changes.
  useEffect(() => {
    setReadState(pubkey ? loadLocal(pubkey) : EMPTY);
  }, [pubkey]);

  // Debounced sync of dirty keys to encrypted settings.
  const flushTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingSync = useRef<ReadStateMap | null>(null);

  const scheduleSync = useCallback(
    (map: ReadStateMap) => {
      if (!hasNip44Support) return;
      pendingSync.current = map;
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flushTimer.current = setTimeout(() => {
        const next = pendingSync.current;
        pendingSync.current = null;
        if (next) {
          updateSettings.mutateAsync({ readState: next }).catch((err) =>
            console.warn("Read-state sync failed:", err),
          );
        }
      }, SYNC_DEBOUNCE_MS);
    },
    [hasNip44Support, updateSettings],
  );

  // Flush any pending sync on unmount.
  useEffect(() => {
    return () => {
      if (flushTimer.current) clearTimeout(flushTimer.current);
    };
  }, []);

  const getLastRead = useCallback(
    (key: string) => readState[key] ?? 0,
    [readState],
  );

  const markRead = useCallback(
    (key: string, timestamp: number) => {
      if (!pubkey) return;
      setReadState((prev) => {
        if ((prev[key] ?? 0) >= timestamp) return prev;
        const next = { ...prev, [key]: timestamp };
        saveLocal(pubkey, next);
        scheduleSync(next);
        return next;
      });
    },
    [pubkey, scheduleSync],
  );

  const hydrate = useCallback(
    (map: ReadStateMap) => {
      if (!pubkey) return;
      setReadState((prev) => {
        const merged = mergeReadState(prev, map);
        // Avoid a write/re-render when nothing changed.
        const changed = Object.keys(merged).some((k) => merged[k] !== prev[k]);
        if (!changed) return prev;
        saveLocal(pubkey, merged);
        return merged;
      });
    },
    [pubkey],
  );

  const value = useMemo(
    () => ({ readState, getLastRead, markRead, hydrate }),
    [readState, getLastRead, markRead, hydrate],
  );

  return <ReadStateContext.Provider value={value}>{children}</ReadStateContext.Provider>;
}
