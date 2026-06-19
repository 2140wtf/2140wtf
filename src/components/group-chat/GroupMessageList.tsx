import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuthor } from '@/hooks/useAuthor';
import { getDisplayName } from '@/lib/getDisplayName';
import { cn } from '@/lib/utils';
import type { GroupChatMessage, GroupChatGroup } from '@/lib/groupChatService';

interface GroupMessageListProps {
  group: GroupChatGroup | null;
  messages: GroupChatMessage[];
  currentUserPubkey?: string;
}

const CLUSTER_GAP_MS = 5 * 60 * 1000;

function SenderName({ pubkey, fallback }: { pubkey: string; fallback: string }) {
  const author = useAuthor(pubkey);
  return <>{getDisplayName(author.data?.metadata) || fallback}</>;
}

function MessageAvatar({ pubkey }: { pubkey: string }) {
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;
  const displayName = getDisplayName(metadata) || pubkey.slice(0, 8);
  return (
    <Avatar className="size-8 shrink-0">
      <AvatarImage src={metadata?.picture} alt={displayName} />
      <AvatarFallback className="bg-primary/15 text-primary text-[10px] font-semibold">
        {displayName[0]?.toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatDateSeparator(date: Date): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (isSameDay(date, today)) return 'Today';
  if (isSameDay(date, yesterday)) return 'Yesterday';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

type DisplayItem =
  | { type: 'date'; date: Date }
  | { type: 'message'; message: GroupChatMessage; isFirstInCluster: boolean };

function buildDisplayItems(messages: GroupChatMessage[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  let lastMessage: GroupChatMessage | null = null;

  for (const message of messages) {
    const date = new Date(message.timestamp);
    if (!lastMessage || !isSameDay(date, new Date(lastMessage.timestamp))) {
      items.push({ type: 'date', date });
    }

    const isFirstInCluster =
      !lastMessage ||
      message.senderPubkey !== lastMessage.senderPubkey ||
      message.timestamp - lastMessage.timestamp > CLUSTER_GAP_MS;

    items.push({ type: 'message', message, isFirstInCluster });
    lastMessage = message;
  }

  return items;
}

const SCROLL_NEAR_BOTTOM_THRESHOLD = 120;

export function GroupMessageList({ group, messages, currentUserPubkey }: GroupMessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);

  const items = useMemo(() => buildDisplayItems(messages), [messages]);

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
  }, [items, isNearBottom]);

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
        <div className="h-full min-h-[12rem] flex items-center justify-center">
          <Card className="max-w-xs w-full p-6 text-center space-y-3 border-dashed">
            <div className="mx-auto size-12 rounded-full bg-muted flex items-center justify-center">
              <MessageSquare className="size-6 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium">No messages yet</p>
              <p className="text-sm text-muted-foreground mt-1">Say something to get the conversation started.</p>
            </div>
          </Card>
        </div>
      ) : (
        <div className="space-y-1">
          {items.map((item, index) => {
            if (item.type === 'date') {
              return (
                <div key={`date-${index}`} className="flex items-center gap-3 py-4">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                    {formatDateSeparator(item.date)}
                  </span>
                  <div className="flex-1 h-px bg-border" />
                </div>
              );
            }

            const { message, isFirstInCluster } = item;
            const isOwn = message.senderPubkey === currentUserPubkey;

            return (
              <div
                key={message.id}
                className={cn('flex gap-2', isOwn ? 'flex-row-reverse' : 'flex-row', isFirstInCluster ? 'mt-3' : 'mt-1')}
              >
                {isFirstInCluster ? (
                  <MessageAvatar pubkey={message.senderPubkey} />
                ) : (
                  <div className="size-8 shrink-0" aria-hidden="true" />
                )}
                <div
                  className={cn(
                    'max-w-[80%] px-3.5 py-2 rounded-2xl text-sm shadow-sm',
                    isOwn
                      ? 'bg-primary text-primary-foreground rounded-br-md'
                      : 'bg-muted border border-border/50 rounded-bl-md',
                  )}
                >
                  {isFirstInCluster && !isOwn && (
                    <div className="text-xs font-medium text-primary mb-0.5">
                      <SenderName pubkey={message.senderPubkey} fallback={message.senderPubkey.slice(0, 8)} />
                    </div>
                  )}
                  <div className="whitespace-pre-wrap break-words">{message.content}</div>
                  <div
                    className={cn(
                      'text-[10px] mt-1 opacity-70',
                      isOwn ? 'text-right' : 'text-left',
                    )}
                  >
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
