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
          {' '}— 2-of-3 multisig, nobody can be rugged
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <p>
          Your stake is locked to <span className="font-medium text-foreground">three keys</span> — yours,
          your opponent's, and the ₿AO escrow operator's — and moving it takes{' '}
          <span className="font-medium text-foreground">any two</span> of the three signatures.
        </p>
        <ul className="list-disc space-y-1 pl-4">
          <li>
            <span className="font-medium text-foreground">The operator can never take your sats.</span>{' '}
            It holds one key of three. When the battle ends it only <em>co-signs</em> the winner's
            claim — the funds never pass through the operator's wallet.
          </li>
          <li>
            <span className="font-medium text-foreground">Your opponent can't take them either.</span>{' '}
            One key alone moves nothing, win or lose.
          </li>
          <li>
            <span className="font-medium text-foreground">Abandoned battle? Refund is automatic.</span>{' '}
            If the battle never finishes, your own key alone reclaims your exact stake after{' '}
            {REFUND_HOURS} hours — no operator, no opponent needed.
          </li>
          <li>
            <span className="font-medium text-foreground">Disputes need the operator + one honest player.</span>{' '}
            The operator signs only against a cryptographically signed outcome it can verify.
          </li>
        </ul>
        <p className="border-t border-border pt-2">
          Honest limits: the operator <em>colluding with one player</em> could steal the pot — that is the
          residual trust the operator stakes its public reputation on (bonded and replicated operators are
          on the roadmap). And like all ecash, the <em>mint</em> remains the custodian of the underlying sats —
          escrow removes operator custody, not mint custody.
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}
