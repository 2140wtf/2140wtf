/**
 * BaoCommandTerminal - the "/" command palette for BAO Fund.
 *
 * Only commands that apply to this project are wired here. Some overlap
 * with the BAO agent engine (work, chat) and are marked pending until
 * those components land. Newsprint-styled, keyboard-first.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import '../../theme/newspaperTheme.css';

export type FundCommandId =
  | 'campaigns'
  | 'agents'
  | 'playground'
  | 'ledger'
  | 'wallet'
  | 'create'
  | 'pledge'
  | 'attest'
  | 'work'
  | 'chat'
  | 'help';

export interface FundCommand {
  id: FundCommandId;
  label: string;
  description: string;
  /** Whether the action is live or pending a future component. */
  ready: boolean;
}

export const FUND_COMMANDS: FundCommand[] = [
  { id: 'help', label: '/help', description: 'List available commands', ready: true },
  { id: 'campaigns', label: '/campaigns', description: 'Go to the campaigns view', ready: true },
  { id: 'agents', label: '/agents', description: 'Fund an AI agent (real mainnet Cashu)', ready: true },
  { id: 'playground', label: '/testnet', description: 'Testnet rails - testnet4 / Liquid, no-value coins', ready: true },
  { id: 'ledger', label: '/ledger', description: 'Go to the contribution ledger', ready: true },
  { id: 'wallet', label: '/wallet', description: 'Go to the wallet (non-custodial)', ready: true },
  { id: 'create', label: '/create', description: 'Create a playground campaign (free, no sats needed)', ready: true },
  { id: 'pledge', label: '/pledge', description: 'Fund the first open campaign (testnet)', ready: true },
  { id: 'attest', label: '/attest', description: 'Release an unlocked milestone', ready: true },
  { id: 'work', label: '/work', description: 'List funded work for agents (agent engine)', ready: false },
  { id: 'chat', label: '/chat', description: 'Community chat (NIP-104, pending)', ready: false },
];

export function BaoCommandTerminal({
  onNavigate,
  onRun,
}: {
  onNavigate: (tab: 'campaigns' | 'agents' | 'playground' | 'ledger' | 'wallet') => void;
  onRun: (cmd: FundCommand) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
      if (e.key === '/' && !open && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setQuery('');
        setCursor(0);
        setOpen(true);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Focus the input whenever the palette opens. No state writes here -
  // cursor is already reset by the keyboard handler that opens it.
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^\//, '');
    const base = FUND_COMMANDS;
    if (!q) return base;
    return base.filter((c) => c.label.includes(q) || c.description.toLowerCase().includes(q));
  }, [query]);

  const run = (cmd: FundCommand) => {
    setOpen(false);
    setQuery('');
    if (cmd.id === 'campaigns' || cmd.id === 'agents' || cmd.id === 'playground' || cmd.id === 'ledger' || cmd.id === 'wallet') {
      onNavigate(cmd.id);
    }
    onRun(cmd);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.max(0, Math.min(c + 1, filtered.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter' && filtered[cursor]) {
      e.preventDefault();
      run(filtered[cursor]);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Command palette">
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(26,26,26,0.35)' }}
        onClick={() => setOpen(false)}
      />
      <div
        className="relative mx-auto mt-16 w-[min(92vw,36rem)] border"
        style={{ background: 'var(--np-paper)', borderColor: 'var(--np-ink)', boxShadow: 'var(--np-shadow)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center gap-2 border-b px-3 py-2"
          style={{ borderColor: 'var(--np-rule)', fontFamily: 'var(--np-font-mono)' }}
        >
          <span style={{ color: 'var(--np-accent)' }}>₿</span>
          <input
            ref={inputRef}
            value={'/' + query}
            onChange={(e) => {
              setQuery(e.target.value.replace(/^\//, ''));
              setCursor(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="type a command…"
            className="w-full bg-transparent text-sm outline-none"
            style={{ color: 'var(--np-ink)', fontFamily: 'var(--np-font-mono)' }}
          />
          <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>
            esc
          </span>
        </div>
        <ul className="max-h-72 overflow-y-auto py-1">
          {filtered.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                onMouseEnter={() => setCursor(i)}
                onClick={() => run(c)}
                className="flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left"
                style={{
                  background: i === cursor ? 'var(--np-accent-dim)' : 'transparent',
                }}
              >
                <span
                  className="text-[13px]"
                  style={{ fontFamily: 'var(--np-font-mono)', color: 'var(--np-ink)' }}
                >
                  {c.label}
                </span>
                <span className="truncate text-[11px]" style={{ color: 'var(--np-muted)' }}>
                  {c.description}
                  {!c.ready && (
                    <span
                      className="ml-2 uppercase tracking-wider"
                      style={{ color: 'var(--np-accent-2)', fontSize: 9 }}
                    >
                      pending
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="px-3 py-2 text-sm" style={{ color: 'var(--np-muted)' }}>
              No matching command.
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
