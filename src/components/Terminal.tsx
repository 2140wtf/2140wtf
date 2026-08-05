/**
 * In-page ₿AO agent terminal.
 *
 * A native-as-possible command surface — the agent types or scripts commands
 * and sees structured output. The same surface the user calls via
 * <code>window.bao.cli(text)</code> at the JS console.
 *
 * The component keeps a scrollback of prompt/response lines and supports:
 *   - up/down arrows to recall previous commands
 *   - "clear" to clear the scrollback (does NOT touch identities)
 *   - "help" routed through the same dispatcher as everything else
 *   - hint text when a command fails that suggests the next move
 *
 * Output is rendered both as JSON (the literal envelope from the dispatcher
 * — useful for agents scraping their own page) and as a human-readable fold
 * so a person reading the screen can parse it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { parseCommandLine } from '@/lib/baoTermDispatch';

interface Entry {
  prompt: string;
  result: { ok: true; result: unknown } | { ok: false; error: string };
  key: number;
}

const PROMPT_HISTORY_KEY = '2140:bao-term:history';

function loadHistory(): string[] {
  try {
    return JSON.parse(localStorage.getItem(PROMPT_HISTORY_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

function saveHistory(items: string[]): void {
  try {
    localStorage.setItem(PROMPT_HISTORY_KEY, JSON.stringify(items.slice(-200)));
  } catch { /* quotas / private mode */ }
}

function prettyResult(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object') {
    if (result instanceof Error) return result.message;
    return JSON.stringify(result, null, 2);
  }
  return String(result);
}

export function Terminal(): React.JSX.Element {
  const [history, setHistory] = useState<string[]>(() => loadHistory());
  const [historyIdx, setHistoryIdx] = useState<number>(-1);
  const [draft, setDraft] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const entryKey = useRef(0);

  // Window.bao may not be ready on first paint (the React tree mounts the
  // dispatcher after the first render; WindowBaoMount runs in an effect).
  // Wait for it.
  const [baoReady, setBaoReady] = useState(typeof window !== 'undefined' && !!window.bao);
  useEffect(() => {
    if (baoReady) return;
    const t = setInterval(() => {
      if (window.bao) {
        setBaoReady(true);
        clearInterval(t);
      }
    }, 100);
    return () => clearInterval(t);
  }, [baoReady]);

  // Auto-scroll to bottom on new entries / busy toggle.
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [entries, busy]);

  const submit = useCallback(async (text: string) => {
    if (!text.trim()) return;
    const next = [...history.filter((h) => h !== text), text].slice(-200);
    setHistory(next);
    saveHistory(next);
    setHistoryIdx(-1);
    setDraft('');
    setBusy(true);
    let result: Entry['result'];
    try {
      if (!window.bao) {
        result = { ok: false, error: 'window.bao not ready yet — wait a moment and retry.' };
      } else {
        result = (await window.bao.cli(text)) as Entry['result'];
      }
    } catch (e) {
      result = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    entryKey.current += 1;
    setEntries((prev) => [...prev, { prompt: text, result, key: entryKey.current }]);
    setBusy(false);
  }, [history]);

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submit(draft);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length === 0) return;
      const idx = historyIdx === -1 ? history.length - 1 : Math.max(0, historyIdx - 1);
      setHistoryIdx(idx);
      setDraft(history[idx] ?? '');
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (history.length === 0 || historyIdx === -1) return;
      const idx = historyIdx + 1;
      if (idx >= history.length) {
        setHistoryIdx(-1);
        setDraft('');
      } else {
        setHistoryIdx(idx);
        setDraft(history[idx] ?? '');
      }
      return;
    }
    if (e.key === 'l' && (e.ctrlKey || e.metaKey)) {
      // Ctrl/Cmd-L: clear the scrollback (does NOT touch identities).
      e.preventDefault();
      setEntries([]);
    }
  };

  const preview = parseCommandLine(draft);
  const previewError = 'error' in preview ? preview.error : null;

  return (
    <div className="border rounded-lg overflow-hidden bg-background shadow-sm">
      <div
        ref={scrollRef}
        className="font-mono text-xs leading-relaxed p-3 h-80 overflow-y-auto bg-zinc-950 text-zinc-100"
        aria-live="polite"
      >
        {entries.length === 0 ? (
          <p className="text-zinc-500">
            Type <code className="text-zinc-300">help</code> to list commands,
            <code className="text-zinc-300"> create --name "…" --as owner</code> to start a ₿AO,
            or <code className="text-zinc-300">{`join <inviteURL> --as alice`}</code> to enter one.
          </p>
        ) : (
          <div className="space-y-2">
            {entries.map((entry) => (
              <div key={entry.key} className="space-y-1">
                <div className="flex gap-2">
                  <span className="text-zinc-500 select-none">❯</span>
                  <span className="text-zinc-300 break-all whitespace-pre-wrap">{entry.prompt}</span>
                </div>
                <div className={entry.result.ok ? 'text-emerald-500' : 'text-rose-400'}>
                  {entry.result.ok
                    ? prettyResult(entry.result.result)
                    : <><span className="font-semibold">error:</span> {entry.result.error}{' '}
                       <span className="text-zinc-500">(try help, identities, or read --limit 5)</span></>}
                </div>
              </div>
            ))}
            {busy && <div className="text-zinc-500 animate-pulse">…</div>}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 p-2 border-t bg-zinc-900 text-zinc-100">
        <span className="text-zinc-500 select-none">❯</span>
        <input
          autoFocus
          spellCheck={false}
          autoComplete="off"
          aria-label="Terminal input"
          className="flex-1 bg-transparent font-mono text-sm outline-none placeholder:text-zinc-600"
          value={draft}
          disabled={!baoReady}
          placeholder={baoReady ? 'type a command · Enter to run · ↑/↓ for history · Ctrl-L to clear' : 'waiting for window.bao to mount…'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
        />
      </div>
      {previewError && draft && (
        <div className="px-3 py-1 text-[10px] bg-amber-950 text-amber-300 border-t border-amber-900">
          parse: {previewError}
        </div>
      )}
    </div>
  );
}
