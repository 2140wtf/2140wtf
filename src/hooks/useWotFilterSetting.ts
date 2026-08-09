import { useCallback, useEffect, useRef, useState } from 'react';

import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useEncryptedSettings } from '@/hooks/useEncryptedSettings';
import { getStorageKey } from '@/lib/storageKey';

/** Default protection for every account, including accounts without synced settings. */
export const DEFAULT_WOT_THRESHOLD = 40;
const DEFAULT_WOT_FILTER: WotFilterSetting = {
  enabled: true,
  threshold: DEFAULT_WOT_THRESHOLD,
};
const SYNC_DEBOUNCE_MS = 600;

interface WotFilterSetting {
  enabled: boolean;
  /** Minimum global rank (0..100) an author needs to stay in the feed. */
  threshold: number;
}

function clampThreshold(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return DEFAULT_WOT_THRESHOLD;
  return Math.min(100, Math.max(0, Math.round(num)));
}

function parseSetting(raw: string | null): WotFilterSetting | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const value = parsed as Record<string, unknown>;
    return {
      enabled: value.enabled === true,
      threshold: clampThreshold(value.threshold),
    };
  } catch {
    return null;
  }
}

function readLocalSetting(storageKey: string, legacyStorageKey?: string): WotFilterSetting {
  try {
    const scoped = parseSetting(localStorage.getItem(storageKey));
    if (scoped) return scoped;

    // Older releases stored one setting for the whole browser. Migrate it once
    // into the first active account so later account switches cannot inherit it.
    if (legacyStorageKey && legacyStorageKey !== storageKey) {
      const legacy = parseSetting(localStorage.getItem(legacyStorageKey));
      if (legacy) {
        localStorage.setItem(storageKey, JSON.stringify(legacy));
        localStorage.removeItem(legacyStorageKey);
        return legacy;
      }
    }
  } catch {
    // Storage may be unavailable in private browsing modes.
  }
  return DEFAULT_WOT_FILTER;
}

function writeLocalSetting(storageKey: string, setting: WotFilterSetting): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(setting));
  } catch {
    // The in-memory preference still works when storage is unavailable.
  }
}

/**
 * Account-scoped WoT feed-filter preference. It applies immediately from the
 * local cache, then hydrates from the user's NIP-44-encrypted NIP-78 settings
 * event. Changes are cached locally and debounced to Nostr so sliders do not
 * publish an event for every pixel of movement.
 */
export function useWotFilterSetting() {
  const { config } = useAppContext();
  const { user } = useCurrentUser();
  const { settings, updateSettings, hasNip44Support } = useEncryptedSettings();
  const legacyStorageKey = getStorageKey(config.appId, 'wotFilter');
  const storageKey = getStorageKey(
    config.appId,
    user ? `wotFilter:${user.pubkey}` : 'wotFilter:guest',
  );
  const [setting, setSetting] = useState<WotFilterSetting>(() =>
    readLocalSetting(storageKey, user ? legacyStorageKey : undefined),
  );
  const settingRef = useRef(setting);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updateSettingsRef = useRef(updateSettings);
  updateSettingsRef.current = updateSettings;

  // Account switches load an account-scoped local value immediately. When the
  // encrypted relay document arrives, it becomes authoritative for that user.
  useEffect(() => {
    const remote = settings?.wotFilter;
    const next = remote
      ? { enabled: remote.enabled, threshold: clampThreshold(remote.threshold) }
      : readLocalSetting(storageKey, user ? legacyStorageKey : undefined);
    settingRef.current = next;
    setSetting(next);
    writeLocalSetting(storageKey, next);
  }, [legacyStorageKey, settings?.wotFilter, storageKey, user]);

  useEffect(() => () => {
    if (syncTimer.current) clearTimeout(syncTimer.current);
  }, []);

  const update = useCallback(
    (patch: Partial<WotFilterSetting>) => {
      const next = { ...settingRef.current, ...patch };
      settingRef.current = next;
      setSetting(next);
      writeLocalSetting(storageKey, next);

      if (!user || !hasNip44Support) return;
      if (syncTimer.current) clearTimeout(syncTimer.current);
      syncTimer.current = setTimeout(() => {
        updateSettingsRef.current.mutate(
          { wotFilter: next },
          { onError: () => { /* The account-scoped local setting remains active. */ } },
        );
      }, SYNC_DEBOUNCE_MS);
    },
    [hasNip44Support, storageKey, user],
  );

  return {
    enabled: setting.enabled,
    threshold: setting.threshold,
    setEnabled: (enabled: boolean) => update({ enabled }),
    setThreshold: (threshold: number) => update({ threshold: clampThreshold(threshold) }),
  };
}
