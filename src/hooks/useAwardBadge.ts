import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { usePublishPreferences } from '@/hooks/usePublishPreferences';
import { BADGE_AWARD_KIND } from '@/lib/badgeUtils';

/**
 * Mutation to award a badge to one or more recipients (kind 8).
 */
export function useAwardBadge() {
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();
  const { mutateAsync: publishEvent } = useNostrPublish();
  const { isEnabled } = usePublishPreferences();

  return useMutation({
    mutationFn: async ({ aTag, recipientPubkeys }: { aTag: string; recipientPubkeys: string[] }) => {
      if (!user) throw new Error('User is not logged in');
      if (!isEnabled('badges')) throw new Error('Badge publishing is disabled. Turn it on in Settings → Privacy & Publishing.');
      if (recipientPubkeys.length === 0) throw new Error('Must specify at least one recipient');

      const tags: string[][] = [
        ['a', aTag],
        ...recipientPubkeys.map((pk) => ['p', pk]),
      ];

      return publishEvent({
        kind: BADGE_AWARD_KIND,
        content: '',
        tags,
      } as Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>);
    },
    onSuccess: (_data, { recipientPubkeys }) => {
      // Invalidate badge award caches for all recipients
      for (const pk of recipientPubkeys) {
        queryClient.invalidateQueries({ queryKey: ['badge-awards-to', pk] });
      }
    },
  });
}
