import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';
import { Mail } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { useAppContext } from '@/hooks/useAppContext';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNip17Inbox } from '@/hooks/useNip17Inbox';
import { useDmReadCursors } from '@/hooks/useDmReadCursors';

import { getAvatarShape } from '@/lib/avatarShape';
import { getDisplayName } from '@/lib/getDisplayName';
import { nip19 } from 'nostr-tools';
import { timeAgo } from '@/lib/timeAgo';
import { cn } from '@/lib/utils';

export function MessagesPage() {
  const { config } = useAppContext();
  const { user } = useCurrentUser();
  const { conversations, isLoading } = useNip17Inbox();
  const { markAllConversationsRead, getCursor } = useDmReadCursors();

  useEffect(() => {
    if (!isLoading && conversations.length > 0) {
      markAllConversationsRead(conversations);
    }
  }, [isLoading, conversations, markAllConversationsRead]);

  useSeoMeta({
    title: `Messages | ${config.appName}`,
    description: 'Your private Nostr messages',
  });

  return (
    <main className="flex-1 min-w-0">
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border px-4 py-3">
        <h1 className="text-lg font-semibold">Messages</h1>
      </div>

      {!user ? (
        <div className="py-16 text-center text-muted-foreground">
          Log in to see your messages.
        </div>
      ) : isLoading && conversations.length === 0 ? (
        <div className="divide-y divide-border">
          {Array.from({ length: 4 }).map((_, i) => (
            <ConversationSkeleton key={i} />
          ))}
        </div>
      ) : conversations.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground">
          <Mail className="mx-auto size-10 mb-3 opacity-40" />
          <p>No messages yet.</p>
          <p className="text-sm mt-1 max-w-xs mx-auto">
            Start a conversation from a user's profile.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {conversations.map((conversation) => {
            const cursor = getCursor(conversation.id);
            const unreadCount = user
              ? conversation.messages.reduce(
                (count, message) =>
                  message.sender === user.pubkey || message.createdAt <= cursor
                    ? count
                    : count + 1,
                0,
              )
              : 0;
            return (
              <ConversationRow
                key={conversation.id}
                conversation={conversation}
                unreadCount={unreadCount}
              />
            );
          })}
        </div>
      )}
    </main>
  );
}

function ConversationRow({
  conversation,
  unreadCount,
}: {
  conversation: ReturnType<typeof useNip17Inbox>['conversations'][number];
  unreadCount: number;
}) {
  const { user } = useCurrentUser();
  const otherPubkey = conversation.participants[0] ?? user?.pubkey ?? '';
  const npub = useMemo(() => {
    try {
      return nip19.npubEncode(otherPubkey);
    } catch {
      return '';
    }
  }, [otherPubkey]);

  const lastMessage = conversation.messages[conversation.messages.length - 1];

  return (
    <Link
      to={`/messages/${npub}`}
      className="relative flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
    >
      {unreadCount > 0 && (
        <span className="absolute left-1.5 top-1/2 -translate-y-1/2 size-2 bg-primary rounded-full" aria-hidden="true" />
      )}
      <ConversationAvatar pubkey={otherPubkey} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <ParticipantName pubkey={otherPubkey} />
          {lastMessage && (
            <span className={cn(
              'text-xs shrink-0',
              unreadCount > 0 ? 'text-primary font-medium' : 'text-muted-foreground',
            )}>
              {timeAgo(lastMessage.createdAt)}
            </span>
          )}
        </div>
        <p className={cn(
          'text-sm truncate',
          unreadCount > 0 ? 'text-foreground font-medium' : 'text-muted-foreground',
        )}>
          {lastMessage ? lastMessage.content : 'No messages'}
        </p>
      </div>
    </Link>
  );
}

function ConversationAvatar({ pubkey }: { pubkey: string }) {
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;
  const name = getDisplayName(metadata) || pubkey.slice(0, 8);
  const shape = getAvatarShape(metadata);

  return (
    <Avatar className={cn('size-11 shrink-0', shape === 'square' && 'rounded-lg')} shape={shape}>
      {metadata?.picture && <AvatarImage src={metadata.picture} alt={name} />}
      <AvatarFallback className="bg-primary/20 text-primary text-sm">
        {name[0]?.toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}

function ParticipantName({ pubkey }: { pubkey: string }) {
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;
  const name = getDisplayName(metadata) || pubkey.slice(0, 8);

  return (
    <span className="font-semibold text-sm truncate">
      {name}
    </span>
  );
}

function ConversationSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Skeleton className="size-11 rounded-full shrink-0" />
      <div className="flex-1 min-w-0 space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-3/4" />
      </div>
    </div>
  );
}
