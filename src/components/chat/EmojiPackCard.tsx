import { Check, Loader2, Plus, Smile } from "lucide-react";
import { useState } from "react";

import { CustomEmojiImg } from "@/components/chat/CustomEmoji";
import { ProfilePreviewCard } from "@/components/chat/ProfilePreviewCard";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  emojiPackEntries,
  emojiPackName,
  useAddEmojiPack,
  useHasEmojiPack,
} from "@/hooks/useEmojiPacks";
import { useAuthor } from "@/hooks/useAuthor";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { toast } from "@/hooks/useToast";
import { getAvatarShape } from "@/lib/avatarShape";
import { getDisplayName } from "@/lib/getDisplayName";
import { cn } from "@/lib/utils";

import type { NostrEvent } from "@nostrify/nostrify";

/** How many emojis to show in the preview grid before "+N more". */
const PREVIEW_LIMIT = 16;

interface EmojiPackCardProps {
  /** The kind-30030 emoji set event. */
  event: NostrEvent;
  className?: string;
}

/**
 * Discord/Ditto-style preview card for a NIP-30 emoji pack (kind 30030) posted
 * in chat: the pack name + author, a grid preview of its emojis, and a one-tap
 * "Add" button that appends it to the viewer's kind-10030 emoji list.
 */
export function EmojiPackCard({ event, className }: EmojiPackCardProps) {
  const { user } = useCurrentUser();
  const author = useAuthor(event.pubkey);
  const metadata = author.data?.metadata;
  const displayName = getDisplayName(metadata, event.pubkey);

  const name = emojiPackName(event);
  const identifier = event.tags.find((t) => t[0] === "d")?.[1] ?? "";
  const entries = emojiPackEntries(event);

  const coord = `30030:${event.pubkey}:${identifier}`;
  const alreadyAdded = useHasEmojiPack(coord);
  const { mutateAsync: addPack, isPending } = useAddEmojiPack();
  const [added, setAdded] = useState(false);

  const visible = entries.slice(0, PREVIEW_LIMIT);
  const extra = entries.length - visible.length;

  const onAdd = async () => {
    if (!user) {
      toast({ title: "Sign in to add emoji packs" });
      return;
    }
    try {
      await addPack({ pubkey: event.pubkey, identifier });
      setAdded(true);
      toast({ title: "Emoji pack added", description: name });
    } catch (e) {
      toast({
        title: "Couldn't add pack",
        description: e instanceof Error ? e.message : "Publishing failed.",
        variant: "destructive",
      });
    }
  };

  const isAdded = alreadyAdded || added;

  return (
    <div
      className={cn(
        "block max-w-sm w-full rounded-2xl border border-border bg-secondary/30 overflow-hidden my-1.5",
        className,
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-3.5 py-3 space-y-2.5">
        {/* Header: pack name + author */}
        <div className="flex items-center gap-2 min-w-0">
          <Smile className="size-4 shrink-0 text-primary" />
          <p className="font-semibold truncate leading-tight flex-1">{name}</p>
          <span className="text-[10px] px-1.5 py-px rounded-full bg-secondary text-muted-foreground shrink-0">
            Emoji pack
          </span>
        </div>

        <ProfilePreviewCard pubkey={event.pubkey}>
          <button
            type="button"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground min-w-0"
            onClick={(e) => e.stopPropagation()}
          >
            <Avatar shape={getAvatarShape(metadata)} className="size-4 shrink-0">
              <AvatarImage src={metadata?.picture} alt={displayName} />
              <AvatarFallback className="bg-primary/20 text-primary text-[8px]">
                {displayName[0]?.toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="truncate">by {displayName}</span>
          </button>
        </ProfilePreviewCard>

        {/* Emoji preview grid */}
        {visible.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {visible.map((e) => (
              <CustomEmojiImg
                key={e.shortcode}
                name={e.shortcode}
                url={e.url}
                className="h-7 w-7 object-contain"
              />
            ))}
            {extra > 0 && (
              <span className="flex h-7 min-w-7 items-center justify-center rounded px-1 text-xs font-medium text-muted-foreground">
                +{extra}
              </span>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">This pack has no emojis.</p>
        )}

        {/* Add button */}
        {isAdded ? (
          <Button variant="secondary" className="w-full clip-corner-lg" disabled>
            <Check className="size-4" />
            Added
          </Button>
        ) : (
          <Button
            className="w-full clip-corner-lg"
            onClick={onAdd}
            disabled={isPending || entries.length === 0}
          >
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Adding…
              </>
            ) : (
              <>
                <Plus className="size-4" />
                Add {entries.length > 0 ? `${entries.length} emoji${entries.length === 1 ? "" : "s"}` : "pack"}
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
