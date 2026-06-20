import { NKinds, NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';

/** Max rounds of recursive fetching to avoid runaway loops. */
const MAX_FETCH_DEPTH = 5;

export function useComments(root: NostrEvent | URL | `#${string}` | undefined, limit?: number) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['nostr', 'comments', root instanceof URL ? root.toString() : typeof root === 'string' ? root : root?.id, limit],
    queryFn: async ({ signal }) => {
      if (!root) throw new Error('root is required');
      const limitFilter: Pick<NostrFilter, 'limit'> = {};
      if (typeof limit === 'number') {
        limitFilter.limit = limit;
      }

      const filters: NostrFilter[] = [];
      const isRegularEventRoot = typeof root !== 'string' && !(root instanceof URL) && !NKinds.addressable(root.kind) && !NKinds.replaceable(root.kind);

      if (typeof root === 'string') {
        filters.push({ kinds: [1111, 1244], '#I': [root], ...limitFilter });
      } else if (root instanceof URL) {
        filters.push({ kinds: [1111, 1244], '#I': [root.toString()], ...limitFilter });
      } else if (NKinds.addressable(root.kind)) {
        const d = root.tags.find(([name]) => name === 'd')?.[1] ?? '';
        filters.push({ kinds: [1111, 1244], '#A': [`${root.kind}:${root.pubkey}:${d}`], ...limitFilter });
      } else if (NKinds.replaceable(root.kind)) {
        filters.push({ kinds: [1111, 1244], '#A': [`${root.kind}:${root.pubkey}:`], ...limitFilter });
      } else {
        // Non-kind-1 roots (e.g. polls) may receive NIP-22 kind 1111 comments
        // or NIP-10 kind 1 replies from other clients. Fetch both conventions.
        filters.push({ kinds: [1111, 1244], '#E': [root.id], ...limitFilter });
        filters.push({ kinds: [1], '#e': [root.id], ...limitFilter });
      }

      const querySignal = AbortSignal.any([signal, AbortSignal.timeout(5000)]);

      // Query for comments that reference the root directly.
      const allEvents: NostrEvent[] = [];
      const seen = new Set<string>();
      const addEvents = (incoming: NostrEvent[]) => {
        for (const e of incoming) {
          if (!seen.has(e.id)) {
            seen.add(e.id);
            allEvents.push(e);
          }
        }
      };

      const initial = await nostr.query(filters, { signal: querySignal });
      addEvents(initial);

      // For regular event roots, kind 1 NIP-10 replies only tag their immediate
      // parent, not the thread root. Recursively chase newly discovered kind 1
      // IDs so nested Primal-style replies on polls are also loaded.
      if (isRegularEventRoot) {
        let idsToQuery = [root.id];
        for (let depth = 0; depth < MAX_FETCH_DEPTH && idsToQuery.length > 0; depth++) {
          const replies = await nostr.query(
            [{ kinds: [1], '#e': idsToQuery, ...limitFilter }],
            { signal: querySignal },
          );
          const newIds: string[] = [];
          for (const e of replies) {
            if (!seen.has(e.id)) {
              seen.add(e.id);
              allEvents.push(e);
              newIds.push(e.id);
            }
          }
          idsToQuery = newIds;
        }
      }

      // Helper function to get tag value
      const getTagValue = (event: NostrEvent, tagName: string): string | undefined => {
        const tag = event.tags.find(([name]) => name === tagName);
        return tag?.[1];
      };

      // Filter top-level comments (those with lowercase tag matching the root)
      const topLevelComments = allEvents.filter(comment => {
        if (typeof root === 'string') {
          return getTagValue(comment, 'i') === root;
        } else if (root instanceof URL) {
          return getTagValue(comment, 'i') === root.toString();
        } else if (NKinds.addressable(root.kind)) {
          const d = getTagValue(root, 'd') ?? '';
          return getTagValue(comment, 'a') === `${root.kind}:${root.pubkey}:${d}`;
        } else if (NKinds.replaceable(root.kind)) {
          return getTagValue(comment, 'a') === `${root.kind}:${root.pubkey}:`;
        } else {
          return getTagValue(comment, 'e') === root.id;
        }
      });

      // Helper function to get all descendants of a comment
      const getDescendants = (parentId: string): NostrEvent[] => {
        const directReplies = allEvents.filter(comment => {
          const eTag = getTagValue(comment, 'e');
          return eTag === parentId;
        });

        const allDescendants = [...directReplies];
        
        // Recursively get descendants of each direct reply
        for (const reply of directReplies) {
          allDescendants.push(...getDescendants(reply.id));
        }

        return allDescendants;
      };

      // Create a map of comment ID to its descendants
      const commentDescendants = new Map<string, NostrEvent[]>();
      for (const comment of allEvents) {
        commentDescendants.set(comment.id, getDescendants(comment.id));
      }

      // Sort top-level comments by creation time (newest first)
      const sortedTopLevel = topLevelComments.sort((a, b) => b.created_at - a.created_at);

      return {
        allComments: allEvents,
        topLevelComments: sortedTopLevel,
        getDescendants: (commentId: string) => {
          const descendants = commentDescendants.get(commentId) || [];
          // Sort descendants by creation time (oldest first for threaded display)
          return descendants.sort((a, b) => a.created_at - b.created_at);
        },
        getDirectReplies: (commentId: string) => {
          const directReplies = allEvents.filter(comment => {
            const eTag = getTagValue(comment, 'e');
            return eTag === commentId;
          });
          // Sort direct replies by creation time (oldest first for threaded display)
          return directReplies.sort((a, b) => a.created_at - b.created_at);
        }
      };
    },
    enabled: !!root,
  });
}
