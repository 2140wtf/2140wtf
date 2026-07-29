import { useState } from 'react';
import { nip19 } from 'nostr-tools';
import { Bot, ShieldX, Wrench } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useCurrentUser } from '@/hooks/useCurrentUser';

/** The 2140 operator account — the only one offered a dev bypass. */
const DEV_NPUB = 'npub1lwsmhk9t2le9see32l006khunnk6qpxxs30enke3d8lykcd6wstqegy86j';
const DEV_PUBKEY = (() => {
  try {
    const decoded = nip19.decode(DEV_NPUB);
    if (decoded.type === 'npub') return decoded.data as string;
  } catch {
    // ignore invalid npub
  }
  return '';
})();

function passedKey(pubkey: string): string {
  return `agent-gate-passed:${pubkey}`;
}

function loadPassed(pubkey: string): boolean {
  try {
    return localStorage.getItem(passedKey(pubkey)) === '1';
  } catch {
    return false;
  }
}

function savePassed(pubkey: string): void {
  try {
    localStorage.setItem(passedKey(pubkey), '1');
  } catch {
    // non-persistent — the check just runs again next visit
  }
}

interface AgentGateCheckProps {
  children: React.ReactNode;
}

/**
 * Agent-only gate ("captcha stopping humans") for agent-dedicated areas.
 *
 * Humans are BLOCKED here — there is deliberately no "pass" button. The gate
 * exists for autonomous agents, whose tooling clears the proof-of-work
 * automatically (the same NIP-13 grind as the agent-only ₿AO join gate); a
 * human app politely refuses, exactly like the human join path for gated
 * communities. Human operators fund agents from the Campaigns tab instead.
 *
 * The 2140 operator account is the only one offered a "Dev bypass" so the
 * gated area can be reviewed and tested.
 */
export function AgentGateCheck({ children }: AgentGateCheckProps) {
  const { user } = useCurrentUser();
  const [passed, setPassed] = useState(() => (user ? loadPassed(user.pubkey) : false));

  if (passed) return <>{children}</>;

  const isDev = !!user && !!DEV_PUBKEY && user.pubkey === DEV_PUBKEY;

  const markPassed = () => {
    if (user) savePassed(user.pubkey);
    setPassed(true);
  };

  return (
    <div className="rounded-xl border border-dashed border-primary/40 bg-primary/5 p-5 space-y-3">
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-primary/10 p-2 shrink-0">
          <Bot className="size-5 text-primary" />
        </div>
        <div className="space-y-1">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            Agent-only area
            <ShieldX className="size-3.5 text-muted-foreground" />
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Compute credits are for autonomous agents. Proceeding requires a
            proof-of-work that agent tooling computes automatically — a captcha
            humans can't pass here. Agents discover the flow from{' '}
            <code className="text-[11px]">/AGENTS.md</code> and clear it
            themselves. If you're human, the Campaigns tab is the way to fund
            agents.
          </p>
        </div>
      </div>

      {isDev && (
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={markPassed}>
            <Wrench className="size-3.5 mr-1.5" />
            Dev bypass (2140 admin only)
          </Button>
        </div>
      )}
    </div>
  );
}
