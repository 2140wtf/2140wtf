import { NoGroupsIllustration } from '@/components/group-chat/GroupEmptyIllustrations';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { timeAgo } from '@/lib/timeAgo';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { getDisplayName } from '@/lib/getDisplayName';
import { GroupAvatar } from '@/components/group-chat/GroupAvatar';
import type { GroupChatGroup, GroupChatMessage } from '@/lib/groupChatService';

interface GroupListProps {
  groups: GroupChatGroup[];
  selectedGroupId: string | null;
  unreadCounts?: Record<string, number>;
  lastMessages?: Record<string, GroupChatMessage>;
  onSelectGroup: (groupId: string) => void;
  className?: string;
}

function truncate(str: string, max: number): string {
  return str.length > max ? `${str.slice(0, max).trimEnd()}…` : str;
}

function LastMessageLine({ message }: { message: GroupChatMessage }) {
  const { user } = useCurrentUser();
  const author = useAuthor(message.senderPubkey);
  const isOwn = message.senderPubkey === user?.pubkey;
  const name = isOwn
    ? 'You'
    : getDisplayName(author.data?.metadata) || message.senderPubkey.slice(0, 8);

  return (
    <span className="truncate">
      <span className="text-foreground/80">{name}:</span>{' '}
      <span className="opacity-80">{truncate(message.content, 72)}</span>
    </span>
  );
}

export function GroupList({
  groups,
  selectedGroupId,
  unreadCounts = {},
  lastMessages = {},
  onSelectGroup,
  className,
}: GroupListProps) {
  return (
    <div className={cn('flex flex-col h-full border-r bg-muted/30', className)}>
      <ScrollArea className="flex-1">
        {groups.length === 0 ? (
          <div className="p-4">
            <div className="border border-dashed rounded-xl p-5 text-center space-y-3 bg-background/50">
              <NoGroupsIllustration className="mx-auto size-16 text-primary/60" />
              <div>
                <p className="text-sm font-medium">No groups yet</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Create or join a group to start chatting.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {groups.map((group) => {
              const isActive = selectedGroupId === group.nostrGroupId;
              const unreadCount = unreadCounts[group.nostrGroupId] ?? 0;
              const hasUnread = unreadCount > 0;
              const lastMessage = lastMessages[group.nostrGroupId];

              return (
                <button
                  key={group.nostrGroupId}
                  type="button"
                  aria-selected={isActive}
                  onClick={() => onSelectGroup(group.nostrGroupId)}
                  className={cn(
                    'w-full text-left px-2.5 py-2 rounded-xl flex items-center gap-3 transition-colors relative',
                    isActive
                      ? 'bg-primary/10 text-primary before:absolute before:left-0 before:top-2 before:bottom-2 before:w-1 before:rounded-full before:bg-primary'
                      : 'hover:bg-muted/60',
                  )}
                >
                  <GroupAvatar
                    groupId={group.nostrGroupId}
                    name={group.name}
                    className="size-9 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className={cn('text-sm font-medium truncate', hasUnread && 'font-semibold')}>
                        {group.name}
                      </div>
                      {hasUnread && (
                        <span className="inline-flex items-center justify-center min-w-[1.125rem] h-[1.125rem] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold shrink-0">
                          {unreadCount > 99 ? '99+' : unreadCount}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0 text-[11px] text-muted-foreground truncate">
                        {lastMessage ? (
                          <LastMessageLine message={lastMessage} />
                        ) : (
                          <span>
                            {group.members.length} member{group.members.length !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                      {(lastMessage || group.lastActivity > 0) && (
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {timeAgo(
                            Math.floor(
                              (lastMessage ? lastMessage.timestamp : group.lastActivity) / 1000,
                            ),
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
