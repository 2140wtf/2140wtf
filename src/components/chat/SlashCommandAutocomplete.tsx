import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuthor } from "@/hooks/useAuthor";
import { usePortalDropdown } from "@/hooks/usePortalDropdown";
import { matchSlashCommands, type SlashCapability, type SlashCommand } from "@/lib/slashCommands";
import { cn } from "@/lib/utils";

import type { BotCommandEntry } from "@/lib/botCommands";

interface SlashCommandAutocompleteProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  content: string;
  canModerate: boolean;
  /** Composer capabilities; commands needing an unsupported one are hidden. */
  capabilities?: ReadonlySet<SlashCapability>;
  /**
   * Optional extra filter on which commands the menu offers (on top of the
   * built-in moderation/capability gates). Used by surfaces that support only a
   * subset — e.g. the Bluetooth mesh, which has no polls/threads/moderation.
   */
  commandFilter?: (command: SlashCommand) => boolean;
  /** Replace the command word `/query` with `/<name> ` (keeps the menu intent). */
  onInsertCommand: (params: { start: number; end: number; replacement: string }) => void;
  /** Run a command immediately (for argument-less commands picked from the menu). */
  onRunCommand: (command: SlashCommand) => void;

  /**
   * Commands published by the bots in this conversation, from their `kind:10304`
   * manifests. Omitted on surfaces with no bot discovery (the mesh), which then
   * behave exactly as before.
   */
  botEntries?: BotCommandEntry[];
  /** Bots present, whether or not they publish a manifest — drives the loading copy. */
  botCount?: number;
  /** A manifest lookup is in flight and no bot commands are known yet. */
  botsLoading?: boolean;
  /** Recently used bot commands, most recent first, as `<botHex>:<name>` keys. */
  botRecents?: string[];
  /** Pick a bot command: run it now if it takes no arguments, else collect them. */
  onRunBotCommand?: (entry: BotCommandEntry) => void;
}

/** A selectable row. Section headers are not rows and never take focus. */
type Row =
  | { type: "local"; command: SlashCommand }
  | { type: "bot"; entry: BotCommandEntry };

interface Section {
  key: string;
  /** A bot's pubkey renders its avatar + name as the header. */
  bot?: string;
  /** A plain text header (the recents group). */
  label?: string;
  rows: Row[];
}

/**
 * Argument names shown on a row before the rest collapse into a `+N`. A command
 * can declare eight; spelling them all out pushes the row past the menu's width,
 * and the row is a chooser, not a signature. The full list is one keystroke away
 * in the argument fields.
 */
const MAX_VISIBLE_ARGS = 2;

const rowKey = (row: Row): string =>
  row.type === "local" ? `local:${row.command.name}` : `bot:${row.entry.bot}:${row.entry.command.name}`;

/** A bot's avatar + display name, resolved from its profile. */
function BotIdentity({ pubkey, avatarOnly }: { pubkey: string; avatarOnly?: boolean }) {
  const author = useAuthor(pubkey);
  const name = author.data?.metadata?.name ?? `${pubkey.slice(0, 8)}…`;
  const image = author.data?.metadata?.picture;
  return (
    <>
      <Avatar className="size-4 shrink-0">
        <AvatarImage src={image} alt="" />
        <AvatarFallback className="text-[8px]">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      {!avatarOnly && <span className="truncate">{name}</span>}
    </>
  );
}

/**
 * Detects a leading `/command` at the very start of an empty-ish composer and
 * shows a command palette. Only triggers when the message begins with `/` and
 * the first token (the command word) is still being typed — so it never
 * interferes with URLs, file paths, or mid-message slashes.
 *
 * The palette lists this app's own commands first, then a section per bot in the
 * conversation carrying the commands that bot declares. Two bots may declare the
 * same command name, so a bot command is always identified by (bot, name) rather
 * than name alone.
 */
