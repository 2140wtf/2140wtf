import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { ReactNode } from "react";

interface ChannelSidebarViewProps {
  /** Primary title (server name / community name). */
  title: ReactNode;
  /** Secondary line under the title (relay host, protocol note, …). */
  subtitle?: ReactNode;
  /** Optional leading icon before the title (e.g. a shield for Concord). */
  titleIcon?: ReactNode;
  /**
   * Optional inline panel rendered directly below the header and above the
   * banner/divider (Concord's community menu). Meant to hold a
   * `CollapsibleContent` whose `CollapsibleTrigger` is the `title`, so the
   * panel expands inline (pushing the channel list down) with a height
   * animation rather than floating over the content like a popover.
   */
  titleExpansion?: ReactNode;
  /** Optional full-width banner image rendered below the header (Concord). */
  banner?: ReactNode;
  /** Optional badge shown under the header (e.g. "AUTH required"). */
  badge?: ReactNode;
  /** Tooltip/label for the add-channel action. Action hidden when omitted. */
  addChannelLabel?: string;
  onAddChannel?: () => void;
  /**
   * Whether the inline add-channel form is open. While open the "+" rotates
   * into an "×" (45°, animated) and the action reads as Cancel.
   */
  addChannelOpen?: boolean;
  /**
   * Render the add-channel "+" as a disabled placeholder (no action yet). Keeps
   * the "Channels" header row at the same height as transports that do have an
   * add action, so sidebars without one (e.g. Mesh) line up identically.
   */
  addChannelDisabled?: boolean;
  /**
   * Content rendered ABOVE the "Channels" section label (e.g. Concord's
   * "@ Mentions" / "Threads" nav items). Wrapped as its own section, so the
   * items inside stay tight together and the group is separated from the
   * "Channels" section by the standard section gap.
   */
  preChannels?: ReactNode;
  /**
   * Trailing sections rendered BELOW the "Channels" section (e.g. Buzz's
   * Forums / Direct messages / Archived groups). Each child section should be
   * its own wrapper (`<div className="space-y-0.5">…`) so it lands as a
   * gap-separated sibling in the scroll column, matching the spacing between
   * the pre-channels group and the "Channels" section.
   */
  postChannels?: ReactNode;
  /**
   * Inline content under the "Channels" label (e.g. a create-channel form).
   * Concord renders its add form here; NIP-29 leaves it empty (it uses a dialog).
   */
  channelsHeaderExtra?: ReactNode;
  /** The channel rows (NavLinks for NIP-29, selection buttons for Concord). */
  children: ReactNode;
  /** Pinned footer (NIP-29: the persistent call-bar slot + account area). */
  footer?: ReactNode;
  className?: string;
}

/**
 * Presentational channel-list shell shared by the NIP-29 `ChannelSidebar` and
 * Concord's community page: the recessed chrome plane, the server/community
 * header, the "Channels" section label + add action, the scrollable row list
 * and an optional pinned footer. The actual channel rows and data come from the
 * caller, so the two transports render an identical frame.
 */
