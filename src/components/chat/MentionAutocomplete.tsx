import { nip19 } from "nostr-tools";
import { useCallback, useEffect, useRef, useState } from "react";

import { BotPill } from "@/components/BotPill";
import { EmojifiedText } from "@/components/chat/CustomEmoji";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { usePortalDropdown } from "@/hooks/usePortalDropdown";
import { useSearchProfiles, useMemberProfiles, type SearchProfile } from "@/hooks/useSearchProfiles";
import { getAvatarShape } from "@/lib/avatarShape";
import { getCaretCoordinates } from "@/lib/caretCoordinates";
import { cn } from "@/lib/utils";

interface MentionAutocompleteProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  content: string;
  onInsertMention: (params: { start: number; end: number; replacement: string }) => void;
  /**
   * When provided, restrict mention candidates to these pubkeys (the room's
   * members) instead of searching all of Nostr. Used by group chat so `@`
   * only suggests people in the room.
   */
  restrictToPubkeys?: string[];
}

/**
 * Detects `@query` at the cursor position in a textarea and shows
 * a profile autocomplete dropdown. On selection, replaces `@query`
 * with `nostr:npub1...` in the content (NIP-27).
 */
export function MentionAutocomplete({
  textareaRef,
  content,
  onInsertMention,
  restrictToPubkeys,
}: MentionAutocompleteProps) {
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionStart, setMentionStart] = useState(-1);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  // Bottom-anchored so a short list hugs the composer instead of floating.
  const [dropdownPos, setDropdownPos] = useState<{ bottom: number; left: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const handleClose = useCallback(() => setIsOpen(false), []);
  const { renderPortal } = usePortalDropdown({
    textareaRef,
    isOpen,
    onClose: handleClose,
    dropdownHeight: 240, // must match max-h-[240px] below
  });

  const restricted = Array.isArray(restrictToPubkeys);
  const { data: searchProfiles } = useSearchProfiles(isOpen && !restricted ? mentionQuery : "");
  const memberProfiles = useMemberProfiles(restrictToPubkeys ?? [], isOpen ? mentionQuery : "");
  const profiles = restricted ? memberProfiles : searchProfiles;

  // Detect @mention query at cursor.
  const detectMention = useCallback((text?: string, cursorPos?: number) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const cursor = cursorPos ?? textarea.selectionStart;
    const value = text ?? textarea.value;

    // Walk back from cursor to find an @ that starts a mention
    let atPos = -1;
    for (let i = cursor - 1; i >= 0; i--) {
      const ch = value[i];
      if (ch === " " || ch === "\n" || ch === "\t") break;
      if (ch === "@") {
        if (i === 0 || /\s/.test(value[i - 1])) {
          atPos = i;
        }
        break;
      }
    }

    if (atPos === -1) {
      setIsOpen(false);
      setMentionQuery("");
      setMentionStart(-1);
      return;
    }

    const query = value.slice(atPos + 1, cursor);

    if (query.length > 50) {
      setIsOpen(false);
      setMentionQuery("");
      setMentionStart(-1);
      return;
    }

    setMentionQuery(query);
    setMentionStart(atPos);
    setIsOpen(true);
    setSelectedIndex(0);

    // Anchor the menu's bottom just above the composer's top edge so a short
    // list hugs the composer; track the caret horizontally.
    const caret = getCaretCoordinates(textarea, atPos);
    const rect = textarea.getBoundingClientRect();
    setDropdownPos({
      bottom: window.innerHeight - rect.top + 6,
      left: Math.max(8, Math.min(rect.left + caret.left, window.innerWidth - 280 - 8)),
    });
  }, [textareaRef]);

  // Listen for input/cursor changes on the textarea element.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const handleInput = () => {
      detectMention(textarea.value, textarea.selectionStart);
    };
    const handleClick = () => detectMention();
    const handleKeyUp = (e: KeyboardEvent) => {
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
        detectMention();
      }
    };

    textarea.addEventListener("input", handleInput);
    textarea.addEventListener("click", handleClick);
    textarea.addEventListener("keyup", handleKeyUp);

    return () => {
      textarea.removeEventListener("input", handleInput);
      textarea.removeEventListener("click", handleClick);
      textarea.removeEventListener("keyup", handleKeyUp);
    };
  }, [textareaRef, detectMention, content]);

  // Re-detect when content changes externally (e.g. emoji insertion).
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    detectMention(content, textarea.selectionStart);
  }, [content, detectMention, textareaRef]);

  const selectProfile = useCallback((profile: SearchProfile) => {
    const npub = nip19.npubEncode(profile.pubkey);
    const replacement = `nostr:${npub} `;
    const cursor = textareaRef.current?.selectionStart ?? mentionStart + mentionQuery.length + 1;

    onInsertMention({
      start: mentionStart,
      end: cursor,
      replacement,
    });

    setIsOpen(false);
    setMentionQuery("");
    setMentionStart(-1);
  }, [mentionStart, mentionQuery, textareaRef, onInsertMention]);

  // Handle keyboard navigation within the dropdown
  useEffect(() => {
    if (!isOpen || !profiles || profiles.length === 0) return;

    const textarea = textareaRef.current;
    if (!textarea) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) => (prev < (profiles?.length ?? 1) - 1 ? prev + 1 : 0));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : (profiles?.length ?? 1) - 1));
          break;
        case "Enter":
        case "Tab":
          if (profiles && profiles.length > 0) {
            e.preventDefault();
            e.stopImmediatePropagation();
            selectProfile(profiles[selectedIndex]);
          }
          break;
        case "Escape":
          e.preventDefault();
          setIsOpen(false);
          break;
      }
    };

    textarea.addEventListener("keydown", handleKeyDown);
    return () => textarea.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, profiles, selectedIndex, textareaRef, selectProfile]);

  // Scroll selected item into view
  useEffect(() => {
    if (selectedIndex >= 0 && listRef.current) {
      const items = listRef.current.querySelectorAll("[data-mention-item]");
      items[selectedIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  if (!isOpen || !dropdownPos || !profiles || profiles.length === 0) {
    return null;
  }

  const dropdown = (
    <div
      data-autocomplete-dropdown
      className="fixed z-[300] w-[280px] max-w-[calc(100vw-1rem)] rounded-xl border border-border bg-popover shadow-lg overflow-hidden animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2 duration-150 pointer-events-auto"
      style={{ bottom: dropdownPos.bottom, left: dropdownPos.left }}
    >
      <div ref={listRef} className="max-h-[240px] overflow-y-auto py-1">
        {profiles.map((profile, index) => (
          <MentionItem
            key={profile.pubkey}
            profile={profile}
            isSelected={index === selectedIndex}
            onSelect={() => selectProfile(profile)}
          />
        ))}
      </div>
    </div>
  );

  // Portal to document.body so the dropdown escapes overflow clipping.
  return renderPortal(dropdown, document.body);
}

function MentionItem({
  profile,
  isSelected,
  onSelect,
}: {
  profile: SearchProfile;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const { metadata, pubkey } = profile;
  const displayName = metadata.name || metadata.display_name || "Anonymous";
  const identifier = metadata.nip05 || nip19.npubEncode(pubkey);

  return (
    <button
      data-mention-item
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2 text-left transition-colors cursor-pointer",
        isSelected ? "bg-accent text-accent-foreground" : "hover:bg-secondary/60",
      )}
      // Select on pointer-down so it fires reliably on touch (a
      // mousedown-preventDefault can swallow the synthetic click); preventDefault
      // keeps the composer focused.
      onPointerDown={(e) => {
        e.preventDefault();
        onSelect();
      }}
    >
      <Avatar shape={getAvatarShape(metadata)} className="size-8 shrink-0">
        <AvatarImage src={metadata.picture} alt={displayName} />
        <AvatarFallback className="bg-primary/20 text-primary text-xs">
          {displayName[0]?.toUpperCase() || "?"}
        </AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="font-semibold text-sm truncate">
            <EmojifiedText tags={profile.event.tags}>{displayName}</EmojifiedText>
          </div>
          <BotPill metadata={metadata} />
        </div>
        <div className="text-xs text-muted-foreground truncate font-mono text-[11px]">
          {identifier}
        </div>
      </div>
    </button>
  );
}
