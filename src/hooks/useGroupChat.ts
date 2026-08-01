/**
 * useGroupChat Hook
 *
 * React hook for 2140.wtf's encrypted group chat.
 * Manages group state, message subscriptions, and event publishing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';

import { useCurrentUser } from './useCurrentUser';
import { useAppContext } from './useAppContext';
import { usePublishPreferences } from './usePublishPreferences';
import { useToast } from './useToast';
import { getEffectiveRelays } from '@/lib/appRelays';
import { sendToInboxRelays } from '@/lib/inboxRelays';
import {
  GroupChatService,
  type GroupChatGroup,
  type GroupChatMessage,
  type GroupOperationResult,
} from '@/lib/groupChatService';
import { KIND_GROUP } from '@/lib/nip104Protocol';

export interface UseGroupChatReturn {
  groups: GroupChatGroup[];
  selectedGroup: GroupChatGroup | null;
  messages: GroupChatMessage[];
  members: { pubkey: string; role: 'admin' | 'member' }[];
  isLoading: boolean;
  isSending: boolean;
  error: string | null;
  canUseGroupChat: boolean;
  requiresNsec: boolean;
  selectGroup: (groupId: string | null) => void;
  getMessagesForGroup: (groupId: string) => GroupChatMessage[];
  createGroup: (name: string, description?: string, relays?: string[]) => Promise<GroupOperationResult<GroupChatGroup>>;
  /** The relay set a new group uses when the creator doesn't pick one. */
  defaultGroupRelays: string[];
  sendMessage: (content: string) => Promise<GroupOperationResult<GroupChatMessage>>;
  addMember: (pubkey: string) => Promise<GroupOperationResult>;
  removeMember: (pubkey: string) => Promise<GroupOperationResult>;
  banMember: (pubkey: string) => Promise<GroupOperationResult>;
  promoteAdmin: (pubkey: string) => Promise<GroupOperationResult>;
  updateGroupMetadata: (updates: { name?: string; description?: string }) => Promise<GroupOperationResult>;
  leaveGroup: (groupId: string) => Promise<GroupOperationResult>;
  joinFromWelcome: (giftWrapEvent: NostrEvent) => Promise<GroupOperationResult<GroupChatGroup>>;
  isAdmin: boolean;
}

