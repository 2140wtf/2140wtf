import { useState } from 'react';
import { Crown, UserMinus, Shield, Ban, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useAuthor } from '@/hooks/useAuthor';
import { getDisplayName } from '@/lib/getDisplayName';
import type { GroupChatGroup } from '@/lib/groupChatService';

interface GroupMemberPanelProps {
  group: GroupChatGroup | null;
  members: { pubkey: string; role: 'admin' | 'member' }[];
  isAdmin: boolean;
  currentUserPubkey?: string;
  onAddMember: (pubkey: string) => Promise<void>;
  onRemoveMember: (pubkey: string) => Promise<void>;
  onBanMember: (pubkey: string) => Promise<void>;
  onPromoteAdmin: (pubkey: string) => Promise<void>;
}

function MemberAvatar({ pubkey }: { pubkey: string }) {
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;
  const displayName = getDisplayName(metadata) || pubkey.slice(0, 8);
  return (
    <Avatar className="size-6 shrink-0">
      <AvatarFallback className="bg-muted text-[10px]">
        {displayName[0]?.toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}

function MemberName({ pubkey, fallback }: { pubkey: string; fallback: string }) {
  const author = useAuthor(pubkey);
  return <>{getDisplayName(author.data?.metadata) || fallback}</>;
}

export function GroupMemberPanel({
  group,
  members,
  isAdmin,
  currentUserPubkey,
  onAddMember,
  onRemoveMember,
  onBanMember,
  onPromoteAdmin,
}: GroupMemberPanelProps) {
  const [invitePubkey, setInvitePubkey] = useState('');
  const [isInviting, setIsInviting] = useState(false);

  if (!group) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm p-4">
        Select a group to manage members.
      </div>
    );
  }

  const handleInvite = async () => {
    if (!invitePubkey.trim() || isInviting) return;
    setIsInviting(true);
    try {
      await onAddMember(invitePubkey.trim());
      setInvitePubkey('');
    } finally {
      setIsInviting(false);
    }
  };

  return (
    <div className="flex flex-col h-full border-l bg-muted/30 w-64">
      <div className="p-3 border-b">
        <h3 className="font-semibold text-sm">Members</h3>
        <p className="text-[10px] text-muted-foreground">
          {members.length} member{members.length !== 1 ? 's' : ''}
        </p>
      </div>

      {isAdmin && (
        <div className="p-3 border-b space-y-2">
          <div className="flex gap-1.5">
            <Input
              value={invitePubkey}
              onChange={(e) => setInvitePubkey(e.target.value)}
              placeholder="npub or hex pubkey"
              className="h-8 text-xs"
              onKeyDown={(e) => e.key === 'Enter' && void handleInvite()}
            />
            <Button
              size="icon"
              className="size-8 shrink-0"
              disabled={isInviting || !invitePubkey.trim()}
              onClick={() => void handleInvite()}
            >
              <UserPlus className="size-3.5" />
            </Button>
          </div>
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="p-1.5 space-y-0.5">
          {members.map((member) => {
            const isSelf = member.pubkey === currentUserPubkey;
            return (
              <div
                key={member.pubkey}
                className="group px-2.5 py-1.5 rounded-lg flex items-center gap-2 hover:bg-muted transition-colors"
              >
                <MemberAvatar pubkey={member.pubkey} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">
                    {isSelf ? 'You' : <MemberName pubkey={member.pubkey} fallback={member.pubkey.slice(0, 8)} />}
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate font-mono">
                    {member.pubkey.slice(0, 10)}…
                  </div>
                </div>
                {member.role === 'admin' && (
                  <span title="Admin" className="shrink-0">
                    <Crown className="size-3 text-amber-500" aria-label="Admin" />
                  </span>
                )}
                {isAdmin && !isSelf && (
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                    {member.role !== 'admin' && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-6"
                        title="Promote to admin"
                        onClick={() => void onPromoteAdmin(member.pubkey)}
                      >
                        <Shield className="size-3" />
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-6 text-destructive"
                      title="Remove"
                      onClick={() => void onRemoveMember(member.pubkey)}
                    >
                      <UserMinus className="size-3" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-6 text-destructive"
                      title="Ban"
                      onClick={() => void onBanMember(member.pubkey)}
                    >
                      <Ban className="size-3" />
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
