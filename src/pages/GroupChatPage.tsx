import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';
import { LogIn, Lock, LogOut, Menu, MessageSquarePlus, Shield, Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';
import { PageHeader } from '@/components/PageHeader';
import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useGroupChatContext } from '@/hooks/useGroupChatContext';
import { useGroupChatReadCursors } from '@/hooks/useGroupChatReadCursors';
import { useGroupChatHasUnread } from '@/hooks/useGroupChatHasUnread';
import { GroupList } from '@/components/group-chat/GroupList';
import { GroupMessageList } from '@/components/group-chat/GroupMessageList';
import { GroupMessageInput } from '@/components/group-chat/GroupMessageInput';
import { GroupMemberPanel } from '@/components/group-chat/GroupMemberPanel';
import { CreateGroupDialog } from '@/components/group-chat/CreateGroupDialog';
import { JoinGroupDialog } from '@/components/group-chat/JoinGroupDialog';
import { GroupAvatar } from '@/components/group-chat/GroupAvatar';
import { toast } from '@/hooks/useToast';
import type { GroupChatMessage } from '@/lib/groupChatService';

function GroupChatSkeleton() {
  return (
    <div className="flex-1 flex overflow-hidden">
      <div className="w-64 shrink-0 hidden sm:flex flex-col gap-2 p-3 border-r bg-muted/30">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-2">
            <Skeleton className="size-9 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="h-2.5 w-1/2" />
            </div>
          </div>
        ))}
      </div>
      <div className="flex-1 flex flex-col min-w-0">
        <div className="px-4 py-3 border-b flex items-center gap-3">
          <Skeleton className="size-8 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
        <div className="flex-1 p-4 space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={`flex gap-2 ${i % 2 === 0 ? '' : 'flex-row-reverse'}`}>
              <Skeleton className="size-7 rounded-full" />
              <Skeleton className="h-16 w-2/3 rounded-2xl" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function GroupChatPage() {
  const { config } = useAppContext();
  const { user } = useCurrentUser();
  const {
    groups,
    selectedGroup,
    messages,
    members,
    isLoading,
    isSending,
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
    leaveGroup,
    joinFromWelcome,
    isAdmin,
  } = useGroupChatContext();
  const { markGroupRead, markAllGroupsRead } = useGroupChatReadCursors();
  const { unreadGroups } = useGroupChatHasUnread();
  const unreadCounts = useMemo(
    () => Object.fromEntries(unreadGroups.map(({ group, unreadCount }) => [group.nostrGroupId, unreadCount])),
    [unreadGroups],
  );
  const lastMessages = useMemo(() => {
    const map: Record<string, GroupChatMessage> = {};
    for (const message of messages) {
      const existing = map[message.nostrGroupId];
      if (!existing || message.timestamp > existing.timestamp) {
        map[message.nostrGroupId] = message;
      }
    }
    return map;
  }, [messages]);
  const initialMarkReadDone = useRef(false);

  useEffect(() => {
    if (!isLoading && groups.length > 0 && !initialMarkReadDone.current) {
      initialMarkReadDone.current = true;
      markAllGroupsRead(groups, getMessagesForGroup);
    }
  }, [isLoading, groups, messages, getMessagesForGroup, markAllGroupsRead]);

  useEffect(() => {
    if (selectedGroup) {
      markGroupRead(
        selectedGroup,
        messages.filter((m) => m.nostrGroupId === selectedGroup.nostrGroupId),
      );
    }
  }, [selectedGroup, messages, markGroupRead]);

  useSeoMeta({
    title: `Private Groups | ${config.appName}`,
    description: 'End-to-end encrypted group chat on Nostr.',
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [mobileListOpen, setMobileListOpen] = useState(false);
  const [searchParams] = useSearchParams();
  const initialGroupSelected = useRef(false);

  useEffect(() => {
    if (isLoading || initialGroupSelected.current) return;
    const groupId = searchParams.get('g');
    if (groupId && groups.some((g) => g.nostrGroupId === groupId)) {
      initialGroupSelected.current = true;
      selectGroup(groupId);
    }
  }, [isLoading, groups, searchParams, selectGroup]);

  if (!user) {
    return <Navigate to="/" replace />;
  }

  if (requiresNsec) {
    return (
      <div className="container max-w-2xl py-12">
        <Card className="p-8 text-center space-y-4">
          <div className="mx-auto w-14 h-14 rounded-full bg-muted flex items-center justify-center">
            <Lock className="size-7 text-muted-foreground" />
          </div>
          <h1 className="text-2xl font-bold">Private Groups</h1>
          <p className="text-muted-foreground">
            Group chat encryption requires access to your private key. Please log in with an
            nsec key instead of a browser extension or bunker.
          </p>
          <Button onClick={() => window.location.reload()}>
            <LogIn className="size-4 mr-2" />
            Switch account
          </Button>
        </Card>
      </div>
    );
  }

  const handleCreate = async (name: string, description?: string) => {
    const result = await createGroup(name, description);
    if (result.success) {
      toast({ title: 'Group created' });
    } else {
      toast({ title: result.error ?? 'Failed to create group', variant: 'destructive' });
    }
  };

  const handleSend = async (content: string) => {
    const result = await sendMessage(content);
    if (!result.success) {
      toast({ title: result.error ?? 'Failed to send message', variant: 'destructive' });
    }
  };

  const handleJoin = async (event: import('@nostrify/nostrify').NostrEvent) => {
    const result = await joinFromWelcome(event);
    if (result.success) {
      toast({ title: `Joined ${result.data?.name ?? 'group'}` });
    } else {
      toast({ title: result.error ?? 'Failed to join group', variant: 'destructive' });
    }
  };

  const handleAddMember = async (pubkey: string): Promise<void> => {
    const result = await addMember(pubkey);
    if (!result.success) {
      toast({ title: result.error ?? 'Failed to add member', variant: 'destructive' });
    }
  };

  const handleRemoveMember = async (pubkey: string): Promise<void> => {
    if (!window.confirm('Remove this member from the group?')) return;
    const result = await removeMember(pubkey);
    if (!result.success) {
      toast({ title: result.error ?? 'Failed to remove member', variant: 'destructive' });
    }
  };

  const handleBanMember = async (pubkey: string): Promise<void> => {
    if (!window.confirm('Ban this member from the group? They will not be able to rejoin.')) return;
    const result = await banMember(pubkey);
    if (!result.success) {
      toast({ title: result.error ?? 'Failed to ban member', variant: 'destructive' });
    }
  };

  const handlePromoteAdmin = async (pubkey: string): Promise<void> => {
    const result = await promoteAdmin(pubkey);
    if (!result.success) {
      toast({ title: result.error ?? 'Failed to promote admin', variant: 'destructive' });
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <PageHeader
        title="Private Groups"
        icon={
          <div className="p-1.5 rounded-lg bg-primary/10">
            <Shield className="size-5 text-primary" />
          </div>
        }
      >
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="sm:hidden"
            onClick={() => setMobileListOpen(true)}
          >
            <Menu className="size-4 mr-1.5" />
            Groups
          </Button>
          <Button variant="outline" size="sm" onClick={() => setJoinOpen(true)}>
            Join group
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Users className="size-4 mr-1.5" />
            Create group
          </Button>
        </div>
      </PageHeader>

      {isLoading && groups.length === 0 ? (
        <GroupChatSkeleton />
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {groups.length > 0 && (
            <div className="w-64 shrink-0 hidden sm:block">
              <GroupList
                groups={groups}
                selectedGroupId={selectedGroup?.nostrGroupId ?? null}
                unreadCounts={unreadCounts}
                lastMessages={lastMessages}
                onSelectGroup={selectGroup}
              />
            </div>
          )}

          <div className="flex-1 flex flex-col min-w-0">
            {selectedGroup ? (
              <>
                <div className="px-4 py-2.5 border-b flex items-center gap-3 bg-muted/20">
                  <GroupAvatar
                    groupId={selectedGroup.nostrGroupId}
                    name={selectedGroup.name}
                    className="size-9"
                  />
                  <div className="min-w-0 flex-1">
                    <h2 className="font-semibold text-sm truncate">{selectedGroup.name}</h2>
                    {selectedGroup.description && (
                      <p
                        className="text-xs text-muted-foreground truncate"
                        title={selectedGroup.description}
                      >
                        {selectedGroup.description}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground hover:text-destructive shrink-0"
                    disabled={isAdmin && selectedGroup.adminPubkeys.length === 1}
                    title={
                      isAdmin && selectedGroup.adminPubkeys.length === 1
                        ? 'Transfer admin role before leaving'
                        : 'Leave group'
                    }
                    aria-label="Leave group"
                    onClick={() => {
                      if (!window.confirm('Leave this group? Your local copy of the chat will be removed.')) return;
                      void leaveGroup(selectedGroup.nostrGroupId);
                    }}
                  >
                    <LogOut className="size-4" />
                  </Button>
                </div>
                <GroupMessageList
                  group={selectedGroup}
                  messages={messages}
                  currentUserPubkey={user.pubkey}
                />
                <GroupMessageInput disabled={isSending || !canUseGroupChat} onSend={handleSend} />
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center p-4">
                <Card className="max-w-sm w-full p-6 text-center space-y-4 border-dashed">
                  <div className="mx-auto size-14 rounded-full bg-primary/10 flex items-center justify-center">
                    <MessageSquarePlus className="size-7 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold">
                      {groups.length === 0 ? 'Start a private group' : 'Select a group'}
                    </h2>
                    <p className="text-sm text-muted-foreground mt-1">
                      {groups.length === 0
                        ? 'Create an encrypted group and invite others to start chatting.'
                        : 'Choose a group from the sidebar to view messages and manage members.'}
                    </p>
                  </div>
                  {groups.length === 0 && (
                    <Button className="w-full" onClick={() => setCreateOpen(true)}>
                      <Users className="size-4 mr-2" />
                      Create group
                    </Button>
                  )}
                </Card>
              </div>
            )}
          </div>

          {selectedGroup && (
            <div className="shrink-0 hidden lg:block">
              <GroupMemberPanel
                group={selectedGroup}
                members={members}
                isAdmin={isAdmin}
                currentUserPubkey={user.pubkey}
                onAddMember={handleAddMember}
                onRemoveMember={handleRemoveMember}
                onBanMember={handleBanMember}
                onPromoteAdmin={handlePromoteAdmin}
              />
            </div>
          )}
        </div>
      )}

      <Sheet open={mobileListOpen} onOpenChange={setMobileListOpen}>
        <SheetContent side="left" className="p-0 w-72">
          <SheetTitle className="sr-only">Private Groups</SheetTitle>
          <SheetDescription className="sr-only">Select a group to chat</SheetDescription>
          <div className="flex flex-col h-full">
            <div className="px-4 pt-4 pb-2 border-b">
              <h2 className="text-base font-semibold">Your groups</h2>
              <p className="text-xs text-muted-foreground">Select a group to open it</p>
            </div>
            <div className="p-2">
              <Button
                variant="outline"
                className="w-full justify-start gap-2"
                size="sm"
                onClick={() => {
                  setMobileListOpen(false);
                  setCreateOpen(true);
                }}
              >
                <Users className="size-4" />
                New group
              </Button>
            </div>
            <GroupList
              groups={groups}
              selectedGroupId={selectedGroup?.nostrGroupId ?? null}
              unreadCounts={unreadCounts}
              lastMessages={lastMessages}
              onSelectGroup={(groupId) => {
                selectGroup(groupId);
                setMobileListOpen(false);
              }}
              className="border-r-0 flex-1"
            />
          </div>
        </SheetContent>
      </Sheet>

      <CreateGroupDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={handleCreate}
      />
      <JoinGroupDialog open={joinOpen} onOpenChange={setJoinOpen} onJoin={handleJoin} />
    </div>
  );
}
