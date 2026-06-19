import { useEffect, useRef } from 'react';

import { useGroupChatReadCursors } from '@/hooks/useGroupChatReadCursors';
import { useEncryptedSettings } from '@/hooks/useEncryptedSettings';

const SYNC_DEBOUNCE_MS = 5000;

function mergeCursors(
  local: Record<string, number>,
  remote: Record<string, number> | undefined,
): Record<string, number> {
  if (!remote) return local;
  let changed = false;
  const next = { ...local };
  for (const [id, ts] of Object.entries(remote)) {
    if (ts > (next[id] ?? 0)) {
      next[id] = ts;
      changed = true;
    }
  }
  return changed ? next : local;
}

function cursorsEqual(
  a: Record<string, number> | undefined,
  b: Record<string, number> | undefined,
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Syncs group-chat read cursors between localStorage and encrypted NIP-78 settings.
 *
 * Mirrors the DM read-cursor sync strategy: localStorage is the fast local source
 * of truth; encrypted settings provide cross-device sync with a 5-second debounce
 * and an immediate flush when the app is backgrounded.
 */
export function useGroupChatReadCursorsSync() {
  const { settings, updateSettings, isLoading, hasNip44Support } = useEncryptedSettings();
  const { cursors, setCursors } = useGroupChatReadCursors();
  const lastLocalWriteTs = useRef(0);

  useEffect(() => {
    if (isLoading || !hasNip44Support) return;
    const remote = settings?.groupReadCursors;
    if (!remote || Object.keys(remote).length === 0) return;

    const remoteLastSync = settings?.lastSync ?? 0;
    if (remoteLastSync > 0 && remoteLastSync <= lastLocalWriteTs.current) return;

    setCursors((prev) => mergeCursors(prev, remote));
  }, [settings?.groupReadCursors, settings?.lastSync, isLoading, hasNip44Support, setCursors]);

  useEffect(() => {
    if (!hasNip44Support || Object.keys(cursors).length === 0) return;

    const timer = setTimeout(() => {
      const remote = settings?.groupReadCursors;
      const merged = mergeCursors(remote ?? {}, cursors);
      if (cursorsEqual(merged, remote)) return;

      lastLocalWriteTs.current = Date.now();
      updateSettings.mutate({ groupReadCursors: merged });
    }, SYNC_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [cursors, settings?.groupReadCursors, hasNip44Support, updateSettings]);

  useEffect(() => {
    if (!hasNip44Support) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'hidden' || Object.keys(cursors).length === 0) return;

      const remote = settings?.groupReadCursors;
      const merged = mergeCursors(remote ?? {}, cursors);
      if (cursorsEqual(merged, remote)) return;

      lastLocalWriteTs.current = Date.now();
      updateSettings.mutate({ groupReadCursors: merged });
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [cursors, settings?.groupReadCursors, hasNip44Support, updateSettings]);
}
