import { useEffect, useRef } from 'react';

import { useDmReadCursors } from '@/hooks/useDmReadCursors';
import { useEncryptedSettings } from '@/hooks/useEncryptedSettings';
import { useCurrentUser } from '@/hooks/useCurrentUser';

const SYNC_DEBOUNCE_MS = 5000;

export function mergeCursors(
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

export function cursorsEqual(
  a: Record<string, number> | undefined,
  b: Record<string, number> | undefined,
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Syncs DM read cursors between localStorage and encrypted NIP-78 settings.
 *
 * LocalStorage is the fast local source of truth. Encrypted settings provide
 * cross-device sync with a 5-second debounce and an immediate flush when the
 * app is backgrounded. Remote cursors are merged into local state on startup
 * and whenever encrypted settings refresh, but only if they are newer for a
 * given conversation.
 */
export function useDmReadCursorsSync() {
  const { settings, settingsCreatedAt, updateSettings, isLoading, hasNip44Support } = useEncryptedSettings();
  const { cursors, setCursors } = useDmReadCursors();
  const { user } = useCurrentUser();
  const lastLocalWriteTs = useRef(0);
  // Track the created_at of the last remote settings event we merged cursors
  // from, so a stale relay event cannot roll read cursors back.
  const lastMergedCreatedAt = useRef(0);
  const prevPubkey = useRef<string | undefined>(undefined);

  // Reset the ordering cursor when the user changes so the new account's
  // settings are applied immediately.
  useEffect(() => {
    const pubkey = user?.pubkey;
    if (prevPubkey.current !== undefined && pubkey !== prevPubkey.current) {
      lastMergedCreatedAt.current = 0;
    }
    prevPubkey.current = pubkey;
  }, [user?.pubkey]);

  // Merge remote cursors into local state when encrypted settings load or update.
  // Skip the merge right after we wrote local -> encrypted to avoid a useless loop.
  useEffect(() => {
    if (isLoading || !hasNip44Support) return;
    const remote = settings?.dmReadCursors;
    if (!remote || Object.keys(remote).length === 0) return;

    const remoteCreatedAt = settingsCreatedAt ?? 0;
    if (remoteCreatedAt <= 0) return;
    if (remoteCreatedAt <= lastMergedCreatedAt.current) return;

    const remoteLastSync = settings?.lastSync ?? 0;
    if (remoteLastSync > 0 && remoteLastSync <= lastLocalWriteTs.current) return;

    lastMergedCreatedAt.current = remoteCreatedAt;
    setCursors((prev) => mergeCursors(prev, remote));
  }, [settings?.dmReadCursors, settingsCreatedAt, settings?.lastSync, isLoading, hasNip44Support, setCursors]);

  // Debounced local -> encrypted sync.
  useEffect(() => {
    if (!hasNip44Support || Object.keys(cursors).length === 0) return;

    const timer = setTimeout(() => {
      const remote = settings?.dmReadCursors;
      const merged = mergeCursors(remote ?? {}, cursors);
      if (cursorsEqual(merged, remote)) return;

      lastLocalWriteTs.current = Date.now();
      updateSettings.mutate({ dmReadCursors: merged });
    }, SYNC_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [cursors, settings?.dmReadCursors, hasNip44Support, updateSettings]);

  // Flush to encrypted settings when the app is backgrounded.
  useEffect(() => {
    if (!hasNip44Support) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'hidden' || Object.keys(cursors).length === 0) return;

      const remote = settings?.dmReadCursors;
      const merged = mergeCursors(remote ?? {}, cursors);
      if (cursorsEqual(merged, remote)) return;

      lastLocalWriteTs.current = Date.now();
      updateSettings.mutate({ dmReadCursors: merged });
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [cursors, settings?.dmReadCursors, hasNip44Support, updateSettings]);
}
