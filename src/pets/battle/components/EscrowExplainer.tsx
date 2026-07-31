import { ShieldCheck } from 'lucide-react';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { MULTISIG_REFUND_PERIOD_SECONDS } from '@/lib/cashu/escrowMultisig';

const REFUND_HOURS = Math.round(MULTISIG_REFUND_PERIOD_SECONDS / 3600);

/**
 * "How ₿AO escrow works" — the trust-model explainer shown wherever real sats
 * are locked into the 2-of-3 multisig escrow. Keep the copy honest: the
 * operator is NOT trustless, it is non-custodial. The residual risks
 * (operator+party collusion, mint custody) are stated plainly.
 */
export function EscrowExplainer({ className }: { className?: string }) {
  return (
    <Collapsible className={className}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-left text-xs text-muted-foreground hover:bg-accent/50 transition-colors">
        <ShieldCheck className="size-4 shrink-0 text-primary" />
        <span>
          <span className="font-medium text-foreground">How ₿AO escrow protects your sats</span>
          {' '}— 2140 can never touch them, and neither can your opponent
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <p>
          When you and your opponent stake sats on a battle, the pot is locked so that no one —
          not you, not your opponent, not 2140 — can move it alone. Unlocking always takes{' '}
          <span className="font-medium text-foreground">two of the three keys</span>: yours, your
          opponent's, and 2140's escrow key.
        </p>
        <ul className="list-disc space-y-1 pl-4">
          <li>
            <span className="font-medium text-foreground">2140 holds no access to your funds.</span>{' '}
            2140 runs the escrow for one reason: so two strangers can play for sats without having
            to trust each other — a neutral referee both sides can rely on. Its single key can never
            move anything by itself, and your sats never pass through a 2140 wallet.
          </li>
          <li>
            <span className="font-medium text-foreground">The result is pushed by the players — and settles automatically.</span>{' '}
            When the battle ends, each app privately reports the outcome. If both reports agree,
            the escrow releases the pot to the winner right away. Nobody at 2140 approves or decides
            anything, and nobody can award themselves the win.
          </li>
          <li>
            <span className="font-medium text-foreground">Game crashed or connection dropped? You both get your contribution back in {REFUND_HOURS} hours.</span>{' '}
            The refund is automatic — a rule baked into the lock itself: after {REFUND_HOURS} hours
            each player takes back their exact stake, with no approval needed and no one able to
            block it. The {REFUND_HOURS}-hour wait exists on purpose: it gives either side time to
            contest a wrong result before the money moves.
          </li>
          <li>
            <span className="font-medium text-foreground">Disagreement means refunds, not theft.</span>{' '}
            If the two reports conflict, the escrow signs nothing and both stakes come back after
            the same {REFUND_HOURS} hours. Cheating gains nothing.
          </li>
        </ul>
        <p className="border-t border-border pt-2">
          Honest limits: if 2140 ever secretly teamed up with one player, the two of them together
          could steal the pot — that is the trust 2140 stakes its public name on (a community-run
          escrow is on the roadmap). And like all ecash, the mint that issued your sats still backs
          them — this escrow removes 2140's custody, not the mint's.
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}