export function ChannelSidebarView({
  title,
  subtitle,
  titleIcon,
  titleExpansion,
  banner,
  badge,
  addChannelLabel,
  onAddChannel,
  addChannelOpen,
  addChannelDisabled,
  preChannels,
  postChannels,
  channelsHeaderExtra,
  children,
  footer,
  className,
}: ChannelSidebarViewProps) {
  const addLabel = addChannelOpen ? "Cancel" : addChannelLabel;
  const addButton = (onAddChannel || addChannelDisabled) && (
    <Button
      variant="ghost"
      size="icon"
      className="size-5 touch:size-8"
      aria-label={addLabel ?? "Add channel"}
      aria-expanded={addChannelOpen}
      onClick={onAddChannel}
      disabled={!onAddChannel}
    >
      {/* A Plus rotated 45° IS an ×: one glyph, animated between the states. */}
      <Plus className={cn("size-4 transition-transform duration-200", addChannelOpen && "rotate-45")} />
    </Button>
  );

  return (
    <aside
      className={cn(
        // Chrome plane — recessed, darker than the deck, identical to the rail,
        // header and roster so they read as one frame around the bright chat.
        "relative flex flex-col w-60 shrink-0 bg-chrome",
        className,
      )}
    >
      {/* Header — aligned with the channel rows' text gutter below (container
          px-1 + row pl-4 = pl-5 here) so the grid lines up. Padding is
          symmetric (1.25rem top and bottom around the min-h-5 title line), so
          on desktop the header spans exactly 60px and the divider below sits
          flush with the bottom edge of the rail's first 48px icon (12px top
          padding + size-12) and the chat pane's floating header card (mt-3 +
          h-12). The header reaches the top screen edge on mobile, so it
          carries the status-bar safe-area inset on top of its base top padding
          (0 on desktop).

          On MOBILE a community banner (when present) fills this header block as
          its BACKGROUND — from the top screen edge down to the divider below —
          so the divider, title and "Channels" sub-header keep the exact same
          position whether or not a server/community has a banner. That keeps
          the layout from jumping vertically as you navigate between them. The
          title sits at the bottom over a scrim so it stays legible on top of
          any image. On desktop the banner is a separate block below the header
          (see below), so the header behaves normally. */}
      <div
        className={cn(
          "relative pl-3 pr-3 pb-[1.625rem] flex",
          "pt-[calc(1.5rem+var(--safe-area-inset-top,env(safe-area-inset-top,0px)))]",
          // Alignment is IDENTICAL with or without a banner so the title (and
          // therefore the divider + Channels section below) sits at the exact
          // same vertical position — the mobile banner is a pure absolute
          // background that doesn't participate in flow or alignment, so it can
          // never nudge the header down.
          titleIcon ? "items-center gap-1" : "flex-col justify-center",
        )}
      >
        {/* Mobile-only banner background (desktop uses the block below the
            header). These layers are absolutely positioned, so they don't
            affect the header's height or the title's alignment. */}
        {banner && (
          <>
            <div className="sidebar:hidden absolute inset-0 overflow-hidden">{banner}</div>
            {/* Top scrim over the status-bar safe area. The banner fills
                edge-to-edge under the (light-content) status bar; a bright image
                would otherwise wash out the white clock/battery/signal icons.
                This darkens exactly the top inset band so they stay legible. */}
            <div
              aria-hidden
              className="sidebar:hidden absolute inset-x-0 top-0 h-[calc(var(--safe-area-inset-top,env(safe-area-inset-top,0px))+0.5rem)] pointer-events-none bg-gradient-to-b from-[hsl(var(--chrome))] via-[hsl(var(--chrome)/0.7)] to-transparent"
            />
            {/* Bottom-anchored scrim so the title reads on any banner. */}
            <div
              aria-hidden
              className="sidebar:hidden absolute inset-x-0 bottom-0 h-2/3 pointer-events-none bg-gradient-to-t from-[hsl(var(--chrome))] via-[hsl(var(--chrome)/0.7)] to-transparent"
            />
          </>
        )}
        {titleIcon && <div className="relative shrink-0">{titleIcon}</div>}
        <div className="relative min-w-0">
          {/* Reserve a constant primary-line height (= the size-6 title
              icon/avatar) so the header block — and therefore the divider and
              Channels section below — sits at the exact same vertical position
              whether or not the community/server has an icon. The floor matches
              the icon height (24px) rather than the shorter text line, so a
              text-only title (e.g. a NIP-29 relay with no NIP-11 icon) reserves
              the same line as an icon'd one and centres identically instead of
              floating a hair high. The h2 stays block so `truncate` works; the
              flex wrapper only vertically centers it in the reserved line. */}
          <div className="flex items-center min-h-6">
            <h2 className="min-w-0 font-semibold truncate leading-tight tracking-wide text-sm">{title}</h2>
          </div>
          {subtitle && (
            <span className="block text-[11px] text-muted-foreground truncate leading-tight">{subtitle}</span>
          )}
          {badge}
        </div>
      </div>

      {/* Inline, height-animated expansion under the header (Concord's
          community menu). Rendered here so it pushes the banner/divider/channel
          list down rather than floating over them. */}
      {titleExpansion}

      {/* Desktop: the banner is its own block below the header (the sidebar is
          a persistent column that doesn't touch the top screen edge). */}
      {banner && <div className="hidden sidebar:block h-20 shrink-0 overflow-hidden">{banner}</div>}

      {/* Divider between the header and the channel list. */}
      <div className="mx-3 h-0.5 shrink-0 bg-chrome-divider" />

      {/* Channels. The scroll column is a set of sections (pre-channels group,
          the "Channels" list, then any trailing groups) separated by one
          consistent gap; rows WITHIN a section stay tight (space-y-0.5). */}
      <div className="flex-1 overflow-y-auto px-1 pt-[11px] pb-2 flex flex-col gap-5">
        {preChannels && <div className="space-y-0.5">{preChannels}</div>}

        <div className="space-y-0.5">
          <div className="flex items-center justify-between pl-4 pr-2 py-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Channels
            </span>
            {addLabel ? (
              <Tooltip>
                <TooltipTrigger asChild>{addButton}</TooltipTrigger>
                <TooltipContent>{addLabel}</TooltipContent>
              </Tooltip>
            ) : (
              addButton
            )}
          </div>

          {channelsHeaderExtra}
          {children}
        </div>

        {postChannels}
      </div>

      {footer}
    </aside>
  );
}
