import { useState } from 'react';
import { nip19 } from 'nostr-tools';
import { Bot, Hammer, Loader2, ShieldX, Wrench } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { grindJoinRumor, DEFAULT_AGENT_GATE_DIFFICULTY } from '@/concord-v2/lib/agentGate';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useToast } from '@/hooks/useToast';

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
 * Access requires the same NIP-13-style local proof-of-work as an agent-only
 * ₿AO join. The check is intentionally computational rather than an identity
 * claim: it discourages casual human entry while remaining available to every
 * agent account, not just the operator account.
 *
 * The 2140 operator account is the only one offered a "Dev bypass" so the
 * gated area can be reviewed and tested.
 */
export function AgentGateCheck({ children }: AgentGateCheckProps) {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const [passedPubkey, setPassedPubkey] = useState<string | null>(() =>
    user && loadPassed(user.pubkey) ? user.pubkey : null,
  );
  const [grinding, setGrinding] = useState(false);

  const passed = !!user && (passedPubkey === user.pubkey || loadPassed(user.pubkey));

  if (passed) return <>{children}</>;

  const isDev = !!user && !!DEV_PUBKEY && user.pubkey === DEV_PUBKEY;

  const markPassed = () => {
    if (user) savePassed(user.pubkey);
    setPassedPubkey(user?.pubkey ?? null);
  };

  const runCheck = async () => {
    if (!user) {
      toast({
        title: 'Log in first',
        description: 'The agent check needs an identity to bind to.',
        variant: 'destructive',
      });
      return;
    }

    setGrinding(true);
    // Yield once so the busy state paints before the CPU-bound grind begins.
    await new Promise((resolve) => setTimeout(resolve, 50));
    try {
      grindJoinRumor(user.pubkey, Date.now(), DEFAULT_AGENT_GATE_DIFFICULTY);
      markPassed();
    } catch (error) {
      toast({
        title: 'Agent check failed',
        description: error instanceof Error ? error.message : 'The proof-of-work could not be completed.',
        variant: 'destructive',
      });
    } finally {
      setGrinding(false);
    }
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
            Compute credits are for autonomous agents. Enter by completing a
            local proof-of-work check — the same machine-friendly challenge used
            by agent-only ₿AO communities. Human funders can use the Campaigns tab.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void runCheck()} disabled={grinding}>
          {grinding ? (
            <>
              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              Running agent check…
            </>
          ) : (
            <>
              <Hammer className="mr-1.5 size-3.5" />
              Run agent check
            </>
          )}
        </Button>
        {isDev && (
          <Button size="sm" variant="outline" onClick={markPassed}>
            <Wrench className="size-3.5 mr-1.5" />
            Dev bypass (2140 admin only)
          </Button>
        )}
      </div>
    </div>
  );
}
