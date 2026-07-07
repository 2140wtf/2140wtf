/**
 * Hook to read the current user's custom species forms from their Blobbonaut profile.
 */

import { useMemo } from 'react';

import { useBlobbonautProfile } from '@/hooks/useBlobbonautProfile';
import { readCustomFormsMap, type CustomPetForm } from '@/pets/three-d/lib/custom-forms-schema';

/**
 * Return the parsed `custom_forms` map from the current user's kind 11125 profile.
 * Returns an empty object if no profile or no custom forms are stored.
 */
export function useCustomForms(): Record<string, CustomPetForm> {
  const { profile } = useBlobbonautProfile();

  return useMemo(() => readCustomFormsMap(profile?.content), [profile?.content]);
}
