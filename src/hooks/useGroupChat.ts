/**
 * useGroupChat Hook
 *
 * React hook for Ditto's encrypted group chat.
 * Manages group state, message subscriptions, and event publishing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNostr } from '@nostrify/react';
import { useNostrLogin } from '@nostrify/react/login';
import { nip19, getPublicKey } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';

import { useCurrentUser } from './useCurrentUser';
import { useAppContext } from './useAppContext';
import { usePublishPreferences } from './usePublishPreferences';
import { useToast } from './useToast';
import {
  GroupChatService,
  type GroupChatGroup,
  type GroupChatMessage,
  type GroupOperationResult,
} from '@/lib/groupChatService';
import { KIND_GROUP } from '@/lib/nip104Protocol';

function extractPrivateKey(logins: unknown[], userPubkey?: string): Uint8Array | null {
  if (!Array.isArray(logins) || !userPubkey) return null;
  const targetPubkey = userPubkey.toLowerCase();
  for (const login of logins) {
    const l = login as { type?: string; data?: { nsec?: string } } | undefined;
    if (!l || l.type !== 'nsec' || !l.data?.nsec) continue;

    try {
      const decoded = nip19.decode(l.data.nsec);
      if (decoded.type === 'nsec') {
        const privkey = decoded.data as Uint8Array;
        const pubkey = getPublicKey(privkey).toLowerCase();
        if (pubkey === targetPubkey) {
          return privkey;
        }
      }
    } catch {
      // ignore
    }
  }
  return null;
}

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
  createGroup: (name: string, description?: string) => Promise<GroupOperationResult<GroupChatGroup>>;
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
  const { logins } = useNostrLogin();
  const { config } = useAppContext();
  const { isEnabled } = usePublishPreferences();
  const { toast } = useToast();

  const privateKey = useMemo(
    () => extractPrivateKey(logins as unknown[], user?.pubkey),
    [logins, user?.pubkey],
  );
  const relays = useMemo(
    () => config.relayMetadata?.relays?.map((r) => r.url).filter(Boolean) ?? [],
    [config.relayMetadata],
  );

  const [service, setService] = useState<GroupChatService | null>(null);
  useEffect(() => {
    if (!user || !privateKey) {
      setService(null);
      return;
    }
    try {
      setService(new GroupChatService(user.pubkey, privateKey, relays));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to initialize group chat';
      console.error('[useGroupChat] Service construction failed:', message);
      setService(null);
    }
  }, [user, privateKey, relays]);

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
  const requiresNsec = !!user && !privateKey;

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
  useEffect(() => {
    if (!service || !user) return;

    const ac = new AbortController();
    let alive = true;

    (async () => {
      try {
        const historical = await nostr.query(
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
        for await (const msg of nostr.req(
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
  }, [nostr, service, user, refreshFromService]);

  // Subscribe to kind 445 group events for joined groups.
  useEffect(() => {
    if (!service || groupsRef.current.length === 0) return;

    const ac = new AbortController();
    let alive = true;

    (async () => {
      try {
        const filters = groupsRef.current.map((g) => ({
          kinds: [KIND_GROUP],
          '#h': [g.nostrGroupId],
          limit: 200,
        }));

        const initial = await nostr.query(filters, { signal: ac.signal });
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

        for await (const msg of nostr.req(filters, { signal: ac.signal })) {
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
      for (const event of events) {
        try {
          await nostr.event(event, { signal: AbortSignal.timeout(5000) });
        } catch (err) {
          console.error('[useGroupChat] Failed to publish event:', err);
        }
      }
    },
    [nostr, isEnabled, toast],
  );

  const createGroup = useCallback(
    async (name: string, description?: string) => {
      if (!service) {
        return { success: false, error: 'Group chat requires nsec login' } as GroupOperationResult<GroupChatGroup>;
      }
      setIsLoading(true);
      setError(null);
      try {
        const result = await service.createGroup(name, description, relays);
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
    [service, relays, refreshFromService],
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
        if (result.success) {
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
    [service, selectedGroupId, refreshFromService],
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
        return { success: false, error: 'Group chat requires nsec login' } as GroupOperationResult;
      }
      setError(null);
      try {
        const result = service.leaveGroup(groupId);
        if (result.success) {
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
    [service, selectedGroupId, refreshFromService],
  );

  const joinFromWelcome = useCallback(
    async (giftWrapEvent: NostrEvent) => {
      if (!service) {
        return { success: false, error: 'Group chat requires nsec login' } as GroupOperationResult<GroupChatGroup>;
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
