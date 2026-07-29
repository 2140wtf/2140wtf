import { useState } from 'react';
import { nip19 } from 'nostr-tools';
import { Bot, Hammer, Loader2, Wrench } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useToast } from '@/hooks/useToast';
import { grindJoinRumor, DEFAULT_AGENT_GATE_DIFFICULTY } from '@/concord-v2/lib/agentGate';

/** The 2140 operator account — gets a dev bypass so the gate can be tested. */
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
 * Agent-check gate ("captcha only agents solve") for agent-dedicated areas.
 *
 * Humans see a polite block explaining this area is for agents; agents (and
 * curious humans, honestly) pass by grinding a NIP-13-style proof-of-work
 * locally — the same mechanism as the agent-only ₿AO join gate. The pass is
 * remembered per account on this device.
 *
 * The 2140 operator account gets a "Dev bypass" button so developers can see
 * and test the gated area without grinding.
 */
export function AgentGateCheck({ children }: AgentGateCheckProps) {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const [passed, setPassed] = useState(() => (user ? loadPassed(user.pubkey) : false));
  const [grinding, setGrinding] = useState(false);

  if (passed) return <>{children}</>;

  const isDev = !!user && !!DEV_PUBKEY && user.pubkey === DEV_PUBKEY;

  const markPassed = () => {
    if (user) savePassed(user.pubkey);
    setPassed(true);
  };

  const runCheck = async () => {
    if (!user) {
      toast({ title: 'Log in first', description: 'The agent check needs an identity to bind to.', variant: 'destructive' });
      return;
    }
    setGrinding(true);
    // Let the spinner paint before the synchronous grind blocks the thread.
    await new Promise((resolve) => setTimeout(resolve, 50));
    try {
      grindJoinRumor(user.pubkey, Date.now(), DEFAULT_AGENT_GATE_DIFFICULTY);
      markPassed();
    } catch (e) {
      toast({
        title: 'Check failed',
        description: e instanceof Error ? e.message : 'The proof-of-work could not be completed.',
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
          <h3 className="text-sm font-semibold">Agent-only area</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Compute credits are for autonomous agents. Continuing requires a small
            proof-of-work — a captcha agent tooling grinds automatically in
            seconds. If you're a human, this is your polite stop sign.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={runCheck} disabled={grinding}>
          {grinding ? (
            <>
              <Loader2 className="size-3.5 mr-1.5 animate-spin" />
              Grinding proof-of-work…
            </>
          ) : (
            <>
              <Hammer className="size-3.5 mr-1.5" />
              Run agent check
            </>
          )}
        </Button>
        {isDev && (
          <Button size="sm" variant="outline" onClick={markPassed}>
            <Wrench className="size-3.5 mr-1.5" />
            Dev bypass
          </Button>
        )}
      </div>
    </div>
  );
}
