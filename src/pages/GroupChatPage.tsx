import { useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';
import { LogIn, Lock, Menu, Shield, Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Sheet,
  SheetContent,
} from '@/components/ui/sheet';
import { PageHeader } from '@/components/PageHeader';
import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useGroupChatContext } from '@/hooks/useGroupChatContext';
import { useGroupChatReadCursors } from '@/hooks/useGroupChatReadCursors';
import { GroupList } from '@/components/group-chat/GroupList';
import { GroupMessageList } from '@/components/group-chat/GroupMessageList';
import { GroupMessageInput } from '@/components/group-chat/GroupMessageInput';
import { GroupMemberPanel } from '@/components/group-chat/GroupMemberPanel';
import { CreateGroupDialog } from '@/components/group-chat/CreateGroupDialog';
import { JoinGroupDialog } from '@/components/group-chat/JoinGroupDialog';
import { toast } from '@/hooks/useToast';

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
  const initialMarkReadDone = useRef(false);

  useEffect(() => {
    if (!isLoading && groups.length > 0 && !initialMarkReadDone.current) {
      initialMarkReadDone.current = true;
      markAllGroupsRead(groups, (groupId) => messages.filter((m) => m.nostrGroupId === groupId));
    }
  }, [isLoading, groups, messages, markAllGroupsRead]);

  useEffect(() => {
    if (selectedGroup) {
      markGroupRead(selectedGroup, messages.filter((m) => m.nostrGroupId === selectedGroup.nostrGroupId));
    }
  }, [selectedGroup, messages, markGroupRead]);

  useSeoMeta({
    title: `Private Groups | ${config.appName}`,
    description: 'End-to-end encrypted group chat on Nostr.',
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [mobileListOpen, setMobileListOpen] = useState(false);

  if (!user) {
    return <Navigate to="/" replace />;
  }

  if (requiresNsec) {
    return (
      <div className="container max-w-2xl py-12">
        <Card className="p-8 text-center space-y-4">
          <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center">
            <Lock className="size-6 text-muted-foreground" />
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
    const result = await removeMember(pubkey);
    if (!result.success) {
      toast({ title: result.error ?? 'Failed to remove member', variant: 'destructive' });
    }
  };

  const handleBanMember = async (pubkey: string): Promise<void> => {
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
      <PageHeader title="Private Groups" icon={<Shield className="size-5" />}>
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
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          Loading groups…
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          <div className="w-64 shrink-0 hidden sm:block">
            <GroupList
              groups={groups}
              selectedGroupId={selectedGroup?.nostrGroupId ?? null}
              onSelectGroup={selectGroup}
              onCreateClick={() => setCreateOpen(true)}
            />
          </div>
          <div className="flex-1 flex flex-col min-w-0">
            {selectedGroup ? (
              <>
                <div className="px-4 py-2 border-b flex items-center justify-between bg-muted/20">
                  <div>
                    <h2 className="font-semibold text-sm">{selectedGroup.name}</h2>
                    {selectedGroup.description && (
                      <p className="text-xs text-muted-foreground truncate max-w-md">
                        {selectedGroup.description}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => void leaveGroup(selectedGroup.nostrGroupId)}
                  >
                    Leave
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
              <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                Select or create a group to start chatting.
              </div>
            )}
          </div>
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
        </div>
      )}

      <Sheet open={mobileListOpen} onOpenChange={setMobileListOpen}>
        <SheetContent side="left" className="p-0 w-72">
          <GroupList
            groups={groups}
            selectedGroupId={selectedGroup?.nostrGroupId ?? null}
            onSelectGroup={(groupId) => {
              selectGroup(groupId);
              setMobileListOpen(false);
            }}
            onCreateClick={() => {
              setMobileListOpen(false);
              setCreateOpen(true);
            }}
          />
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
