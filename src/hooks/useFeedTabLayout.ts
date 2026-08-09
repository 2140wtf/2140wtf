import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { getStorageKey } from '@/lib/storageKey';

export interface FeedTabLayout {
  order: string[];
  hidden: string[];
}

export function normalizeFeedTabLayout(
  value: Partial<FeedTabLayout> | null,
  availableIds: string[],
): FeedTabLayout {
  const available = new Set(availableIds);
  const seen = new Set<string>();
  const order: string[] = [];
  for (const id of value?.order ?? []) {
    if (available.has(id) && !seen.has(id)) {
      seen.add(id);
      order.push(id);
    }
  }
  for (const id of availableIds) {
    if (!seen.has(id)) order.push(id);
  }

  const hidden = [...new Set(value?.hidden ?? [])].filter((id) => available.has(id));
  if (order.every((id) => hidden.includes(id))) hidden.splice(0, hidden.length);
  return { order, hidden };
}

/** Per-account, per-device home tab visibility and ordering. */
export function useFeedTabLayout(availableIds: string[]) {
  const { config } = useAppContext();
  const { user } = useCurrentUser();
  const idsKey = availableIds.join(',');
  const storageKey = getStorageKey(config.appId, `feed-tab-layout:${user?.pubkey ?? 'guest'}`);

  const read = useCallback((): FeedTabLayout => {
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) as Partial<FeedTabLayout> : null;
      return normalizeFeedTabLayout(parsed, availableIds);
    } catch {
      return normalizeFeedTabLayout(null, availableIds);
    }
  // idsKey represents the content and order of availableIds.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, idsKey]);

  const [layout, setLayoutState] = useState<FeedTabLayout>(read);
  useEffect(() => {
    setLayoutState(read());
  }, [read]);
  const normalized = useMemo(
    () => normalizeFeedTabLayout(layout, availableIds),
  // idsKey represents the content and order of availableIds.
  // eslint-disable-next-line react-hooks/exhaustive-deps
    [layout, idsKey],
  );

  const persist = useCallback((next: FeedTabLayout) => {
    const clean = normalizeFeedTabLayout(next, availableIds);
    setLayoutState(clean);
    try { localStorage.setItem(storageKey, JSON.stringify(clean)); } catch { /* unavailable */ }
  // idsKey represents the content and order of availableIds.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, idsKey]);

  const toggle = useCallback((id: string) => {
    const hidden = normalized.hidden.includes(id)
      ? normalized.hidden.filter((item) => item !== id)
      : [...normalized.hidden, id];
    persist({ ...normalized, hidden });
  }, [normalized, persist]);

  const move = useCallback((id: string, direction: -1 | 1) => {
    const from = normalized.order.indexOf(id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= normalized.order.length) return;
    const order = [...normalized.order];
    [order[from], order[to]] = [order[to], order[from]];
    persist({ ...normalized, order });
  }, [normalized, persist]);

  const reset = useCallback(
    () => persist(normalizeFeedTabLayout(null, availableIds)),
    [availableIds, persist],
  );

  return { layout: normalized, toggle, move, reset };
}
