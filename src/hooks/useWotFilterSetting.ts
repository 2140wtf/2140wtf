import { useCallback, useState } from 'react';

import { useAppContext } from '@/hooks/useAppContext';
import { getStorageKey } from '@/lib/storageKey';

/** Default minimum WoT rank when the filter is first enabled. */
const DEFAULT_WOT_THRESHOLD = 50;

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

/**
 * Persisted WoT feed-filter preference (enabled + 0..100 threshold), stored
 * per app id in localStorage. Off by default; the score bar only renders
 * while enabled.
 */
export function useWotFilterSetting() {
  const { config } = useAppContext();
  const storageKey = getStorageKey(config.appId, 'wotFilter');

  const [setting, setSetting] = useState<WotFilterSetting>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          const p = parsed as Record<string, unknown>;
          return { enabled: p.enabled === true, threshold: clampThreshold(p.threshold) };
        }
      }
    } catch {
      // Corrupt storage falls through to defaults.
    }
    return { enabled: false, threshold: DEFAULT_WOT_THRESHOLD };
  });

  const update = useCallback(
    (patch: Partial<WotFilterSetting>) => {
      setSetting((prev) => {
        const next = { ...prev, ...patch };
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          // Storage full / private mode — the setting just won't persist.
        }
        return next;
      });
    },
    [storageKey],
  );

  return {
    enabled: setting.enabled,
    threshold: setting.threshold,
    setEnabled: (enabled: boolean) => update({ enabled }),
    setThreshold: (threshold: number) => update({ threshold: clampThreshold(threshold) }),
  };
}
