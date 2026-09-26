import React from 'react';
import { getEventHash } from 'nostr-tools/pure';
import { Bot, Hammer, Loader2, ShieldX } from 'lucide-react';
import { useAuth } from '../../auth/useAuth';

/** Default NIP-13-style leading-zero-bit difficulty for the local gate. */
export const AGENT_GATE_DIFFICULTY = 20;

/** Attempt budget scales with difficulty: 16x the expected work. Kept in
 *  safe-integer range so an impossible difficulty ABORTS instead of looping
 *  forever (2**256 * 16 overflows past Number.MAX_SAFE_INTEGER - the budget
 *  check would never trip). Cap is 40 bits of expected work (~1.1e13), far
 *  beyond any legitimate UI friction level but aborting in hours, not
 *  heat-death-of-universe: at ~1e6 H/s a 40-bit budget is ~4 months of
 *  grinding, and anything above 24 bits already exceeds human patience -
 *  callers surface the budget-exhausted error instead of hanging. */
export function powAttemptBudget(difficulty: number): number {
  if (!Number.isInteger(difficulty) || difficulty < 0 || difficulty > 40) {
    return 0; // impossible/unreasonable - caller must abort immediately
  }
  return 16 * 2 ** difficulty;
}

/** NIP-13-style leading-zero-bit count over a lowercase hex event id. */
export function countLeadingZeroBits(idHex: string): number {
  let bits = 0;
  for (const char of idHex) {
    const value = parseInt(char, 16);
    if (value === 0) {
      bits += 4;
      continue;
    }
    bits += Math.clz32(value) - 28;
    break;
  }
  return bits;
}

/**
 * Grind a NIP-13-style commitment until its event id carries the required
 * leading zero bits. The result is never published - it exists only as
 * local UI friction, so a plain unsigned event template is enough.
 */
export function grindLocalPow(pubkey: string, ms: number, difficulty: number): string {
  const budget = powAttemptBudget(difficulty);
  if (budget <= 0) {
    throw new Error(`proof-of-work difficulty ${difficulty} is out of range (0–64) - refusing to grind`);
  }
  for (let counter = 0; ; counter++) {
    if (counter > budget) {
      throw new Error(`proof-of-work grind exhausted the attempt budget at difficulty ${difficulty}`);
    }
    const id = getEventHash({
      kind: 1,
      content: 'join',
      tags: [['nonce', String(counter), String(difficulty)]],
      pubkey,
      created_at: Math.floor(ms / 1000),
    });
    if (countLeadingZeroBits(id) >= difficulty) return id;
  }
}

function passedKey(pubkey: string): string {
  return `baofund:agent-gate-passed:${pubkey}`;
}

export function loadPassed(pubkey: string): boolean {
  try {
    return localStorage.getItem(passedKey(pubkey)) === '1';
  } catch {
    return false;
  }
}

export function savePassed(pubkey: string): void {
  try {
    localStorage.setItem(passedKey(pubkey), '1');
  } catch {
    // non-persistent - the check just runs again next visit
  }
}

interface AgentGateCheckProps {
  children: React.ReactNode;
  title?: string;
  description?: string;
}

/**
 * Client-side proof-of-work check for agent-oriented controls.
 *
 * Ported from 2140wtf's bao-fund AgentGateCheck (audit-hardened): the same
 * NIP-13-style local proof-of-work as an agent-only ₿AO join. Unlike a
 * community join, this result is not published or verified by an authority:
 * it is bypassable UI friction, never an authorization boundary.
 */
export function AgentGateCheck({ children, title = 'Client-side agent check', description }: AgentGateCheckProps): React.ReactElement {
  const { pubkey } = useAuth();
  const [passedPubkey, setPassedPubkey] = React.useState<string | null>(() =>
    pubkey && loadPassed(pubkey) ? pubkey : null,
  );
  const [grinding, setGrinding] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const passed = !!pubkey && (passedPubkey === pubkey || loadPassed(pubkey));

  if (passed) return <>{children}</>;

  const runCheck = async () => {
    if (!pubkey) {
      setError('Log in first - the agent check needs an identity to bind to.');
      return;
    }
    setError(null);
    setGrinding(true);
    // Yield once so the busy state paints before the CPU-bound grind begins.
    await new Promise((resolve) => setTimeout(resolve, 50));
    try {
      grindLocalPow(pubkey, Date.now(), AGENT_GATE_DIFFICULTY);
      savePassed(pubkey);
      setPassedPubkey(pubkey);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The proof-of-work could not be completed.');
    } finally {
      setGrinding(false);
    }
  };

  return (
    <div className="rounded border border-dashed p-4" style={{ borderColor: 'var(--np-accent)' }}>
      <div className="flex items-start gap-3">
        <div className="shrink-0 p-1">
          <Bot size={18} style={{ color: 'var(--np-accent)' }} />
        </div>
        <div className="space-y-1">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: 'var(--np-ink)' }}>
            {title}
            <ShieldX size={13} style={{ color: 'var(--np-muted)' }} />
          </h3>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--np-muted)' }}>
            {description ?? (
              <>Agent-oriented controls are for autonomous agents. Complete the local proof-of-work anti-spam check to reveal them. Anyone may fund the public requests without passing it. This client-side check is not identity verification or secure server authorization.</>
            )}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void runCheck()}
          disabled={grinding}
          className="flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs disabled:opacity-50"
          style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
        >
          {grinding ? (
            <>
              <Loader2 size={13} className="animate-spin" />
              Running agent check…
            </>
          ) : (
            <>
              <Hammer size={13} />
              Run agent check
            </>
          )}
        </button>
        {error && (
          <span className="text-[10px]" style={{ color: 'var(--np-error, #b91c1c)' }}>
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
