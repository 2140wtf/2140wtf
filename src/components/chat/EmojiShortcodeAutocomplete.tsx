import data from "@emoji-mart/data";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CustomEmojiImg } from "@/components/chat/CustomEmoji";
import { getCaretCoordinates } from "@/lib/caretCoordinates";
import { usePortalDropdown } from "@/hooks/usePortalDropdown";
import { useCustomEmojis, type CustomEmoji } from "@/hooks/useCustomEmojis";
import { cn } from "@/lib/utils";

interface EmojiData {
  id: string;
  name: string;
  keywords?: string[];
  skins: Array<{ native: string }>;
}

interface EmojiShortcodeAutocompleteProps {
  /** The textarea or single-line input the autocomplete is attached to. */
  textareaRef: React.RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
  content: string;
  onInsertEmoji: (params: { start: number; end: number; replacement: string }) => void;
  /** Called when a custom NIP-30 emoji is selected so the caller can track the emoji tag. */
  onCustomEmojiInsert?: (emoji: CustomEmoji) => void;
}

const MAX_RESULTS = 8;

/** A result entry that can be either a native emoji or a custom NIP-30 emoji. */
interface EmojiResult {
  id: string;
  name: string;
  /** For native emojis */
  native?: string;
  /** For custom emojis */
  customUrl?: string;
  /** Search score (lower = better match) */
  score: number;
}

/** Build a flat searchable list of emojis from emoji-mart data. */
function buildEmojiIndex(): Array<{ id: string; name: string; native: string; keywords: string[] }> {
  const emojis = (data as { emojis: Record<string, EmojiData> }).emojis;
  const aliases = (data as { aliases: Record<string, string> }).aliases;

  const results: Array<{ id: string; name: string; native: string; keywords: string[] }> = [];

  for (const [id, emoji] of Object.entries(emojis)) {
    const native = emoji.skins?.[0]?.native;
    if (!native) continue;

    const aliasNames: string[] = [];
    for (const [alias, target] of Object.entries(aliases)) {
      if (target === id) {
        aliasNames.push(alias);
      }
    }

    results.push({
      id,
      name: emoji.name,
      native,
      keywords: [...(emoji.keywords || []), ...aliasNames],
    });
  }

  return results;
}

/** Lazily initialized emoji index. */
let emojiIndex: ReturnType<typeof buildEmojiIndex> | null = null;
function getEmojiIndex() {
  if (!emojiIndex) {
    emojiIndex = buildEmojiIndex();
  }
  return emojiIndex;
}

/** Search emojis by shortcode query (includes both native and custom emojis). */
function searchEmojis(query: string, customEmojis: CustomEmoji[]): EmojiResult[] {
  if (!query) return [];
  const q = query.toLowerCase();
  const results: EmojiResult[] = [];

  // Custom emojis get priority
  for (const emoji of customEmojis) {
    const sc = emoji.shortcode.toLowerCase();
    if (sc === q) {
      results.push({ id: `custom:${emoji.shortcode}`, name: emoji.shortcode, customUrl: emoji.url, score: -1 });
    } else if (sc.startsWith(q)) {
      results.push({ id: `custom:${emoji.shortcode}`, name: emoji.shortcode, customUrl: emoji.url, score: 0 });
    } else if (sc.includes(q)) {
      results.push({ id: `custom:${emoji.shortcode}`, name: emoji.shortcode, customUrl: emoji.url, score: 1 });
    }
  }

  const index = getEmojiIndex();
  for (const emoji of index) {
    if (emoji.id === q) {
      results.push({ id: emoji.id, name: emoji.name, native: emoji.native, score: 2 });
    } else if (emoji.id.startsWith(q)) {
      results.push({ id: emoji.id, name: emoji.name, native: emoji.native, score: 3 });
    } else if (emoji.id.includes(q)) {
      results.push({ id: emoji.id, name: emoji.name, native: emoji.native, score: 4 });
    } else if (emoji.name.toLowerCase().startsWith(q)) {
      results.push({ id: emoji.id, name: emoji.name, native: emoji.native, score: 5 });
    } else if (emoji.name.toLowerCase().includes(q)) {
      results.push({ id: emoji.id, name: emoji.name, native: emoji.native, score: 6 });
    } else if (emoji.keywords?.some((kw: string) => kw.startsWith(q) || kw.includes(q))) {
      results.push({ id: emoji.id, name: emoji.name, native: emoji.native, score: 7 });
    }
  }

  results.sort((a, b) => a.score - b.score);
  return results.slice(0, MAX_RESULTS);
}

/**
 * Detects `:shortcode` at the cursor position in a textarea and shows
 * an emoji autocomplete dropdown. On selection, replaces `:shortcode`
 * with the native emoji character or `:shortcode:` for custom emojis.
 */
