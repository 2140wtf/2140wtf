import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { usePublishPreferences } from '@/hooks/usePublishPreferences';
import { NIP99_CLASSIFIED_KIND, type Nip99Listing } from '@/lib/nip99';

/**
 * Publish a NIP-99 status update that marks the seller's own listing as sold.
 *
 * Because kind 30402 is addressable, relays will replace the previous event
 * that shares the same `d` tag. Only the original seller can sign this update.
 */
export function useMarkListingSold() {
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent } = useNostrPublish();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { isEnabled } = usePublishPreferences();

  return useMutation({
    mutationFn: async (listing: Nip99Listing) => {
      if (!user) {
        throw new Error('You must be logged in to update a listing.');
      }
      if (listing.pubkey !== user.pubkey) {
        throw new Error('Only the seller can mark their own listing as sold.');
      }
      if (!isEnabled('marketplace')) {
        throw new Error('Marketplace publishing is disabled. Turn it on in Settings → Privacy & Publishing.');
      }

      const tags = listing.event.tags.map((tag) =>
        tag[0] === 'status' ? ['status', 'sold'] : tag,
      );

      if (!tags.some(([name]) => name === 'status')) {
        tags.push(['status', 'sold']);
      }

      return createEvent({
        kind: NIP99_CLASSIFIED_KIND,
        content: listing.event.content,
        tags,
        prev: listing.event,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nip99-listings'] });
      toast({ title: 'Listing marked as sold' });
    },
    onError: (error) => {
      toast({
        title: 'Failed to update listing',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });
}
