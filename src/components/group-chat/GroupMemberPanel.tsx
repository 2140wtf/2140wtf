import { useMemo, useState } from 'react';
import { nip19 } from 'nostr-tools';
import { Crown, UserMinus, Shield, Ban, UserPlus, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAuthor } from '@/hooks/useAuthor';
import { getDisplayName } from '@/lib/getDisplayName';
import { NoMembersIllustration } from '@/components/group-chat/GroupEmptyIllustrations';
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
    <Avatar className="size-7 shrink-0">
      <AvatarImage src={metadata?.picture} alt={displayName} />
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

  const isValidInvite = useMemo(() => {
    const value = invitePubkey.trim();
    if (!value) return false;
    if (/^[0-9a-fA-F]{64}$/.test(value)) return true;
    try {
      return nip19.decode(value).type === 'npub';
    } catch {
      return false;
    }
  }, [invitePubkey]);

  if (!group) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <Card className="max-w-xs w-full p-5 text-center space-y-3 border-dashed">
          <NoMembersIllustration className="mx-auto size-16 text-primary/60" />
          <p className="text-sm text-muted-foreground">Select a group to manage members.</p>
        </Card>
      </div>
    );
  }

  const handleInvite = async () => {
    if (!isValidInvite || isInviting) return;
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
            <div className="relative flex-1">
              <Input
                value={invitePubkey}
                onChange={(e) => setInvitePubkey(e.target.value)}
                placeholder="npub or hex pubkey"
                className="h-8 text-xs pr-8"
                onKeyDown={(e) => e.key === 'Enter' && void handleInvite()}
              />
              {isValidInvite && (
                <Check className="absolute right-2 top-1/2 -translate-y-1/2 size-3.5 text-success" />
              )}
            </div>
            <Button
              size="icon"
              className="size-8 shrink-0"
              aria-label="Invite member"
              disabled={isInviting || !isValidInvite}
              onClick={() => void handleInvite()}
            >
              <UserPlus className="size-3.5" />
            </Button>
          </div>
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-0.5">
          {members.map((member) => {
            const isSelf = member.pubkey === currentUserPubkey;
            return (
              <div
                key={member.pubkey}
                className="group px-2.5 py-1.5 rounded-lg flex items-center gap-2 hover:bg-muted transition-colors"
              >
                <MemberAvatar pubkey={member.pubkey} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <div className="text-xs font-medium truncate">
                      {isSelf ? 'You' : <MemberName pubkey={member.pubkey} fallback={member.pubkey.slice(0, 8)} />}
                    </div>
                    {member.role === 'admin' && (
                      <Badge
                        variant="secondary"
                        className="px-1 py-0 h-4 text-[9px] gap-0.5 bg-amber-500/10 text-amber-600 hover:bg-amber-500/10"
                      >
                        <Crown className="size-2.5" />
                        Admin
                      </Badge>
                    )}
                    {isSelf && member.role !== 'admin' && (
                      <Badge variant="secondary" className="px-1 py-0 h-4 text-[9px]">
                        You
                      </Badge>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate font-mono">
                    {member.pubkey.slice(0, 10)}…
                  </div>
                </div>
                {isAdmin && !isSelf && (
                  <div className="flex items-center gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100">
                    {member.role !== 'admin' && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-6"
                        title="Promote to admin"
                        aria-label="Promote to admin"
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
                      aria-label="Remove member"
                      onClick={() => void onRemoveMember(member.pubkey)}
                    >
                      <UserMinus className="size-3" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-6 text-destructive"
                      title="Ban"
                      aria-label="Ban member"
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
