import { useCallback } from 'react';
import { useNostrPublish, type EventTemplate } from '@/hooks/useNostrPublish';
import { usePublishPreferences } from '@/hooks/usePublishPreferences';
import { toast } from '@/hooks/useToast';
import { PETS_BAO_RELAY_URL } from '@/pets/core/lib/pets-relay';

/**
 * Pet-specific `useNostrPublish` wrapper.
 *
 * Every event published through this hook is sent only to the BAO pets relay,
 * keeping pet state, Blobbonaut profiles, and interactions off public relays.
 *
 * Publishing is gated by the user's Privacy & Publishing preference for pets.
 */
export function usePetsNostrPublish() {
  const base = useNostrPublish();
  const { isEnabled } = usePublishPreferences();
  const petsEnabled = isEnabled('pets');

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
    (template: EventTemplate) => {
      guard();
      return base.mutateAsync({ ...template, relays: [PETS_BAO_RELAY_URL] });
    },
    [base, guard],
  );

  const mutate = useCallback(
    (template: EventTemplate, options?: Parameters<typeof base.mutate>[1]) => {
      guard();
      return base.mutate({ ...template, relays: [PETS_BAO_RELAY_URL] }, options);
    },
    [base, guard],
  );

  return { ...base, mutate, mutateAsync };
}
