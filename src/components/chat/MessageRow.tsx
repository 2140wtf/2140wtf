import { Loader2, PawPrint, Reply } from "lucide-react";
import { memo } from "react";
import { Link } from "react-router-dom";

import { ProfilePreviewCard } from "@/components/chat/ProfilePreviewCard";
import { BotPill } from "@/components/BotPill";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useAuthor } from "@/hooks/useAuthor";
import { useScopedIdentity } from "@/hooks/useScopedDisplayName";
import { getAvatarShape } from "@/lib/avatarShape";
import { shortClockTime, shortTimeAgo } from "@/lib/formatTime";
import { cn } from "@/lib/utils";
import { useSwipeToReply } from "@/hooks/useSwipeToReply";

import type { PetBodyInfo } from "@/lib/petBodies";
import type { ReactNode } from "react";

/**
 * An explicit display identity for a message author, used by surfaces whose
 * authors are NOT Nostr identities (the Bluetooth mesh). When supplied,
 * MessageRow renders this directly and skips the kind-0 author lookup and
 * server-scoped profile resolution entirely (no wasted relay queries, no
 * "Anonymous" fallback for a non-pubkey author key).
 */
export interface MessageIdentity {
  /** Name to display. */
  name: string;
  /** Username color (CSS color), or undefined for the default. */
  color?: string;
  /** A muted suffix shown after the name (e.g. a mesh `#abcd` disambiguator). */
  suffix?: string;
}

interface MessageRowProps {
  /** Author of the message; drives the avatar, display name and profile card. */
  pubkey: string;
  /**
   * Explicit author identity (mesh peers). When set, the avatar/name come from
   * this instead of a Nostr profile lookup, and the profile-preview card is
   * suppressed (there's no Nostr profile behind a mesh peer).
   */
  identityOverride?: MessageIdentity;
  /**
   * The author's pet body (a Nostr Pet declared via the pet's `agent` tag),
   * for ₿AO chat agents. When set, the header shows the pet's avatar and name
   * linked to the Pets page (where its upkeep fundraiser lives) with a paw
   * badge, instead of the bare profile display. Ignored for mesh authors.
   */
  petBody?: PetBodyInfo;
  /** Unix-seconds creation time, rendered as a short relative timestamp. */
  createdAt: number;
  /** The message body (rich content, poll, /me action, edit field, …). */
  children: ReactNode;
  /** Whether to show the spinning "sending" indicator next to the name. */
  pending?: boolean;
  /** Whether to show an "(edited)" marker next to the timestamp. */
  edited?: boolean;
  /**
   * A small badge rendered next to the author's name (after the bot pill) —
   * e.g. the DM page's "NIP-04" legacy-encryption marker. Hidden on
   * continuation rows (no header line).
   */
  nameBadge?: ReactNode;
  /** Extra controls rendered right-aligned on the header row (action toolbar). */
  actions?: ReactNode;
  /** Extra content rendered above the body (e.g. a reply-context line). */
  beforeBody?: ReactNode;
  /** Extra content rendered below the body (reactions, reply count, errors). */
  afterBody?: ReactNode;
  /**
   * Render as a continuation of the previous message from the same author:
   * hides the avatar/name/timestamp header and tightens spacing, showing only
   * a hover-revealed clock time in the avatar gutter.
   */
  continuation?: boolean;
  className?: string;
  /** Forwarded to the row container (data attrs, handlers). */
  containerProps?: React.HTMLAttributes<HTMLDivElement>;
  /**
   * Swipe-to-reply callback. When set, a swipe-LEFT gesture on touch devices
   * calls this (wired to `onReply` in ChatMessage). Ignored on desktop.
   * Leftward on purpose: a rightward swipe anywhere on the chat pane is the
   * SwipeReveal "leave room" gesture, so direction alone disambiguates intent.
   */
  onSwipeReply?: () => void;
}

/**
 * Shared presentational shell for a single chat message: a flat, Discord-style
 * row with a per-message avatar, the author's name, a relative timestamp and a
 * body slot. Used by both group chat (`ChatMessage`) and direct messages so the
 * two render identically.
 */
