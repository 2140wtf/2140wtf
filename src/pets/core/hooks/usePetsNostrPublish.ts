import { useCallback, useMemo, useState } from 'react';

import { useNostrPublish, type EventTemplate } from '@/hooks/useNostrPublish';
import { usePublishPreferences } from '@/hooks/usePublishPreferences';
import { toast } from '@/hooks/useToast';
import { useAppContext } from '@/hooks/useAppContext';
import { getEffectiveRelays } from '@/lib/appRelays';

/**
 * Pet-specific `useNostrPublish` wrapper.
 *
 * Pet events are published to the user's effective relay set (app defaults + any
 * configured user relays) so pet state, profiles, and interactions are stored
 * across the same relays as the rest of the user's data.
 *
 * Publishing is gated by the user's Privacy & Publishing preference for pets.
 */
export function usePetsNostrPublish() {
  const base = useNostrPublish();
  const { isEnabled } = usePublishPreferences();
  const petsEnabled = isEnabled('pets');
  const [isPending, setIsPending] = useState(false);
  const { config } = useAppContext();

  const relayUrls = useMemo(
    () => getEffectiveRelays(config.relayMetadata, config.useAppRelays, config.useUserRelays).relays.map((r) => r.url),
    [config.relayMetadata, config.useAppRelays, config.useUserRelays],
  );

  const guard = useCallback(() => {
    if (!petsEnabled) {
      toast({
        title: 'Pets publishing disabled',
        description: 'Turn on “Publish pet events” in Settings → Privacy & Publishing to use pets.',
      });
      throw new Error('Pets publishing is disabled in Privacy & Publishing settings');
    }
  }, [petsEnabled]);

  const mutateAsync = useCallback(
    async (template: EventTemplate) => {
      guard();
      setIsPending(true);
      try {
        return await base.mutateAsync({ ...template, relays: relayUrls });
      } finally {
        setIsPending(false);
      }
    },
    [base, guard, relayUrls],
  );

  const mutate = useCallback(
    (template: EventTemplate, options?: Parameters<typeof base.mutate>[1]) => {
      guard();
      setIsPending(true);
      return base.mutate(
        { ...template, relays: relayUrls },
        {
          ...options,
          onSettled: (data, error, variables, onMutateResult, context) => {
            setIsPending(false);
            options?.onSettled?.(data, error, variables, onMutateResult, context);
          },
        },
      );
    },
    [base, guard, relayUrls],
  );

  return { mutate, mutateAsync, isPending };
}
