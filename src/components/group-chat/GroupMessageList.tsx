import { useEffect, useRef, useState } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuthor } from '@/hooks/useAuthor';
import { getDisplayName } from '@/lib/getDisplayName';
import type { GroupChatMessage, GroupChatGroup } from '@/lib/groupChatService';

interface GroupMessageListProps {
  group: GroupChatGroup | null;
  messages: GroupChatMessage[];
  currentUserPubkey?: string;
}

function SenderName({ pubkey, fallback }: { pubkey: string; fallback: string }) {
  const author = useAuthor(pubkey);
  return <>{getDisplayName(author.data?.metadata) || fallback}</>;
}

function MessageAvatar({ pubkey }: { pubkey: string }) {
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;
  const displayName = getDisplayName(metadata) || pubkey.slice(0, 8);
  return (
    <Avatar className="size-7 shrink-0">
      <AvatarFallback className="bg-primary/20 text-primary text-[10px]">
        {displayName[0]?.toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}

const SCROLL_NEAR_BOTTOM_THRESHOLD = 120;

export function GroupMessageList({ group, messages, currentUserPubkey }: GroupMessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);

  const checkNearBottom = () => {
    const el = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]');
    if (!(el instanceof HTMLElement)) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setIsNearBottom(distanceFromBottom < SCROLL_NEAR_BOTTOM_THRESHOLD);
  };

  useEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]');
    if (!(viewport instanceof HTMLElement)) return;
    const listener = () => checkNearBottom();
    viewport.addEventListener('scroll', listener);
    return () => viewport.removeEventListener('scroll', listener);
  }, []);

  useEffect(() => {
    if (isNearBottom && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isNearBottom]);

  if (!group) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Select a group to view messages.
      </div>
    );
  }

  return (
    <ScrollArea ref={scrollAreaRef} className="flex-1 p-4">
      {messages.length === 0 ? (
        <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
          No messages yet. Say something!
        </div>
      ) : (
        <div className="space-y-3">
          {messages.map((message) => {
            const isOwn = message.senderPubkey === currentUserPubkey;
            return (
              <div
                key={message.id}
                className={`flex gap-2 ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}
              >
                <MessageAvatar pubkey={message.senderPubkey} />
                <div
                  className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm ${
                    isOwn
                      ? 'bg-primary text-primary-foreground rounded-br-md'
                      : 'bg-muted rounded-bl-md'
                  }`}
                >
                  <div className="text-xs opacity-80 mb-0.5">
                    {isOwn ? 'You' : <SenderName pubkey={message.senderPubkey} fallback={message.senderPubkey.slice(0, 8)} />}
                  </div>
                  <div className="whitespace-pre-wrap break-words">{message.content}</div>
                  <div className="text-[10px] opacity-60 mt-1 text-right">
                    {new Date(message.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      )}
    </ScrollArea>
  );
}
