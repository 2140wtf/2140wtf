import { useCallback } from 'react';
import { useNostrPublish, type EventTemplate } from '@/hooks/useNostrPublish';
import { PETS_BAO_RELAY_URL } from '@/pets/core/lib/pets-relay';

/**
 * Pet-specific `useNostrPublish` wrapper.
 *
 * Every event published through this hook is sent only to the BAO pets relay,
 * keeping pet state, Blobbonaut profiles, and interactions off public relays.
 */
export function usePetsNostrPublish() {
  const base = useNostrPublish();

  const mutateAsync = useCallback(
    (template: EventTemplate) =>
      base.mutateAsync({ ...template, relays: [PETS_BAO_RELAY_URL] }),
    [base],
  );

  const mutate = useCallback(
    (template: EventTemplate, options?: Parameters<typeof base.mutate>[1]) =>
      base.mutate({ ...template, relays: [PETS_BAO_RELAY_URL] }, options),
    [base],
  );

  return { ...base, mutate, mutateAsync };
}
