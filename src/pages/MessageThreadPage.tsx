import { useMemo, useRef, useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';
import { ArrowLeft, Send } from 'lucide-react';
import { nip19 } from 'nostr-tools';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useAppContext } from '@/hooks/useAppContext';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useDmInbox } from '@/hooks/useDmInbox';
import { useNip17SendMessage } from '@/hooks/useNip17SendMessage';
import { useDmReadCursors } from '@/hooks/useDmReadCursors';
import { useProfileUrl } from '@/hooks/useProfileUrl';
import { useToast } from '@/hooks/useToast';
import { computeNip17ConversationId, parseNip17Rumor } from '@/lib/nip17';
import { getAvatarShape } from '@/lib/avatarShape';
import { getDisplayName } from '@/lib/getDisplayName';
import { cn } from '@/lib/utils';
import { timeAgo } from '@/lib/timeAgo';

export function MessageThreadPage() {
  const { npub } = useParams<{ npub: string }>();
  const navigate = useNavigate();
  const { config } = useAppContext();
  const { user } = useCurrentUser();
  const { conversations, isLoading, addMessage } = useDmInbox();
  const { sendMessage, isPending } = useNip17SendMessage();
  const { markConversationRead } = useDmReadCursors();
  const { toast } = useToast();
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const recipientPubkey = useMemo(() => {
    if (!npub) return '';
    try {
      const decoded = nip19.decode(npub);
      if (decoded.type === 'npub') return decoded.data;
    } catch {
      // invalid npub
    }
    return '';
  }, [npub]);

  const conversationId = useMemo(() => {
    if (!user || !recipientPubkey) return '';
    return computeNip17ConversationId([user.pubkey, recipientPubkey]);
  }, [user, recipientPubkey]);

  const conversation = useMemo(
    () => conversations.find((c) => c.id === conversationId),
    [conversations, conversationId],
  );

  const author = useAuthor(recipientPubkey);
  const metadata = author.data?.metadata;
  const displayName = getDisplayName(metadata) || recipientPubkey.slice(0, 8);
  const profileUrl = useProfileUrl(recipientPubkey, metadata);
  const shape = getAvatarShape(metadata);

  useSeoMeta({
    title: `${displayName} | Messages | ${config.appName}`,
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation?.messages.length]);

  useEffect(() => {
    if (conversation) {
      markConversationRead(conversation);
    }
  }, [conversation, markConversationRead]);

  if (!user) {
    return (
      <main className="flex-1 min-w-0 flex items-center justify-center text-muted-foreground">
        Log in to send messages.
      </main>
    );
  }

  if (!recipientPubkey) {
    return (
      <main className="flex-1 min-w-0 flex items-center justify-center text-muted-foreground">
        Invalid conversation link.
      </main>
    );
  }

  const handleSend = async () => {
    const content = draft.trim();
    if (!content || isPending) return;

    try {
      const { rumor } = await sendMessage({ recipientPubkey, content });
      const parsed = parseNip17Rumor(rumor, rumor.id);
      if (parsed) {
        addMessage(parsed);
      }
      setDraft('');
    } catch (error) {
      toast({
        title: 'Message failed',
        description: error instanceof Error ? error.message : 'Could not send message',
        variant: 'destructive',
      });
    }
  };

  return (
    <main className="flex-1 min-w-0 flex flex-col h-[calc(100dvh-4rem)]">
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center gap-3 bg-background/95 backdrop-blur border-b border-border px-4 py-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft className="size-5" />
        </Button>
        <Avatar className={cn('size-9', shape === 'square' && 'rounded-lg')} shape={shape}>
          {metadata?.picture && <AvatarImage src={metadata.picture} alt={displayName} />}
          <AvatarFallback className="bg-primary/20 text-primary text-sm">
            {displayName[0]?.toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <a
          href={profileUrl}
          onClick={(e) => {
            e.preventDefault();
            navigate(profileUrl);
          }}
          className="font-semibold hover:underline truncate"
        >
          {displayName}
        </a>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {isLoading && !conversation ? (
          <ThreadSkeleton />
        ) : conversation ? (
          conversation.messages.map((message) => {
            const isMe = message.sender === user.pubkey;
            return (
              <div
                key={message.id}
                className={cn(
                  'flex',
                  isMe ? 'justify-end' : 'justify-start',
                )}
              >
                <div
                  className={cn(
                    'max-w-[80%] rounded-2xl px-4 py-2 text-sm',
                    isMe
                      ? 'bg-primary text-primary-foreground rounded-br-md'
                      : 'bg-muted rounded-bl-md',
                  )}
                >
                  <p className="whitespace-pre-wrap break-words">{message.content}</p>
                  <span
                    className={cn(
                      'text-[10px] block mt-1',
                      isMe ? 'text-primary-foreground/70' : 'text-muted-foreground',
                    )}
                  >
                    {timeAgo(message.createdAt)}
                  </span>
                </div>
              </div>
            );
          })
        ) : (
          <div className="text-center text-muted-foreground py-12">
            No messages yet. Say hello!
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="border-t border-border p-3 flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          placeholder="Message..."
          className="flex-1"
          disabled={isPending}
        />
        <Button onClick={() => void handleSend()} disabled={!draft.trim() || isPending}>
          <Send className="size-4" />
        </Button>
      </div>
    </main>
  );
}

function ThreadSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-16 w-3/4 rounded-2xl" />
      <Skeleton className="h-16 w-2/3 rounded-2xl ml-auto" />
      <Skeleton className="h-12 w-1/2 rounded-2xl" />
    </div>
  );
}