export function EmojiShortcodeAutocomplete({
  textareaRef,
  content,
  onInsertEmoji,
  onCustomEmojiInsert,
}: EmojiShortcodeAutocompleteProps) {
  const { emojis: customEmojis } = useCustomEmojis();

  const [query, setQuery] = useState("");
  const [colonStart, setColonStart] = useState(-1);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ bottom: number; left: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const handleClose = useCallback(() => setIsOpen(false), []);
  const { computeBottomPosition, renderPortal } = usePortalDropdown({
    textareaRef,
    isOpen,
    onClose: handleClose,
    dropdownHeight: 280, // must match max-h-[280px] below
  });

  const results = useMemo(() => searchEmojis(query, customEmojis), [query, customEmojis]);

  // Detect :shortcode query at cursor
  const detectShortcode = useCallback((text?: string, cursorPos?: number | null) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const value = text ?? textarea.value;
    const cursor = cursorPos ?? textarea.selectionStart ?? value.length;

    let colonPos = -1;
    for (let i = cursor - 1; i >= 0; i--) {
      const ch = value[i];
      if (ch === " " || ch === "\n" || ch === "\t") break;
      if (ch === ":" && i < cursor - 1) {
        if (i === 0 || /[\s]/.test(value[i - 1])) {
          colonPos = i;
        }
        break;
      }
    }

    if (colonPos === -1) {
      setIsOpen(false);
      setQuery("");
      setColonStart(-1);
      return;
    }

    const q = value.slice(colonPos + 1, cursor);

    if (q.length < 2 || q.length > 32 || q.includes(":")) {
      setIsOpen(false);
      setQuery("");
      setColonStart(-1);
      return;
    }

    setQuery(q);
    setColonStart(colonPos);
    setIsOpen(true);
    setSelectedIndex(0);

    const coords = getCaretCoordinates(textarea, colonPos);
    setDropdownPos(computeBottomPosition(coords));
  }, [textareaRef, computeBottomPosition]);

  // Listen for input/cursor changes on the textarea element
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const handleInput = () => {
      detectShortcode(textarea.value, textarea.selectionStart);
    };
    const handleClick = () => detectShortcode();
    const handleKeyUp = (e: KeyboardEvent) => {
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
        detectShortcode();
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
  }, [textareaRef, detectShortcode, content]);

  // Re-detect when content changes externally
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    detectShortcode(content, textarea.selectionStart);
  }, [content, detectShortcode, textareaRef]);

  const selectEmoji = useCallback((emoji: EmojiResult) => {
    const textarea = textareaRef.current;
    const cursor = textarea?.selectionStart ?? colonStart + query.length + 1;

    if (emoji.customUrl) {
      // Custom emoji: replace with `:shortcode: ` and track the emoji tag
      const shortcode = emoji.name;
      onInsertEmoji({
        start: colonStart,
        end: cursor,
        replacement: `:${shortcode}: `,
      });
      const entry = customEmojis.find((e) => e.shortcode === shortcode);
      if (entry && onCustomEmojiInsert) {
        onCustomEmojiInsert(entry);
      }
    } else if (emoji.native) {
      onInsertEmoji({
        start: colonStart,
        end: cursor,
        replacement: emoji.native,
      });
    }

    setIsOpen(false);
    setQuery("");
    setColonStart(-1);
  }, [colonStart, query, textareaRef, onInsertEmoji, onCustomEmojiInsert, customEmojis]);

  // Handle keyboard navigation within the dropdown
  useEffect(() => {
    if (!isOpen || results.length === 0) return;

    const textarea = textareaRef.current;
    if (!textarea) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1));
          break;
        case "Enter":
        case "Tab":
          if (results.length > 0) {
            e.preventDefault();
            e.stopImmediatePropagation();
            selectEmoji(results[selectedIndex]);
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
  }, [isOpen, results, selectedIndex, textareaRef, selectEmoji]);

  // Scroll selected item into view
  useEffect(() => {
    if (selectedIndex >= 0 && listRef.current) {
      const items = listRef.current.querySelectorAll("[data-emoji-item]");
      items[selectedIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  if (!isOpen || !dropdownPos || results.length === 0) {
    return null;
  }

  const dropdown = (
    <div
      data-autocomplete-dropdown
      className="fixed z-[300] w-[280px] max-w-[calc(100vw-1rem)] rounded-xl border border-border bg-popover shadow-lg overflow-hidden animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2 duration-150 pointer-events-auto"
      style={{ bottom: dropdownPos.bottom, left: dropdownPos.left }}
    >
      <div ref={listRef} className="max-h-[280px] overflow-y-auto py-1">
        {results.map((emoji, index) => (
          <button
            key={emoji.id}
            data-emoji-item
            className={cn(
              "w-full flex items-center gap-3 px-3 py-1.5 text-left text-popover-foreground transition-colors cursor-pointer",
              index === selectedIndex ? "bg-secondary/60" : "hover:bg-secondary/60",
            )}
            // Select on pointer-down so it fires reliably on touch (a
            // mousedown-preventDefault can swallow the synthetic click);
            // preventDefault keeps the composer focused.
            onPointerDown={(e) => {
              e.preventDefault();
              selectEmoji(emoji);
            }}
          >
            {emoji.customUrl ? (
              <CustomEmojiImg
                name={emoji.name}
                url={emoji.customUrl}
                className="size-5 object-contain shrink-0"
              />
            ) : (
              <span className="text-xl leading-none shrink-0">{emoji.native}</span>
            )}
            <span className="text-sm truncate">
              :{emoji.id.replace("custom:", "")}:
            </span>
          </button>
        ))}
      </div>
    </div>
  );

  return renderPortal(dropdown, document.body);
}