export const MessageRow = memo(function MessageRow({
  pubkey,
  identityOverride,
  petBody,
  createdAt,
  children,
  pending,
  edited,
  nameBadge,
  actions,
  beforeBody,
  afterBody,
  continuation,
  className,
  containerProps,
  onSwipeReply,
}: MessageRowProps) {
  // Mesh authors carry an explicit identity; skip the Nostr author/profile
  // lookups entirely for them (the pubkey is a mesh peer id, not a real key).
  const author = useAuthor(identityOverride ? undefined : pubkey);
  const metadata = author.data?.metadata;
  const scoped = useScopedIdentity(identityOverride ? undefined : pubkey, metadata);
  const displayName = identityOverride?.name ?? scoped.displayName;
  const color = identityOverride?.color ?? scoped.color;
  const label = identityOverride ? undefined : scoped.label;
  const suffix = identityOverride?.suffix;
  // Pet bodies only apply to real Nostr authors (mesh peers carry an explicit
  // identity, and there's no pet behind a mesh peer id).
  const pet = identityOverride ? undefined : petBody;

  // Swipe-to-reply: only active when `onSwipeReply` is set (touch devices).
  const swipe = useSwipeToReply(
    () => onSwipeReply?.(),
    Boolean(onSwipeReply),
  );

  // For mesh authors there's no Nostr profile to preview — render the avatar/
  // name as plain (non-interactive) elements rather than profile-card triggers.
  const avatar = (
    <Avatar shape={getAvatarShape(metadata)} className="size-10">
      <AvatarImage src={metadata?.picture} alt={displayName} />
      <AvatarFallback
        className="text-sm"
        style={color ? { backgroundColor: `${color}33`, color } : undefined}
      >
        {displayName[0]?.toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );

  return (
    <div
      {...containerProps}
      {...(onSwipeReply ? swipe.touchHandlers : undefined)}
      className={cn(
        "group relative flex items-start gap-3 px-2.5 rounded hover:bg-secondary/40 transition-colors hover:z-10 focus-within:z-10",
        continuation ? "py-0.5" : "py-1.5",
        className,
        containerProps?.className,
      )}
      style={{
        ...(onSwipeReply ? { touchAction: "pan-y" } : undefined),
        ...containerProps?.style,
      }}
    >
      {/* Swipe-to-reply: reply icon revealed at the right edge as the content
          slides left (reply is a LEFT swipe; rightward is the pane-reveal
          "leave room" gesture) */}
      {onSwipeReply && swipe.offset > 0 && (
        <div
          className="absolute right-2.5 top-1/2 -translate-y-1/2 z-0 pointer-events-none flex items-center justify-center"
          style={{
            opacity: Math.min(swipe.offset / 60, 1),
          }}
        >
          <div className="flex items-center justify-center size-9 rounded-full bg-primary/15 text-primary">
            <Reply className="size-4" />
          </div>
        </div>
      )}
      {/* Sliding content wrapper */}
      <div
        className="flex items-start gap-3 flex-1 min-w-0 relative"
        style={
          onSwipeReply && swipe.offset !== 0
            ? {
                transform: `translateX(${-swipe.offset}px)`,
                transition: swipe.dragging ? "none" : "transform 0.25s ease-out",
              }
            : undefined
        }
      >
      {continuation ? (
        <span className="shrink-0 w-10 self-stretch flex items-start justify-end pr-0.5 pt-0.5 text-[10px] leading-none text-muted-foreground/60 opacity-0 group-hover:opacity-100 transition-opacity tabular-nums select-none">
          {shortClockTime(createdAt)}
        </span>
      ) : identityOverride ? (
        <span className="shrink-0 mt-0.5">{avatar}</span>
      ) : pet ? (
        // Agent with a pet body: the pet's avatar, linked to the Pets page
        // (where the pet's upkeep fundraiser lives) instead of the profile card.
        <Link
          to="/pets"
          title={`${pet.name} — this agent's pet body. View its upkeep fundraiser.`}
          className="shrink-0 mt-0.5 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Avatar className="size-10 transition-opacity hover:opacity-90">
            {pet.picture && <AvatarImage src={pet.picture} alt={pet.name} />}
            <AvatarFallback
              className="bg-primary/20 text-primary"
              style={pet.baseColor ? { backgroundColor: `${pet.baseColor}33`, color: pet.baseColor } : undefined}
            >
              <PawPrint className="size-5" aria-hidden />
            </AvatarFallback>
          </Avatar>
        </Link>
      ) : (
        <ProfilePreviewCard pubkey={pubkey}>
          <button type="button" className="shrink-0 mt-0.5 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Avatar shape={getAvatarShape(metadata)} className="size-10 cursor-pointer transition-opacity hover:opacity-90">
              <AvatarImage src={metadata?.picture} alt={displayName} />
              <AvatarFallback className="bg-primary/20 text-primary text-sm">
                {displayName[0]?.toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </button>
        </ProfilePreviewCard>
      )}
      <div className="flex-1 min-w-0">
        {!continuation && (
          <div className="flex items-baseline gap-2">
            {identityOverride ? (
              <span
                className="text-[15px] font-semibold text-primary truncate min-w-0 inline-flex items-baseline gap-1"
                style={color ? { color } : undefined}
              >
                <span className="truncate">{displayName}</span>
                {suffix && (
                  <span className="text-[11px] font-normal text-muted-foreground/70 shrink-0">
                    #{suffix}
                  </span>
                )}
              </span>
            ) : pet ? (
              // Agent with a pet body: the pet's name + a paw badge, linked to
              // the Pets page where its upkeep fundraiser renders.
              <Link
                to="/pets"
                title={`${pet.name} — this agent's pet body. View its upkeep fundraiser.`}
                className="text-[15px] font-semibold text-primary min-w-0 inline-flex items-center gap-1.5 hover:underline focus:outline-none"
              >
                <span className="truncate">{pet.name}</span>
                <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary no-underline">
                  <PawPrint className="size-3" aria-hidden />
                  Pet
                </span>
              </Link>
            ) : (
              <ProfilePreviewCard pubkey={pubkey}>
                <button
                  type="button"
                  className="text-[15px] font-semibold text-primary truncate min-w-0 hover:underline focus:outline-none"
                  style={color ? { color } : undefined}
                >
                  {displayName}
                </button>
              </ProfilePreviewCard>
            )}
            <BotPill metadata={metadata} />
            {nameBadge}
            {label && (
              <Badge variant="secondary" className="text-[10px] font-medium shrink min-w-0 max-w-[35%]">
                <span className="truncate">{label}</span>
              </Badge>
            )}
            <span className="text-[11px] text-muted-foreground/70 shrink-0">
              {shortTimeAgo(createdAt)}
            </span>
            {edited && (
              <span className="text-[10px] text-muted-foreground/60 shrink-0" title="Edited">(edited)</span>
            )}
            {pending && (
              <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground/70" aria-label="Sending" />
            )}
          </div>
        )}
        {actions && (
          // Float the action toolbar above the top-right edge of the row rather
          // than inline on the header. Inline, a long name/title would get
          // crushed by the buttons; floating keeps the full name visible and the
          // toolbar clear of the body. Solid background + a small lift keeps it
          // legible over whatever it overlaps. On touch (no hover) it's
          // tap-revealed and stays non-interactive until the row is made active,
          // so the first tap only reveals it and a second, deliberate tap
          // engages an action (avoids fat-fingering deletes). The tap-reveal
          // guard is keyed to `touch:` (real touch), NOT a width breakpoint — a
          // narrow desktop window still hovers and must stay clickable.
          <div className={cn(
            "absolute right-2.5 z-20 flex items-center gap-0.5 touch:gap-1.5 rounded-md border bg-background/95 px-1 py-0.5 touch:px-1.5 touch:py-1 shadow-sm opacity-0 group-hover:opacity-100 group-data-[active]:opacity-100 focus-within:opacity-100 transition-opacity touch:pointer-events-none touch:group-data-[active]:pointer-events-auto",
            // Sit just above the row's top-right edge, overlapping it so it stays
            // inside the row's hover region (a fully-detached panel vanishes when
            // the pointer leaves the row to reach it). Continuation rows are
            // compact and header-less, but the offset is the same; touch gets a
            // little more lift for its larger targets.
            continuation
              ? "-top-3 touch:-top-10"
              : "-top-2.5 touch:-top-3.5",
          )}>
            {actions}
          </div>
        )}
        {continuation && (edited || pending) && (
          // Continuation rows hide the header, so surface the (edited)/sending
          // markers in the same floated slot the toolbar uses. The toolbar
          // (z-20) takes over that slot on hover/active, so hand off: show this
          // marker at rest and fade it out when the toolbar appears, so the two
          // never stack on top of each other.
          <div className="absolute right-2.5 -top-3 touch:-top-10 z-10 flex items-center gap-2 rounded-md border bg-background/95 px-1 py-0.5 shadow-sm transition-opacity pointer-events-none group-hover:opacity-0 group-data-[active]:opacity-0 group-focus-within:opacity-0">
            {edited && (
              <span className="text-[10px] text-muted-foreground/60 shrink-0" title="Edited">(edited)</span>
            )}
            {pending && (
              <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground/70" aria-label="Sending" />
            )}
          </div>
        )}
        {beforeBody}
        {children}
        {afterBody}
      </div>
      </div>
    </div>
  );
});
