import { Bot } from 'lucide-react';

import { useAuthor } from '@/hooks/useAuthor';
import { cn } from '@/lib/utils';

import type { NostrMetadata } from '@nostrify/nostrify';

interface BotPillProps {
  /**
   * Resolve the bot flag from this pubkey's kind-0 metadata. Ignored when
   * `metadata` is supplied.
   */
  pubkey?: string;
  /** Already-loaded metadata; skips the profile lookup when provided. */
  metadata?: NostrMetadata;
  className?: string;
}

/**
 * A small "Bot" pill shown next to a display name when the account's profile
 * metadata declares `bot: true` (NIP-24). Self-contained: pass a `pubkey` and
 * it resolves the flag via {@link useAuthor}, or pass already-loaded
 * `metadata` to skip the fetch (callers that render a name usually have it in
 * scope already). Renders nothing for non-bot or not-yet-known accounts, so it
 * can be dropped in next to any name unconditionally.
 */
export function BotPill({ pubkey, metadata, className }: BotPillProps) {
  // Only look the profile up when metadata wasn't handed to us; useAuthor
  // dedupes on ['author', pubkey], so passing a pubkey a sibling already
  // fetched costs nothing, and useAuthor(undefined) is inert.
  const author = useAuthor(metadata ? undefined : pubkey);
  const resolved = metadata ?? author.data?.metadata;
  if (resolved?.bot !== true) return null;

  return (
    <span
      title="Bot account"
      className={cn(
        'shrink-0 inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-500',
        className,
      )}
    >
      <Bot className="size-3" aria-hidden />
      Bot
    </span>
  );
}
