import { useState, useCallback, useEffect } from 'react';
import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { getStorageKey } from '@/lib/storageKey';

/**
 * Manages the active feed tab for a specific feed page, persisting
 * the selection in localStorage so it survives reloads on this device.
 *
 * Each feed page should pass a unique `feedId` (e.g. 'home', 'videos').
 *
 * @param feedId  Unique identifier for this feed page.
 * @param validTabs  Optional list of valid tab values for validation. If omitted, any stored value is accepted.
 * @param defaultTabOverride  Optional default tab to use when nothing is persisted (overrides the follows/app default).
 */
export function useFeedTab<T extends string = string>(
  feedId: string,
  validTabs?: readonly T[],
  defaultTabOverride?: T,
): [T, (tab: T) => void] {
  const { user } = useCurrentUser();
  const { config } = useAppContext();
  const key = getStorageKey(config.appId, `feed-tab:${feedId}:${user?.pubkey ?? 'guest'}`);
  const validTabsKey = validTabs?.join(',') ?? '';

  const readTab = useCallback((): T => {
    const defaultTab = (defaultTabOverride ?? (user ? 'follows' : 'app')) as T;
    try {
      const stored = localStorage.getItem(key) ?? sessionStorage.getItem(key);
      if (stored) {
        const normalized = stored === 'ditto' ? 'app' : stored;
        if (!validTabs || validTabs.includes(normalized as T)) return normalized as T;
      }
    } catch { /* storage unavailable */ }
    if (validTabs && !validTabs.includes(defaultTab)) return validTabs[validTabs.length - 1];
    return defaultTab;
  // validTabsKey represents the content of validTabs without depending on a
  // new inline array instance on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, defaultTabOverride, user, validTabsKey]);

  const [activeTab, setActiveTab] = useState<T>(readTab);

  useEffect(() => {
    setActiveTab(readTab());
  }, [readTab]);

  const setTab = useCallback((tab: T) => {
    setActiveTab(tab);
    try {
      localStorage.setItem(key, tab);
      sessionStorage.removeItem(key);
    } catch { /* ignore */ }
  }, [key]);

  return [activeTab, setTab];
}
