import { Bell, BellOff, AtSign, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import type { NotifLevel } from "@/hooks/useNotifLevels";

/**
 * Discord-style per-conversation notification-level picker, rendered as a
 * context-menu submenu (All messages / Only @mentions / Nothing). Applies
 * to EVERY delivery path — foreground toasts/OS notifications, the Android
 * persistent service, and Web Push — because all of them read the resolved
 * level from `useNotifLevels`.
 *
 * `level` is the currently RESOLVED level (after the channel → community →
 * global cascade), so the active row reflects what actually happens even when
 * the value is inherited. Selecting a row writes an explicit override for this
 * scope; selecting the row that already matches an inherited value still writes
 * the override (harmless, and makes the choice sticky).
 *
 * Concord V1 channels are all-or-nothing (mentions can't be detected in a
 * sealed message), so pass `allowMentions={false}` to hide the mentions row.
 */
export function NotifLevelMenu(props: {
  /** Menu label, e.g. "Notifications" or "Channel notifications". */
  label?: string;
  /** The resolved level to reflect as selected. */
  level: NotifLevel;
  /** Called with the chosen level. */
  onChange: (level: NotifLevel) => void;
  /** Whether to offer the "Only @mentions" row (false for Concord V1). */
  allowMentions?: boolean;
}) {
  const { label = "Notifications", level, onChange, allowMentions = true } = props;
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        {level === "nothing" ? (
          <BellOff className="mr-2 size-4" />
        ) : level === "mentions" ? (
          <AtSign className="mr-2 size-4" />
        ) : (
          <Bell className="mr-2 size-4" />
        )}
        {label}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="w-48">
        <ContextMenuRadioGroup value={level} onValueChange={(v) => onChange(v as NotifLevel)}>
          <ContextMenuRadioItem value="all">
            <Bell className="mr-2 size-4" /> All messages
          </ContextMenuRadioItem>
          {allowMentions && (
            <ContextMenuRadioItem value="mentions">
              <AtSign className="mr-2 size-4" /> Only @mentions
            </ContextMenuRadioItem>
          )}
          <ContextMenuRadioItem value="nothing">
            <BellOff className="mr-2 size-4" /> Nothing
          </ContextMenuRadioItem>
        </ContextMenuRadioGroup>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

/** A tiny inline indicator (used in non-context-menu surfaces if needed). */
export function NotifLevelIcon({ level }: { level: NotifLevel }) {
  if (level === "nothing") return <BellOff className="size-4" />;
  if (level === "mentions") return <AtSign className="size-4" />;
  return <Check className="size-4" />;
}

/**
 * Standalone dropdown-button variant of the level picker for surfaces that
 * aren't context menus (e.g. a conversation header). Renders its own bell
 * trigger reflecting the current level.
 */
export function NotifLevelDropdown(props: {
  level: NotifLevel;
  onChange: (level: NotifLevel) => void;
  allowMentions?: boolean;
  /** Accessible label for the trigger, e.g. "Notification settings for Alice". */
  ariaLabel?: string;
  className?: string;
}) {
  const { level, onChange, allowMentions = true, ariaLabel = "Notifications", className } = props;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={ariaLabel}
          className={
            className ??
            "size-8 touch:size-11 shrink-0 text-muted-foreground hover:text-foreground"
          }
        >
          {level === "nothing" ? (
            <BellOff className="size-4" />
          ) : level === "mentions" ? (
            <AtSign className="size-4" />
          ) : (
            <Bell className="size-4" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuRadioGroup value={level} onValueChange={(v) => onChange(v as NotifLevel)}>
          <DropdownMenuRadioItem value="all">
            <Bell className="mr-2 size-4" /> All messages
          </DropdownMenuRadioItem>
          {allowMentions && (
            <DropdownMenuRadioItem value="mentions">
              <AtSign className="mr-2 size-4" /> Only @mentions
            </DropdownMenuRadioItem>
          )}
          <DropdownMenuRadioItem value="nothing">
            <BellOff className="mr-2 size-4" /> Nothing
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
