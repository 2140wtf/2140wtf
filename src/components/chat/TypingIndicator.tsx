import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuthor } from "@/hooks/useAuthor";
import { useScopedDisplayName } from "@/hooks/useScopedDisplayName";
import { getAvatarShape } from "@/lib/avatarShape";

/** Cap the avatar stack so an unbounded typer list doesn't resolve unbounded profiles. */
const MAX_AVATARS = 3;

/** One typer's avatar, resolved like message authors (scoped name for the tooltip/alt). */
function TypingAvatar({ pubkey }: { pubkey: string }) {
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;
  const name = useScopedDisplayName(pubkey, metadata);
  return (
    <Avatar shape={getAvatarShape(metadata)} className="size-5 ring-2 ring-background" title={name}>
      <AvatarImage src={metadata?.picture} alt={name} />
      <AvatarFallback className="bg-primary/25 text-primary text-[9px] font-semibold">
        {name?.trim()?.[0]?.toUpperCase() ?? "?"}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * Signal-style typing indicator: an overlapping stack of the typers' avatars
 * next to a message-bubble pill containing three sequentially pulsing dots.
 * Beyond MAX_AVATARS typers the stack collapses into a "+N" chip.
 */
export function TypingIndicator({ pubkeys }: { pubkeys: string[] }) {
  if (pubkeys.length === 0) return null;
  const shown = pubkeys.slice(0, MAX_AVATARS);
  const overflow = pubkeys.length - shown.length;
  return (
    <div className="flex items-center gap-2 px-4 pb-1" role="status" aria-label="Someone is typing">
      <div className="flex -space-x-1.5">
        {shown.map((pk) => (
          <TypingAvatar key={pk} pubkey={pk} />
        ))}
        {overflow > 0 && (
          <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-semibold text-muted-foreground ring-2 ring-background">
            +{overflow}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-2">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-1.5 rounded-full bg-muted-foreground animate-typing-dot"
            style={{ animationDelay: `${i * 160}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
