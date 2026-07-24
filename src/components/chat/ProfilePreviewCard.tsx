import { AtSign, Check, Copy, ExternalLink, MessageSquare, Music } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { BotPill } from "@/components/BotPill";
import { EmojifiedText } from "@/components/chat/CustomEmoji";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuthor } from "@/hooks/useAuthor";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { requestMention } from "@/hooks/useMentionBus";
import { useProfileTheme, usePrefetchProfileTheme } from "@/hooks/useProfileTheme";
import { isStatusExpired, useUserStatus } from "@/hooks/useUserStatus2";
import { toast } from "@/hooks/useToast";
import { getAvatarShape } from "@/lib/avatarShape";
import { appProfileUrl } from "@/lib/dittoUrl";
import { getDisplayName } from "@/lib/getDisplayName";
import { tryNpubEncode } from "@/lib/safeNip19";
import { cn } from "@/lib/utils";
import { writeClipboardText } from "@/lib/clipboard";
import { buildThemeVarStyle } from "@/themes";

interface ProfilePreviewCardProps {
  pubkey: string;
  /** The trigger element (e.g. an avatar). Rendered as the popover trigger. */
  children: React.ReactNode;
}

/** The body of the profile preview — banner, avatar, name, npub, bio, actions. */
function ProfilePreviewBody({ pubkey, onAction }: { pubkey: string; onAction?: () => void }) {
  const author = useAuthor(pubkey);
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const metadata = author.data?.metadata;
  const status = useUserStatus(pubkey).data?.status;
  const rawMusicStatus = useUserStatus(pubkey, "music").data?.status;
  // Music statuses expire when the track ends; hide one whose NIP-40 expiration
  // has passed even if it's still cached (no refetch happens within a session).
  const musicStatus = isStatusExpired(rawMusicStatus) ? undefined : rawMusicStatus;
  const displayName = getDisplayName(metadata, pubkey);
  const avatarShape = getAvatarShape(metadata);
  const npub = tryNpubEncode(pubkey);
  const [copied, setCopied] = useState(false);
  const isSelf = user?.pubkey === pubkey;

  const copyNpub = () => {
    if (!npub) return;
    writeClipboardText(npub).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }, () => undefined);
  };

  const message = () => {
    if (!npub) return;
    onAction?.();
    navigate(`/dms/${npub}`);
  };

  const mention = () => {
    if (requestMention(pubkey)) {
      onAction?.();
    } else {
      toast({ title: "Open a channel to mention someone" });
    }
  };

  const shortNpub = npub ? `${npub.slice(0, 12)}…${npub.slice(-6)}` : "";
  const appProfileHref = appProfileUrl(pubkey);

  return (
    <>
      {/* Mini banner */}
      <div className="h-16 bg-secondary relative">
        {metadata?.banner && (
          <img src={metadata.banner} alt="" className="w-full h-full object-cover" loading="lazy" />
        )}
      </div>

      <div className="px-4 pb-4">
        {/* Avatar overlapping the banner */}
        <div className="-mt-8 mb-2">
          <Avatar shape={avatarShape} className="size-16 border-[3px] border-background">
            <AvatarImage src={metadata?.picture} alt={displayName} />
            <AvatarFallback className="bg-primary/20 text-primary text-lg">
              {displayName[0]?.toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </div>

        {/* Name */}
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="font-bold text-[15px] truncate">
            {author.data?.event
              ? <EmojifiedText tags={author.data.event.tags}>{displayName}</EmojifiedText>
              : displayName}
          </div>
          <BotPill metadata={metadata} />
        </div>

        {/* NIP-38 status */}
        {status?.content && (
          status.link ? (
            <a
              href={status.link}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 block text-sm text-muted-foreground truncate hover:text-foreground transition-colors"
              title={status.content}
            >
              <EmojifiedText tags={status.event.tags}>{status.content}</EmojifiedText>
            </a>
          ) : (
            <div className="mt-1 text-sm text-muted-foreground truncate" title={status.content}>
              <EmojifiedText tags={status.event.tags}>{status.content}</EmojifiedText>
            </div>
          )
        )}

        {/* NIP-38 music status ("now playing"). Linked to the track when the
            event carries an `r` tag (e.g. a Spotify / YouTube Music search). */}
        {musicStatus?.content && (
          musicStatus.link ? (
            <a
              href={musicStatus.link}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground truncate hover:text-foreground transition-colors"
              title={musicStatus.content}
            >
              <Music className="size-3.5 shrink-0" />
              <span className="truncate">
                <EmojifiedText tags={musicStatus.event.tags}>{musicStatus.content}</EmojifiedText>
              </span>
            </a>
          ) : (
            <div
              className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground truncate"
              title={musicStatus.content}
            >
              <Music className="size-3.5 shrink-0" />
              <span className="truncate">
                <EmojifiedText tags={musicStatus.event.tags}>{musicStatus.content}</EmojifiedText>
              </span>
            </div>
          )
        )}

        {/* npub (copyable) */}
        {npub && (
          <button
            type="button"
            onClick={copyNpub}
            className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            title="Copy npub"
          >
            <span className="font-mono">{shortNpub}</span>
            {copied ? <Check className="size-3 text-primary" /> : <Copy className="size-3" />}
          </button>
        )}

        {/* Bio */}
        {metadata?.about && (
          <p className={cn(
            "text-sm text-muted-foreground mt-2 whitespace-pre-wrap break-words line-clamp-4",
          )}>
            {metadata.about}
          </p>
        )}

        {/* Actions */}
        {!isSelf && (
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" className="flex-1 clip-corner-lg h-8" onClick={message}>
              <MessageSquare className="size-3.5 mr-1.5" />
              Message
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="flex-1 clip-corner-lg h-8"
              onClick={mention}
            >
              <AtSign className="size-3.5 mr-1.5" />
              Mention
            </Button>
          </div>
        )}

        {/* View this person on 2140.wtf — the fuller social view. */}
        {appProfileHref && (
          <Button
            size="sm"
            className="mt-2 w-full clip-corner-lg h-8"
            asChild
          >
            <a
              href={appProfileHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => onAction?.()}
              title="View on 2140.wtf"
            >
              <ExternalLink className="size-3.5 mr-1.5" />
              View on 2140.wtf
            </a>
          </Button>
        )}
      </div>
    </>
  );
}