export function useGroupChat(): UseGroupChatReturn {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { config } = useAppContext();
  const { isEnabled } = usePublishPreferences();
  const { toast } = useToast();

  // Group chat works with any signer that supports NIP-44 (nsec, browser
  // extension, bunker). Only signers without NIP-44 are excluded.
  const signer = user?.signer;
  const supportsNip44 = !!signer?.nip44;
  const effectiveRelays = useMemo(
    () => getEffectiveRelays(config.relayMetadata, config.useAppRelays, config.useUserRelays).relays,
    [config.relayMetadata, config.useAppRelays, config.useUserRelays],
  );
  const effectiveUrls = useMemo(
    () => effectiveRelays.map((r) => r.url).filter(Boolean),
    [effectiveRelays],
  );
  const groupChatRelays = useMemo(
    () =>
      config.groupChatRelays?.length
        ? config.groupChatRelays
        : effectiveRelays.map((r) => r.url).filter(Boolean),
    [config.groupChatRelays, effectiveRelays],
  );

  const [service, setService] = useState<GroupChatService | null>(null);
  useEffect(() => {
    if (!user || !signer || !supportsNip44) {
      setService(null);
      return;
    }
    try {
      setService(new GroupChatService(user.pubkey, signer, groupChatRelays));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to initialize group chat';
      console.error('[useGroupChat] Service construction failed:', message);
      setService(null);
    }
  }, [user, signer, supportsNip44, groupChatRelays]);

  const [groups, setGroups] = useState<GroupChatGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [messages, setMessages] = useState<GroupChatMessage[]>([]);
  const [members, setMembers] = useState<{ pubkey: string; role: 'admin' | 'member' }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const groupsRef = useRef(groups);
  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);

  const groupKeys = useMemo(
    () =>
      groups
        .map((g) => g.nostrGroupId)
        .sort()
        .join(','),
    [groups],
  );

  const canUseGroupChat = !!service;
  const requiresNsec = !!user && !supportsNip44;

  const refreshFromService = useCallback(() => {
    if (!service) return;
    setGroups(service.getGroups());
    if (selectedGroupId) {
      setMessages(service.getMessages(selectedGroupId));
      setMembers(service.getMembers(selectedGroupId));
    } else {
      setMessages([]);
      setMembers([]);
    }
  }, [service, selectedGroupId]);

  useEffect(() => {
    if (!service) {
      setIsLoading(false);
      return;
    }
    refreshFromService();
    setIsLoading(false);
  }, [service, refreshFromService]);

  const selectedGroup = useMemo(() => {
    if (!selectedGroupId) return null;
    return groups.find((g) => g.nostrGroupId === selectedGroupId) ?? null;
  }, [groups, selectedGroupId]);

  const selectGroup = useCallback((groupId: string | null) => {
    setSelectedGroupId(groupId);
    setError(null);
  }, []);

  const getMessagesForGroup = useCallback(
    (groupId: string) => service?.getMessages(groupId) ?? [],
    [service],
  );

  // Subscribe to kind 1059 gift wraps for Welcome events.
  // Listen on both the effective global relays and any custom group-chat relays
  // so invitations are not missed when a group uses relays outside the global set.
  useEffect(() => {
    if (!service || !user) return;

    const ac = new AbortController();
    let alive = true;

    const welcomeRelays = [
      ...new Set([...effectiveUrls, ...(config.groupChatRelays ?? [])]),
    ];
    const welcomePool = welcomeRelays.length > 0 ? nostr.group(welcomeRelays) : nostr;

    (async () => {
      try {
        const historical = await welcomePool.query(
          [{ kinds: [1059], '#p': [user.pubkey], limit: 100 }],
          { signal: ac.signal },
        );
        for (const event of historical) {
          if (!alive) break;
          const result = await service.joinFromWelcome(event);
          if (result.success) {
            refreshFromService();
            if (result.data) {
              setSelectedGroupId(result.data.nostrGroupId);
            }
          }
        }
      } catch {
        // Abort expected.
      }

      try {
        const now = Math.floor(Date.now() / 1000);
        for await (const msg of welcomePool.req(
          [{ kinds: [1059], '#p': [user.pubkey], since: now, limit: 0 }],
          { signal: ac.signal },
        )) {
          if (!alive) break;
          if (msg[0] === 'EVENT') {
            const event = msg[2];
            const result = await service.joinFromWelcome(event);
            if (result.success) {
              refreshFromService();
              if (result.data) {
                setSelectedGroupId(result.data.nostrGroupId);
              }
            }
          } else if (msg[0] === 'CLOSED') {
            break;
          }
        }
      } catch {
        // Abort expected on unmount.
      }
    })();

    return () => {
      alive = false;
      ac.abort();
    };
  }, [nostr, service, user, refreshFromService, effectiveUrls, config.groupChatRelays]);

  // Subscribe to kind 445 group events for joined groups.
  // Query the relays stored in each group's metadata so messages are fetched
  // even when a group uses custom relays outside the global set.
  useEffect(() => {
    if (!service || groupsRef.current.length === 0) return;

    const ac = new AbortController();
    let alive = true;

    const groupRelays = [...new Set(groupsRef.current.flatMap((g) => g.relays))];
    const groupPool = groupRelays.length > 0 ? nostr.group(groupRelays) : nostr;

    (async () => {
      try {
        const filters = groupsRef.current.map((g) => ({
          kinds: [KIND_GROUP],
          '#h': [g.nostrGroupId],
          limit: 200,
        }));

        const initial = await groupPool.query(filters, { signal: ac.signal });
        for (const event of initial) {
          if (!alive) break;
          await service.processGroupEvent(event);
        }
        refreshFromService();
      } catch {
        // Abort expected.
      }

      try {
        const now = Math.floor(Date.now() / 1000);
        const filters = groupsRef.current.map((g) => ({
          kinds: [KIND_GROUP],
          '#h': [g.nostrGroupId],
          since: now,
          limit: 0,
        }));

        for await (const msg of groupPool.req(filters, { signal: ac.signal })) {
          if (!alive) break;
          if (msg[0] === 'EVENT') {
            const event = msg[2];
            const result = await service.processGroupEvent(event);
            if (result.success) {
              refreshFromService();
            }
          } else if (msg[0] === 'CLOSED') {
            break;
          }
        }
      } catch {
        // Abort expected on unmount.
      }
    })();

    return () => {
      alive = false;
      ac.abort();
    };
  }, [nostr, service, groupKeys, refreshFromService]);

  const publishEvents = useCallback(
    async (events?: NostrEvent[]) => {
      if (!events || events.length === 0) return;
      if (!isEnabled('directMessages')) {
        toast({
          title: 'Group chat publishing disabled',
          description: 'Turn on “Direct messages” in Settings → Privacy & Publishing to send group messages.',
        });
        return;
      }
      const targetRelays = selectedGroup?.relays?.length ? selectedGroup.relays : groupChatRelays;
      for (const event of events) {
        try {
          if (targetRelays.length > 0) {
            await nostr.group(targetRelays).event(event, { signal: AbortSignal.timeout(5000) });
          } else {
            await nostr.event(event, { signal: AbortSignal.timeout(5000) });
          }
        } catch (err) {
          console.error('[useGroupChat] Failed to publish event:', err);
        }

        // Best-effort inbox delivery for welcome gift wraps so new members receive
        // invitations even if they don't actively read the group's relays.
        if (event.kind === 1059) {
          const taggedPubkeys = event.tags
            .filter(([name]) => name === 'p' || name === 'P')
            .map(([, pubkey]) => pubkey)
            .filter((pubkey): pubkey is string => typeof pubkey === 'string');
          if (taggedPubkeys.length > 0) {
            sendToInboxRelays(nostr, event, taggedPubkeys).catch((error) => {
              console.warn('[useGroupChat] Inbox relay delivery failed:', error);
            });
          }
        }
      }
    },
    [nostr, isEnabled, toast, selectedGroup, groupChatRelays],
  );

  const createGroup = useCallback(
    async (name: string, description?: string, relays?: string[]) => {
      if (!service) {
        return { success: false, error: 'Group chat requires a signer with NIP-44 encryption support' } as GroupOperationResult<GroupChatGroup>;
      }
      setIsLoading(true);
      setError(null);
      try {
        const result = await service.createGroup(name, description, relays?.length ? relays : groupChatRelays);
        if (result.success && result.data) {
          refreshFromService();
          setSelectedGroupId(result.data.nostrGroupId);
        } else {
          setError(result.error ?? 'Failed to create group');
        }
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
        return { success: false, error: message } as GroupOperationResult<GroupChatGroup>;
      } finally {
        setIsLoading(false);
      }
    },
    [service, groupChatRelays, refreshFromService],
  );

  const sendMessage = useCallback(
    async (content: string) => {
      if (!service || !selectedGroupId) {
        return { success: false, error: 'No group selected' } as GroupOperationResult<GroupChatMessage>;
      }
      setIsSending(true);
      setError(null);
      try {
        const result = await service.sendMessage(selectedGroupId, content);
        if (result.success && result.events) {
          await publishEvents(result.events);
          refreshFromService();
        } else {
          setError(result.error ?? 'Failed to send message');
        }
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
        return { success: false, error: message } as GroupOperationResult<GroupChatMessage>;
      } finally {
        setIsSending(false);
      }
    },
    [service, selectedGroupId, publishEvents, refreshFromService],
  );

  const addMember = useCallback(
    async (pubkey: string) => {
      if (!service || !selectedGroupId) {
        return { success: false, error: 'No group selected' } as GroupOperationResult;
      }
      setError(null);
      try {
        const result = await service.addMember(selectedGroupId, pubkey);
        if (result.success && result.events) {
          await publishEvents(result.events);
          refreshFromService();
        } else {
          setError(result.error ?? 'Failed to add member');
        }
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
        return { success: false, error: message } as GroupOperationResult;
      }
    },
    [service, selectedGroupId, publishEvents, refreshFromService],
  );

  const removeMember = useCallback(
    async (pubkey: string) => {
      if (!service || !selectedGroupId) {
        return { success: false, error: 'No group selected' } as GroupOperationResult;
      }
      setError(null);
      try {
        const result = await service.removeMember(selectedGroupId, pubkey);
        if (result.success && result.events) {
          await publishEvents(result.events);
          refreshFromService();
        } else {
          setError(result.error ?? 'Failed to remove member');
        }
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
        return { success: false, error: message } as GroupOperationResult;
      }
    },
    [service, selectedGroupId, publishEvents, refreshFromService],
  );

  const banMember = useCallback(
    async (pubkey: string) => {
      if (!service || !selectedGroupId) {
        return { success: false, error: 'No group selected' } as GroupOperationResult;
      }
      setError(null);
      try {
        const result = await service.banMember(selectedGroupId, pubkey);
        if (result.success && result.events) {
          await publishEvents(result.events);
          refreshFromService();
        } else {
          setError(result.error ?? 'Failed to ban member');
        }
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
        return { success: false, error: message } as GroupOperationResult;
      }
    },
    [service, selectedGroupId, publishEvents, refreshFromService],
  );

  const promoteAdmin = useCallback(
    async (pubkey: string) => {
      if (!service || !selectedGroupId) {
        return { success: false, error: 'No group selected' } as GroupOperationResult;
      }
      setError(null);
      try {
        const result = await service.promoteAdmin(selectedGroupId, pubkey);
        if (result.success && result.events) {
          await publishEvents(result.events);
          refreshFromService();
        } else {
          setError(result.error ?? 'Failed to promote admin');
        }
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
        return { success: false, error: message } as GroupOperationResult;
      }
    },
    [service, selectedGroupId, publishEvents, refreshFromService],
  );

  const updateGroupMetadata = useCallback(
    async (updates: { name?: string; description?: string }) => {
      if (!service || !selectedGroupId) {
        return { success: false, error: 'No group selected' } as GroupOperationResult;
      }
      setError(null);
      try {
        const result = await service.updateGroupMetadata(selectedGroupId, updates);
        if (result.success && result.events) {
          await publishEvents(result.events);
          refreshFromService();
        } else {
          setError(result.error ?? 'Failed to update group info');
        }
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
        return { success: false, error: message } as GroupOperationResult;
      }
    },
    [service, selectedGroupId, publishEvents, refreshFromService],
  );

  const leaveGroup = useCallback(
    async (groupId: string) => {
      if (!service) {
        return { success: false, error: 'Group chat requires a signer with NIP-44 encryption support' } as GroupOperationResult;
      }
      setError(null);
      try {
        const result = await service.leaveGroup(groupId);
        if (result.success) {
          // Notify remaining members of the departure-triggered key rotation.
          if (result.events) {
            await publishEvents(result.events);
          }
          if (selectedGroupId === groupId) {
            setSelectedGroupId(null);
          }
          refreshFromService();
        } else {
          setError(result.error ?? 'Failed to leave group');
        }
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
        return { success: false, error: message } as GroupOperationResult;
      }
    },
    [service, selectedGroupId, publishEvents, refreshFromService],
  );

  const joinFromWelcome = useCallback(
    async (giftWrapEvent: NostrEvent) => {
      if (!service) {
        return { success: false, error: 'Group chat requires a signer with NIP-44 encryption support' } as GroupOperationResult<GroupChatGroup>;
      }
      setIsLoading(true);
      setError(null);
      try {
        const result = await service.joinFromWelcome(giftWrapEvent);
        if (result.success && result.data) {
          refreshFromService();
          setSelectedGroupId(result.data.nostrGroupId);
        } else {
          setError(result.error ?? 'Failed to join group');
        }
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
        return { success: false, error: message } as GroupOperationResult<GroupChatGroup>;
      } finally {
        setIsLoading(false);
      }
    },
    [service, refreshFromService],
  );

  const isAdmin = useMemo(() => {
    if (!selectedGroup) return false;
    return selectedGroup.adminPubkeys.some((a) => a === user?.pubkey);
  }, [selectedGroup, user]);

  return {
    groups,
    selectedGroup,
    messages,
    members,
    isLoading,
    isSending,
    error,
    canUseGroupChat,
    requiresNsec,
    selectGroup,
    getMessagesForGroup,
    createGroup,
    defaultGroupRelays: groupChatRelays,
    sendMessage,
    addMember,
    removeMember,
    banMember,
    promoteAdmin,
    updateGroupMetadata,
    leaveGroup,
    joinFromWelcome,
    isAdmin,
  };
}
