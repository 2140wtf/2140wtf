import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';
import { Info, Lock, Mail, Users } from 'lucide-react';
import type { NostrEvent } from '@nostrify/nostrify';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { GroupList } from '@/components/group-chat/GroupList';
import { CreateGroupDialog } from '@/components/group-chat/CreateGroupDialog';
import { JoinGroupDialog } from '@/components/group-chat/JoinGroupDialog';
import { useAppContext } from '@/hooks/useAppContext';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useDmInbox } from '@/hooks/useDmInbox';
import { useDmReadCursors } from '@/hooks/useDmReadCursors';
import { useGroupChatContext } from '@/hooks/useGroupChatContext';
import { useGroupChatHasUnread } from '@/hooks/useGroupChatHasUnread';
import { toast } from '@/hooks/useToast';
import type { Nip17Conversation } from '@/hooks/useNip17Inbox';
import type { GroupChatMessage } from '@/lib/groupChatService';

import { getAvatarShape } from '@/lib/avatarShape';
import { getDisplayName } from '@/lib/getDisplayName';
import { nip19 } from 'nostr-tools';
import { timeAgo } from '@/lib/timeAgo';
import { cn } from '@/lib/utils';

export function MessagesPage() {
  const { config } = useAppContext();
  const { user } = useCurrentUser();
  const navigate = useNavigate();
  const { conversations, isLoading } = useDmInbox();
  const { getCursor } = useDmReadCursors();
  const {
    groups,
    isLoading: isGroupsLoading,
    requiresNsec,
    createGroup,
    defaultGroupRelays,
    joinFromWelcome,
    getMessagesForGroup,
  } = useGroupChatContext();
  const { unreadGroups } = useGroupChatHasUnread();
  const unreadGroupCounts = useMemo(
    () => Object.fromEntries(unreadGroups.map(({ group, unreadCount }) => [group.nostrGroupId, unreadCount])),
    [unreadGroups],
  );
  const lastMessages = useMemo(() => {
    const map: Record<string, GroupChatMessage> = {};
    for (const group of groups) {
      const msgs = getMessagesForGroup(group.nostrGroupId);
      const last = msgs.reduce(
        (max, message) => (message.timestamp > max.timestamp ? message : max),
        msgs[0],
      );
      if (last) map[group.nostrGroupId] = last;
    }
    return map;
  }, [groups, getMessagesForGroup]);
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);

  useSeoMeta({
    title: `Chat | ${config.appName}`,
    description: 'Your private Nostr messages and groups',
  });

  const handleCreate = async (name: string, description?: string, relays?: string[]) => {
    const result = await createGroup(name, description, relays);
    if (result.success) {
      toast({ title: 'Group created' });
    } else {
      toast({ title: result.error ?? 'Failed to create group', variant: 'destructive' });
    }
  };

  const handleJoin = async (event: NostrEvent) => {
    const result = await joinFromWelcome(event);
    if (result.success) {
      toast({ title: `Joined ${result.data?.name ?? 'group'}` });
    } else {
      toast({ title: result.error ?? 'Failed to join group', variant: 'destructive' });
    }
  };

  if (!user) {
    return (
      <main className="flex-1 min-w-0">
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border px-4 py-3">
          <h1 className="text-lg font-semibold">Chat</h1>
        </div>
        <div className="py-16 text-center text-muted-foreground">
          Log in to see your messages and groups.
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 min-w-0">
      <Tabs defaultValue="inbox" className="flex flex-col">
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border px-4 py-3">
          <h1 className="text-lg font-semibold mb-3">Chat</h1>
          <TabsList className="w-full">
            <TabsTrigger value="inbox" className="flex-1 gap-2">
              <Mail className="size-4" />
              Private Inbox
            </TabsTrigger>
            <TabsTrigger value="groups" className="flex-1 gap-2">
              <Users className="size-4" />
              Private Groups
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="inbox" className="mt-0">
          {isLoading && conversations.length === 0 ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 4 }).map((_, i) => (
                <ConversationSkeleton key={i} />
              ))}
            </div>
          ) : conversations.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">
              <Mail className="mx-auto size-10 mb-3 opacity-40" />
              <p>No messages yet.</p>
              <p className="text-sm mt-1 max-w-xs mx-auto">
                Start a conversation from a user&apos;s profile.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {conversations.map((conversation) => {
                const cursor = getCursor(conversation.id);
                const unreadCount = conversation.messages.reduce(
                  (count, message) =>
                    message.sender === user.pubkey || message.createdAt <= cursor
                      ? count
                      : count + 1,
                  0,
                );
                return (
                  <ConversationRow
                    key={conversation.id}
                    conversation={conversation}
                    unreadCount={unreadCount}
                  />
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="groups" className="mt-0">
          {requiresNsec ? (
            <div className="p-8 flex justify-center">
              <Card className="p-6 text-center max-w-md space-y-4">
                <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                  <Lock className="size-6 text-muted-foreground" />
                </div>
                <h2 className="text-xl font-bold">Private Groups</h2>
                <p className="text-muted-foreground">
                  Private groups use end-to-end encryption. Your current login method doesn't
                  support the encryption operations needed. Please log in with an nsec key or use
                  a signer that supports NIP-44 encryption (e.g., Alby, Amber, or a compatible
                  bunker).
                </p>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
                    >
                      <Info className="size-3.5" />
                      Why?
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    Group chat encrypts and decrypts messages with NIP-44. Some browser extensions
                    and bunkers don't expose these operations to apps, so 2140.wtf can't read or
                    write encrypted group messages through them.
                  </TooltipContent>
                </Tooltip>
              </Card>
            </div>
          ) : (
            <div className="flex flex-col">
              <div className="px-4 py-2 border-b flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Your encrypted groups</span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setJoinOpen(true)}>
                    Join group
                  </Button>
                  <Button size="sm" onClick={() => setCreateOpen(true)}>
                    <Users className="size-4 mr-1.5" />
                    Create group
                  </Button>
                </div>
              </div>
              {isGroupsLoading && groups.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground">Loading groups…</div>
              ) : (
                <GroupList
                  groups={groups}
                  selectedGroupId={null}
                  unreadCounts={unreadGroupCounts}
                  lastMessages={lastMessages}
                  onSelectGroup={(groupId) => navigate(`/groups?g=${encodeURIComponent(groupId)}`)}
                  className="border-r-0 bg-transparent"
                />
              )}
            </div>
          )}
          <CreateGroupDialog open={createOpen} onOpenChange={setCreateOpen} onCreate={handleCreate} defaultRelays={defaultGroupRelays} />
          <JoinGroupDialog open={joinOpen} onOpenChange={setJoinOpen} onJoin={handleJoin} />
        </TabsContent>
      </Tabs>
    </main>
  );
}

function ConversationRow({
  conversation,
  unreadCount,
}: {
  conversation: Nip17Conversation;
  unreadCount: number;
}) {
  const { user } = useCurrentUser();
  const otherPubkey = conversation.participants[0] ?? user?.pubkey ?? '';
  const npub = useMemo(() => {
    try {
      return nip19.npubEncode(otherPubkey);
    } catch {
      return '';
    }
  }, [otherPubkey]);

  const lastMessage = conversation.messages[conversation.messages.length - 1];

  return (
    <Link
      to={`/messages/${npub}`}
      className="relative flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
    >
      {unreadCount > 0 && (
        <span className="absolute left-3 top-1/2 -translate-y-1/2 size-2.5 bg-primary rounded-full" aria-hidden="true" />
      )}
      <ConversationAvatar pubkey={otherPubkey} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <ParticipantName pubkey={otherPubkey} />
          {lastMessage && (
            <span className={cn(
              'text-xs shrink-0',
              unreadCount > 0 ? 'text-primary font-medium' : 'text-muted-foreground',
            )}>
              {timeAgo(lastMessage.createdAt)}
            </span>
          )}
        </div>
        <p className={cn(
          'text-sm truncate',
          unreadCount > 0 ? 'text-foreground font-medium' : 'text-muted-foreground',
        )}>
          {lastMessage ? lastMessage.content : 'No messages'}
        </p>
      </div>
    </Link>
  );
}

function ConversationAvatar({ pubkey }: { pubkey: string }) {
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;
  const name = getDisplayName(metadata) || pubkey.slice(0, 8);
  const shape = getAvatarShape(metadata);

  return (
    <Avatar className={cn('size-11 shrink-0', shape === 'square' && 'rounded-lg')} shape={shape}>
      {metadata?.picture && <AvatarImage src={metadata.picture} alt={name} />}
      <AvatarFallback className="bg-primary/20 text-primary text-sm">
        {name[0]?.toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}

function ParticipantName({ pubkey }: { pubkey: string }) {
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;
  const name = getDisplayName(metadata) || pubkey.slice(0, 8);

  return (
    <span className="font-semibold text-sm truncate">
      {name}
    </span>
  );
}

function ConversationSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Skeleton className="size-11 rounded-full shrink-0" />
      <div className="flex-1 min-w-0 space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-3/4" />
      </div>
    </div>
  );
}