/**
 * Wraps a trigger element (typically an avatar) with a click-triggered popover
 * showing a compact profile preview: banner, avatar, display name, npub, and
 * bio. The card is tinted with the profile owner's Ditto theme when they have
 * one, so hovering a user shows their chosen colors.
 */
export function ProfilePreviewCard({ pubkey, children }: ProfilePreviewCardProps) {
  const [open, setOpen] = useState(false);
  const prefetchTheme = usePrefetchProfileTheme();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        asChild
        onPointerEnter={() => prefetchTheme(pubkey)}
        onFocus={() => prefetchTheme(pubkey)}
      >
        {children}
      </PopoverTrigger>
      {open && <ThemedPreviewContent pubkey={pubkey} onClose={() => setOpen(false)} />}
    </Popover>
  );
}

/**
 * The popover content, mounted only while open so the profile + theme queries
 * don't fire until the card is shown. Applies the profile owner's Ditto theme
 * (if any) as scoped CSS variables on the card element.
 */
function ThemedPreviewContent({ pubkey, onClose }: { pubkey: string; onClose: () => void }) {
  const dittoTheme = useProfileTheme(pubkey).data?.theme;
  const themeStyle = dittoTheme ? buildThemeVarStyle(dittoTheme.colors) : undefined;

  return (
    <PopoverContent
      side="bottom"
      align="start"
      sideOffset={8}
      style={themeStyle}
      className="w-72 p-0 rounded-2xl overflow-hidden border border-border shadow-xl"
      onClick={(e) => e.stopPropagation()}
    >
      <ProfilePreviewBody pubkey={pubkey} onAction={onClose} />
    </PopoverContent>
  );
}
