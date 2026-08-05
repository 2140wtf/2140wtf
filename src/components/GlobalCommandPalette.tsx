/**
 * Global ₿AO command palette — press `/` (or Ctrl+K) anywhere to open it.
 *
 * Lists every command from the shared registry grouped by category, so an
 * agent or human always knows what is at hand. It's a real launcher:
 *   - selecting a no-argument command runs it through `window.bao` and shows
 *     the JSON result inline;
 *   - selecting an argument command fills the input with `<verb> ` so you type
 *     the args and press Enter to run;
 *   - typing any full command line and pressing Enter also runs it.
 */

import { useEffect, useState } from "react";

import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { BAO_COMMANDS } from "@/concord-v2/lib/commands";

/** Commands that need no arguments and run immediately on select. */
const NO_ARG_VERBS = new Set(["help", "logout", "identities", "members", "whoami", "dissolve", "wallet", "project"]);

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
  const [draft, setDraft] = useState("");
  const [result, setResult] = useState<Entry | null>(null);
  const [running, setRunning] = useState(false);

  // "/" opens when not typing in a field; Ctrl+K opens always.
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
    const trimmed = line.trim();
    if (!trimmed || running) return;
    setRunning(true);
    setResult(null);
    try {
      setResult(await runBao(trimmed));
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setRunning(false);
    }
  };

  const groups = new Map<string, typeof BAO_COMMANDS>();
  for (const c of BAO_COMMANDS) {
    const list = groups.get(c.category) ?? [];
    list.push(c);
    groups.set(c.category, list);
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        value={draft}
        onValueChange={setDraft}
        placeholder='Type a ₿AO command — e.g. "login alice" or "join <invite>" — then Enter'
        onKeyDown={(e: React.KeyboardEvent) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void run(draft);
          }
        }}
      />
      <CommandList>
        <CommandEmpty>No commands match.</CommandEmpty>
        {running && <div className="px-3 py-2 text-xs text-muted-foreground">Running…</div>}
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
                  if (NO_ARG_VERBS.has(c.verb)) {
                    void run(c.verb);
                    return;
                  }
                  setDraft(`${c.verb} `);
                }}
              >
                <span className="font-mono text-sm">{c.verb}</span>
                <span className="ml-2 truncate text-muted-foreground text-xs">{c.summary}</span>
                <span className="ml-auto shrink-0 text-[10px] uppercase text-muted-foreground/50">{c.access}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
