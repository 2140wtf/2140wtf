// src/pets/three-d/hooks/usePersistAssets3D.ts

import { useMutation } from '@tanstack/react-query';

import { useNostrPetProfile } from '@/hooks/useNostrPetProfile';
import { usePetsNostrPublish } from '@/pets/core/hooks/usePetsNostrPublish';
import { KIND_NOSTR_PET_PROFILE } from '@/pets/core/lib/pets';
import { updateAssets3DContent } from '@/pets/three-d/lib/content-assets';
import { toast } from '@/hooks/useToast';
import type { Asset3DEntry } from '@/pets/three-d/lib/three-d-schema';

export interface PersistAssets3DPatch {
  /** Set/remove the default pet GLB. */
  pet?: Asset3DEntry | null;
  /** Set/remove the room/environment GLB. */
  room?: Asset3DEntry | null;
}

/**
 * Persist 3D asset references into the user's kind 11125 Nostr pet profile.
 *
 * The upload itself must be done first (see `useUploadGLBAsset`). This hook
 * only writes the resulting `Asset3DEntry` into `assets_3d` and publishes the
 * profile event to the user's configured relays.
 */
export function usePersistAssets3D() {
  const { profile, updateProfileEvent } = useNostrPetProfile();
  const { mutateAsync: publishEvent } = usePetsNostrPublish();

  return useMutation({
    mutationFn: async (patch: PersistAssets3DPatch) => {
      if (!profile) {
        throw new Error('Nostr pet profile not loaded');
      }

      const content = updateAssets3DContent(profile.content, patch);

      const event = await publishEvent({
        kind: KIND_NOSTR_PET_PROFILE,
        content,
        tags: profile.allTags,
        prev: profile.event,
      });

      updateProfileEvent(event);
      return event;
    },
    onSuccess: () => {
      toast({
        title: '3D assets saved',
        description: 'Your GLB asset references have been saved to your profile.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to save 3D assets',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}
