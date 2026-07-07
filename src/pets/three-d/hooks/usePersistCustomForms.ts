// src/pets/three-d/hooks/usePersistCustomForms.ts

import { useMutation } from '@tanstack/react-query';

import { useBlobbonautProfile } from '@/hooks/useBlobbonautProfile';
import { usePetsNostrPublish } from '@/pets/core/hooks/usePetsNostrPublish';
import { KIND_BLOBBONAUT_PROFILE } from '@/pets/core/lib/pets';
import { updateCustomFormsContent } from '@/pets/three-d/lib/custom-forms-schema';
import { toast } from '@/hooks/useToast';
import type { CustomPetForm } from '@/pets/three-d/lib/custom-forms-schema';

export interface PersistCustomFormsPatch {
  id: string;
  form: CustomPetForm | null;
}

/**
 * Persist custom species forms into the user's kind 11125 Blobbonaut profile.
 *
 * The uploads (SVG/GLB) must be done first. This hook only writes the resulting
 * metadata into `custom_forms` and publishes the profile event.
 */
export function usePersistCustomForms() {
  const { profile, updateProfileEvent } = useBlobbonautProfile();
  const { mutateAsync: publishEvent } = usePetsNostrPublish();

  return useMutation({
    mutationFn: async (patch: PersistCustomFormsPatch) => {
      if (!profile) {
        throw new Error('Blobbonaut profile not loaded');
      }

      const content = updateCustomFormsContent(profile.content, patch);

      const event = await publishEvent({
        kind: KIND_BLOBBONAUT_PROFILE,
        content,
        tags: profile.allTags,
        prev: profile.event,
      });

      updateProfileEvent(event);
      return event;
    },
    onSuccess: (_, patch) => {
      toast({
        title: patch.form ? 'Species saved' : 'Species removed',
        description: patch.form
          ? `Custom species "${patch.form.label}" has been saved to your profile.`
          : 'The custom species has been removed from your profile.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to save species',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}
