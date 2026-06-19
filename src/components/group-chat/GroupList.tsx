import { Users, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { GroupChatGroup } from '@/lib/groupChatService';

interface GroupListProps {
  groups: GroupChatGroup[];
  selectedGroupId: string | null;
  unreadGroupIds?: string[];
  onSelectGroup: (groupId: string) => void;
  onCreateClick: () => void;
}

export function GroupList({ groups, selectedGroupId, unreadGroupIds = [], onSelectGroup, onCreateClick }: GroupListProps) {
  return (
    <div className="flex flex-col h-full border-r bg-muted/30">
      <div className="p-3 border-b flex items-center justify-between">
        <h2 className="font-semibold text-sm">Private Groups</h2>
        <Button size="icon" variant="ghost" className="size-7" aria-label="Create group" onClick={onCreateClick}>
          <Plus className="size-4" />
        </Button>
      </div>
      <ScrollArea className="flex-1">
        {groups.length === 0 ? (
          <div className="p-4 text-xs text-muted-foreground text-center">
            No groups yet. Create one to start chatting.
          </div>
        ) : (
          <div className="p-1.5 space-y-0.5">
            {groups.map((group) => {
              const isActive = selectedGroupId === group.nostrGroupId;
              return (
                <button
                  key={group.nostrGroupId}
                  type="button"
                  aria-selected={isActive}
                  onClick={() => onSelectGroup(group.nostrGroupId)}
                  className={cn(
                    'w-full text-left px-3 py-2 rounded-lg flex items-center gap-2 transition-colors',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-muted',
                  )}
                >
                  <Users className="size-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{group.name}</div>
                    <div className="text-[10px] opacity-80 truncate">
                      {group.members.length} member{group.members.length !== 1 ? 's' : ''}
                    </div>
                  </div>
                  {!isActive && unreadGroupIds.includes(group.nostrGroupId) && (
                    <span className="size-2 rounded-full bg-primary shrink-0" aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
