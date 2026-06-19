import { Link } from 'react-router-dom';
import { Shield, Lock } from 'lucide-react';
import { Card } from '@/components/ui/card';
import type { NostrEvent } from '@nostrify/nostrify';

interface GroupChatCardProps {
  event: NostrEvent;
  className?: string;
}

function getTag(tags: string[][], name: string): string | undefined {
  return tags.find(([n]) => n === name)?.[1];
}

export function GroupChatCard({ event, className }: GroupChatCardProps) {
  const groupId = getTag(event.tags, 'h');

  return (
    <Card className={`p-4 ${className ?? ''}`}>
      <div className="flex items-center gap-3 text-muted-foreground">
        <div className="size-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <Shield className="size-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">Private group message</p>
          <p className="text-xs truncate">
            <Lock className="inline size-3 mr-1" />
            Encrypted content — open in Private Groups to read.
          </p>
        </div>
        <Link
          to={groupId ? `/groups?g=${encodeURIComponent(groupId)}` : '/groups'}
          className="text-xs font-medium text-primary hover:underline shrink-0"
        >
          Open groups
        </Link>
      </div>
      {groupId && (
        <p className="text-[10px] text-muted-foreground mt-2 font-mono truncate">
          Group: {groupId}
        </p>
      )}
    </Card>
  );
}
