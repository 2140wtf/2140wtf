import { Users, Plus, MessageSquarePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { timeAgo } from '@/lib/timeAgo';
import { GroupAvatar } from '@/components/group-chat/GroupAvatar';
import type { GroupChatGroup } from '@/lib/groupChatService';

interface GroupListProps {
  groups: GroupChatGroup[];
  selectedGroupId: string | null;
  unreadCounts?: Record<string, number>;
  onSelectGroup: (groupId: string) => void;
  onCreateClick: () => void;
  className?: string;
}

export function GroupList({
  groups,
  selectedGroupId,
  unreadCounts = {},
  onSelectGroup,
  onCreateClick,
  className,
}: GroupListProps) {
  return (
    <div className={cn('flex flex-col h-full border-r bg-muted/30', className)}>
      <div className="p-3 border-b flex items-center justify-between">
        <h2 className="font-semibold text-sm">Private Groups</h2>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          aria-label="Create group"
          onClick={onCreateClick}
        >
          <Plus className="size-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        {groups.length === 0 ? (
          <div className="p-4">
            <div className="border border-dashed rounded-xl p-5 text-center space-y-3 bg-background/50">
              <div className="mx-auto size-10 rounded-full bg-muted flex items-center justify-center">
                <MessageSquarePlus className="size-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">No groups yet</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Create an encrypted group or join one with a Welcome event.
                </p>
              </div>
              <Button size="sm" variant="outline" className="w-full" onClick={onCreateClick}>
                <Users className="size-3.5 mr-1.5" />
                Create group
              </Button>
            </div>
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {groups.map((group) => {
              const isActive = selectedGroupId === group.nostrGroupId;
              const unreadCount = unreadCounts[group.nostrGroupId] ?? 0;
              const hasUnread = unreadCount > 0;

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
                    <div className="flex items-center gap-2">
                      <div className={cn('text-sm font-medium truncate', hasUnread && 'font-semibold')}>
                        {group.name}
                      </div>
                      {hasUnread && (
                        <span className="inline-flex items-center justify-center min-w-[1.125rem] h-[1.125rem] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold shrink-0">
                          {unreadCount > 99 ? '99+' : unreadCount}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span>
                        {group.members.length} member{group.members.length !== 1 ? 's' : ''}
                      </span>
                      {group.lastActivity > 0 && (
                        <>
                          <span className="opacity-50">•</span>
                          <span>{timeAgo(group.lastActivity)}</span>
                        </>
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
