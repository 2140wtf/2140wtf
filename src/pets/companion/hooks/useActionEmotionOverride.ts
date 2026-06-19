/**
 * useActionEmotionOverride — Temporary emotion override when using items.
 *
 * When an item is used on the companion (e.g., feeding → happy), this hook
 * provides a short-lived emotion override that takes precedence over the
 * status reaction system. The override automatically clears after 1.5s.
 *
 * Used by PetsCompanionLayer to wrap item-use handlers with emotion feedback.
 */

import { useState, useCallback, useRef } from 'react';

import { getActionEmotion, type ActionType } from '@/pets/ui/lib/status-reactions';
import type { PetsEmotion } from '@/pets/ui/lib/emotions';

/** Duration of the action emotion override in milliseconds. */
const ACTION_OVERRIDE_DURATION_MS = 1500;

interface UseActionEmotionOverrideResult {
  /** Current override emotion, or null if none active. Passed to useStatusReaction. */
  actionOverride: PetsEmotion | null;
  /** Trigger an override for the given action type. */
  triggerOverride: (action: ActionType) => void;
}

export function useActionEmotionOverride(): UseActionEmotionOverrideResult {
  const [actionOverride, setActionOverride] = useState<PetsEmotion | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerOverride = useCallback((action: ActionType) => {
    // Clear any existing timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    setActionOverride(getActionEmotion(action));
    timerRef.current = setTimeout(() => {
      setActionOverride(null);
      timerRef.current = null;
    }, ACTION_OVERRIDE_DURATION_MS);
  }, []);

  return { actionOverride, triggerOverride };
}