export function SlashCommandAutocomplete({
  textareaRef,
  content,
  canModerate,
  capabilities,
  commandFilter,
  onInsertCommand,
  onRunCommand,
  botEntries,
  botCount = 0,
  botsLoading = false,
  botRecents,
  onRunBotCommand,
}: SlashCommandAutocompleteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  // Bottom-anchored so the menu hugs the top of the composer and grows upward;
  // a short list sits right against the composer instead of floating with a gap.
  const [dropdownPos, setDropdownPos] = useState<{ bottom: number; left: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const handleClose = useCallback(() => setIsOpen(false), []);
  const { renderPortal } = usePortalDropdown({
    textareaRef,
    isOpen,
    onClose: handleClose,
    dropdownHeight: 260,
  });

  const sections = useMemo<Section[]>(() => {
    if (!isOpen) return [];
    const out: Section[] = [];

    // Substring match, prefix matches hoisted, manifest order kept within a tier:
    // a bot's own ordering is meaningful, so it is preserved rather than sorted.
    const q = query.toLowerCase();
    const matched = (botEntries ?? []).filter((e) => e.command.name.includes(q));
    const ranked = [
      ...matched.filter((e) => e.command.name.startsWith(q)),
      ...matched.filter((e) => !e.command.name.startsWith(q)),
    ];

    // Recently used leads: the command you keep reaching for should be the first
    // thing under the cursor, ahead of the built-ins and every bot's catalog.
    // Two bots' `/roll` are different commands, so each row wears its owner's
    // face to tell them apart.
    const recentRows: Row[] = [];
    for (const key of botRecents ?? []) {
      const sep = key.indexOf(":");
      const bot = key.slice(0, sep);
      const name = key.slice(sep + 1);
      const hit = ranked.find((e) => e.bot === bot && e.command.name === name);
      if (hit) recentRows.push({ type: "bot", entry: hit });
    }
    if (recentRows.length > 0) {
      out.push({ key: "recents", label: "Recently used", rows: recentRows });
    }

    const base = matchSlashCommands(query, canModerate, capabilities);
    const local = commandFilter ? base.filter(commandFilter) : base;
    if (local.length > 0) {
      out.push({
        key: "local",
        // Headed only once something can sit above it; on a surface with no bots
        // this is the whole menu and needs no label.
        label: recentRows.length > 0 || ranked.length > 0 ? "Built-in" : undefined,
        rows: local.map((command) => ({ type: "local", command })),
      });
    }

    const byBot = new Map<string, Row[]>();
    for (const entry of ranked) {
      const rows = byBot.get(entry.bot) ?? [];
      rows.push({ type: "bot", entry });
      byBot.set(entry.bot, rows);
    }
    for (const [bot, rows] of byBot) {
      out.push({ key: `bot:${bot}`, bot, rows });
    }

    return out;
  }, [isOpen, query, canModerate, capabilities, commandFilter, botEntries, botRecents]);

  const rows = useMemo(() => sections.flatMap((s) => s.rows), [sections]);

  // Say that bots are still resolving rather than showing a false empty: a bot's
  // commands landing a beat later would otherwise look like the menu lying.
  //
  // Only once we know a bot is actually there, though. A room with none would
  // otherwise put this menu on screen for every `/`-leading message — an emote, a
  // path, a typo — with nothing in it to pick, and swallow the Enter that was
  // meant to send.
  const showLoading = isOpen && botsLoading && botCount > 0 && (botEntries?.length ?? 0) === 0;

  // The row list can shrink underneath a stable draft (a manifest resolving, a
  // bot leaving), so the cursor must never be left pointing past the end.
  useEffect(() => {
    setSelectedIndex((prev) => (prev >= rows.length ? Math.max(rows.length - 1, 0) : prev));
  }, [rows.length]);

  const detect = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const value = textarea.value;

    // Only when the whole message is a command word being typed: starts with
    // "/" and no whitespace yet (once a space is typed we're entering args).
    const match = value.match(/^\/([\w-]*)$/);
    if (!match) {
      setIsOpen(false);
      return;
    }

    setQuery(match[1]);
    setSelectedIndex(0);
    setIsOpen(true);

    // Anchor the menu's bottom just above the composer's top edge.
    const rect = textarea.getBoundingClientRect();
    setDropdownPos({
      bottom: window.innerHeight - rect.top + 6,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 320 - 8)),
    });
  }, [textareaRef]);

  useEffect(() => {
    detect();
  }, [content, detect]);

  const selectRow = useCallback((row: Row) => {
    setIsOpen(false);
    if (row.type === "bot") {
      onRunBotCommand?.(row.entry);
      return;
    }
    const command = row.command;
    // Argument-less commands run immediately on pick; others insert "/name "
    // so the user can type the target/text next.
    if (command.runsOnSelect) {
      onRunCommand(command);
      return;
    }
    const textarea = textareaRef.current;
    const end = textarea?.value.length ?? query.length + 1;
    onInsertCommand({ start: 0, end, replacement: `/${command.name} ` });
  }, [textareaRef, query, onInsertCommand, onRunCommand, onRunBotCommand]);

  useEffect(() => {
    if (!isOpen || (rows.length === 0 && !showLoading)) return;
    const textarea = textareaRef.current;
    if (!textarea) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          if (rows.length === 0) return;
          e.preventDefault();
          setSelectedIndex((prev) => (prev < rows.length - 1 ? prev + 1 : 0));
          break;
        case "ArrowUp":
          if (rows.length === 0) return;
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : rows.length - 1));
          break;
        case "Enter":
        case "Tab": {
          // Never eat a key we cannot act on: with no row under the cursor this
          // is an ordinary message and Enter belongs to the composer.
          const row = rows[selectedIndex];
          if (!row) return;
          e.preventDefault();
          e.stopImmediatePropagation();
          selectRow(row);
          break;
        }
        case "Escape":
          e.preventDefault();
          setIsOpen(false);
          break;
      }
    };

    textarea.addEventListener("keydown", handleKeyDown);
    return () => textarea.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, rows, selectedIndex, textareaRef, selectRow, showLoading]);

  useEffect(() => {
    if (selectedIndex >= 0 && listRef.current) {
      const items = listRef.current.querySelectorAll("[data-slash-item]");
      items[selectedIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  if (!isOpen || !dropdownPos || (rows.length === 0 && !showLoading)) return null;

  let flatIndex = -1;

  const dropdown = (
    <div
      data-autocomplete-dropdown
      className="fixed z-[300] w-[320px] max-w-[calc(100vw-1rem)] rounded-xl border border-border bg-popover shadow-lg overflow-hidden animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2 duration-150 pointer-events-auto"
      style={{ bottom: dropdownPos.bottom, left: dropdownPos.left }}
    >
      {/* No padding on the TOP edge: a scroll container's padding insets the
          rectangle a sticky child is constrained to, so `top-0` would park each
          header just below the border and leave a slit for the rows to scroll
          through. The headers carry their own `pt-2` for spacing at rest. */}
      <div ref={listRef} className="max-h-[260px] overflow-y-auto overflow-x-hidden pb-1">
        {sections.map((section) => (
          <div key={section.key}>
            {(section.bot || section.label) && (
              // Sticky within its own section, so the header of whatever you are
              // scrolled into stays pinned at the top of the list and is then
              // pushed out by the next section's — you always know whose command
              // you are looking at. Opaque, or the rows would scroll through it.
              <div className="sticky top-0 z-10 flex items-center gap-1.5 bg-popover px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {section.bot ? <BotIdentity pubkey={section.bot} /> : section.label}
              </div>
            )}
            {section.rows.map((row) => {
              flatIndex += 1;
              const index = flatIndex;
              const isBot = row.type === "bot";
              const command = isBot ? row.entry.command : row.command;
              const args = isBot ? row.entry.command.args : [];
              return (
                <button
                  key={rowKey(row)}
                  data-slash-item
                  className={cn(
                    // scroll-mt clears the sticky header: without it, arrowing to
                    // a row at the top of the viewport parks it underneath.
                    "w-full flex items-baseline gap-2 scroll-mt-8 px-3 py-2 text-left transition-colors cursor-pointer",
                    index === selectedIndex ? "bg-accent text-accent-foreground" : "hover:bg-secondary/60",
                  )}
                  // Select on pointer-down (not click): preventDefault keeps the
                  // composer focused, and acting on pointer-down fires reliably on
                  // touch, where a mousedown-preventDefault can swallow the synthetic
                  // click (the menu would just close and nothing would prefill).
                  onPointerDown={(e) => {
                    e.preventDefault();
                    selectRow(row);
                  }}
                >
                  {section.key === "recents" && row.type === "bot" && (
                    <span className="self-center">
                      <BotIdentity pubkey={row.entry.bot} avatarOnly />
                    </span>
                  )}
                  <span className="font-mono text-sm font-semibold shrink-0">
                    {!isBot && row.command.usage ? row.command.usage : `/${command.name}`}
                  </span>
                  {args.slice(0, MAX_VISIBLE_ARGS).map((a) => (
                    <span
                      key={a.name}
                      className={cn("font-mono text-xs shrink-0", a.required ? "text-foreground/70" : "text-muted-foreground/60")}
                    >
                      {a.name}
                    </span>
                  ))}
                  {args.length > MAX_VISIBLE_ARGS && (
                    // A command with a long signature would otherwise push the row
                    // wider than the menu. The count is enough to say "there is
                    // more here"; picking it opens a field per argument anyway.
                    <span
                      className="shrink-0 font-mono text-xs text-muted-foreground/60"
                      title={args.slice(MAX_VISIBLE_ARGS).map((a) => a.name).join(" ")}
                    >
                      +{args.length - MAX_VISIBLE_ARGS}
                    </span>
                  )}
                  {/* Absorbs the rest of the row and truncates, so no row can ever
                      widen the menu (min-w-0 lets a flex item shrink below its
                      content, which `truncate` needs to bite). */}
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {command.description}
                  </span>
                </button>
              );
            })}
          </div>
        ))}

        {showLoading && (
          <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
            <span className="size-3 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" />
            {botCount > 0 ? `Loading ${botCount} bot${botCount === 1 ? "" : "s"}…` : "Looking for bots…"}
          </div>
        )}
      </div>
    </div>
  );

  return renderPortal(dropdown, document.body);
}
