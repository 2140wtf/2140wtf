/**
 * Global ₿AO command palette — press `/` (or Ctrl+K) anywhere in the app to
 * open it. Lists every command from the shared registry (src/concord-v2/lib/
 * commands.ts) grouped by category, so an agent or human always knows what is
 * at hand — global commands (login/create/join/help/…) plus community commands.
 *
 * Selecting a command runs it through `window.bao` (the in-page engine adapter)
 * and shows the JSON result inline, so the palette is a real launcher, not just
 * a help list. A command that needs an argument still shows its usage line.
 */

import { useEffect, useState } from "react";

import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { BAO_COMMANDS } from "@/concord-v2/lib/commands";

interface Entry {
  ok: boolean;
  error?: string;
  result?: unknown;
}

/** Run a command string via window.bao and return the envelope. */
async function runBao(line: string): Promise<Entry> {
  const bao = window.bao;
  if (!bao) return { ok: false, error: "window.bao not ready yet — wait a moment and retry." };
  return (await bao.cli(line)) as Entry;
}

function isEditableTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || node.isContentEditable;
}

export function GlobalCommandPalette() {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<Entry | null>(null);

  // "/" opens when not already typing in a field; Ctrl+K opens always.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === "/" && !isEditableTarget(e.target) && !open) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const run = async (line: string) => {
    setResult(null);
    const r = await runBao(line);
    setResult(r);
  };

  // Group commands by category, keeping registry order.
  const groups = new Map<string, typeof BAO_COMMANDS>();
  for (const c of BAO_COMMANDS) {
    const list = groups.get(c.category) ?? [];
    list.push(c);
    groups.set(c.category, list);
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a ₿AO command — e.g. login, join, members, help…" />
      <CommandList>
        <CommandEmpty>No commands match.</CommandEmpty>
        {result && (
          <div className="px-3 py-2 text-xs border-b border-border">
            {result.ok ? (
              <pre className="whitespace-pre-wrap text-success">{JSON.stringify(result.result, null, 2)}</pre>
            ) : (
              <pre className="whitespace-pre-wrap text-destructive">{result.error}</pre>
            )}
          </div>
        )}
        {[...groups.entries()].map(([category, cmds]) => (
          <CommandGroup key={category} heading={category.toUpperCase()}>
            {cmds.map((c) => (
              <CommandItem
                key={c.verb}
                value={c.verb}
                onSelect={() => {
                  const line = `${c.verb}${c.usage ? ` ${c.usage.replace(/<[^>]*>/g, "").replace(/\[[^\]]*\]/g, "").trim()}` : ""}`;
                  void run(line);
                }}
              >
                <span className="font-mono text-sm">{c.verb}</span>
                <span className="ml-2 truncate text-muted-foreground text-xs">{c.summary}</span>
                <span className="ml-auto shrink-0 text-[10px] uppercase text-muted-foreground/50">
                  {c.access}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
