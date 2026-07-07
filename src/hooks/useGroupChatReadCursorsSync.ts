import { useCallback, useEffect, useRef } from 'react';

import { useGroupChatReadCursors } from '@/hooks/useGroupChatReadCursors';
import { useEncryptedSettings } from '@/hooks/useEncryptedSettings';
import { useCurrentUser } from '@/hooks/useCurrentUser';

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
  const { settings, settingsCreatedAt, updateSettings, isLoading, hasNip44Support } = useEncryptedSettings();
  const { cursors, setCursors } = useGroupChatReadCursors();
  const { user } = useCurrentUser();
  const lastLocalWriteTs = useRef(0);
  const cursorsRef = useRef(cursors);
  const settingsRef = useRef(settings);
  // Track the created_at of the last remote settings event we merged cursors
  // from, so a stale relay event cannot roll read cursors back.
  const lastMergedCreatedAt = useRef(0);
  const prevPubkey = useRef<string | undefined>(undefined);

  useEffect(() => {
    cursorsRef.current = cursors;
  }, [cursors]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // Reset the ordering cursor when the user changes so the new account's
  // settings are applied immediately.
  useEffect(() => {
    const pubkey = user?.pubkey;
    if (prevPubkey.current !== undefined && pubkey !== prevPubkey.current) {
      lastMergedCreatedAt.current = 0;
    }
    prevPubkey.current = pubkey;
  }, [user?.pubkey]);

  useEffect(() => {
    if (isLoading || !hasNip44Support) return;
    const remote = settings?.groupReadCursors;
    if (!remote || Object.keys(remote).length === 0) return;

    const remoteCreatedAt = settingsCreatedAt ?? 0;
    if (remoteCreatedAt <= 0) return;
    if (remoteCreatedAt <= lastMergedCreatedAt.current) return;

    const remoteLastSync = settings?.lastSync ?? 0;
    if (remoteLastSync > 0 && remoteLastSync <= lastLocalWriteTs.current) return;

    lastMergedCreatedAt.current = remoteCreatedAt;
    setCursors((prev) => mergeCursors(prev, remote));
  }, [settings?.groupReadCursors, settingsCreatedAt, settings?.lastSync, isLoading, hasNip44Support, setCursors]);

  const syncToRemote = useCallback(() => {
    const local = cursorsRef.current;
    if (!hasNip44Support || Object.keys(local).length === 0) return;

    const remote = settingsRef.current?.groupReadCursors;
    const merged = mergeCursors(remote ?? {}, local);
    if (cursorsEqual(merged, remote)) return;

    lastLocalWriteTs.current = Date.now();
    updateSettings.mutate({ groupReadCursors: merged });
  }, [hasNip44Support, updateSettings]);

  useEffect(() => {
    if (!hasNip44Support) return;

    const timer = setTimeout(syncToRemote, SYNC_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [cursors, hasNip44Support, updateSettings, syncToRemote]);

  useEffect(() => {
    if (!hasNip44Support) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'hidden') return;
      syncToRemote();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [hasNip44Support, updateSettings, syncToRemote]);
}
