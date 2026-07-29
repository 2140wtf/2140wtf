import { useCallback, useState } from 'react';

import { useCurrentUser } from '@/hooks/useCurrentUser';

/** Hard cap on stored per-notification read ids (oldest are dropped first). */
const MAX_READ_IDS = 2000;

function storageKey(pubkey: string): string {
  return `notifications-read-ids:${pubkey}`;
}

function loadIds(pubkey: string): string[] {
  try {
    const raw = localStorage.getItem(storageKey(pubkey));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveIds(pubkey: string, ids: string[]): void {
  try {
    localStorage.setItem(storageKey(pubkey), JSON.stringify(ids.slice(-MAX_READ_IDS)));
  } catch {
    // storage full or unavailable — read state just won't persist
  }
}

/**
 * Per-notification read state, stored locally per account.
 *
 * The global `notificationsCursor` (synced via NIP-78 settings) powers
 * "mark all as read"; this per-id set powers "click one notification to
 * mark IT read" without writing a settings event for every tap. Per-id
 * reads are intentionally per-device — the cursor is the shared baseline.
 */
export function useReadNotificationIds() {
  const { user } = useCurrentUser();
  const pubkey = user?.pubkey ?? '';
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set(pubkey ? loadIds(pubkey) : []));

  const markIdsRead = useCallback(
    (ids: Iterable<string>) => {
      if (!pubkey) return;
      setReadIds((prev) => {
        const next = new Set(prev);
        let changed = false;
        for (const id of ids) {
          if (!next.has(id)) {
            next.add(id);
            changed = true;
          }
        }
        if (!changed) return prev;
        saveIds(pubkey, [...next]);
        return next;
      });
    },
    [pubkey],
  );

  const clearReadIds = useCallback(() => {
    if (!pubkey) return;
    setReadIds((prev) => {
      if (prev.size === 0) return prev;
      saveIds(pubkey, []);
      return new Set();
    });
  }, [pubkey]);

  return { readIds, markIdsRead, clearReadIds };
}
