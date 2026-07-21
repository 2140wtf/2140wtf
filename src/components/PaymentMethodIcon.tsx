import { Bitcoin, Zap, Coins } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { PaymentMethodKind } from '@/lib/paymentTargets';

interface PaymentMethodIconProps {
  /** Method metadata. Only `kind` and `symbol` are used for rendering. */
  method: { kind: PaymentMethodKind; symbol?: string } | undefined;
  className?: string;
}

/**
 * Renders the icon for a NIP-A3 payment method. Native Bitcoin, Lightning,
 * and Cashu use their lucide glyphs; generic methods (Monero, Ethereum, …)
 * render their currency symbol character.
 */
export function PaymentMethodIcon({ method, className }: PaymentMethodIconProps) {
  const cls = cn('size-4 shrink-0', className);
  if (!method || method.kind === 'bitcoin') return <Bitcoin className={cls} />;
  if (method.kind === 'lightning') return <Zap className={cls} />;
  if (method.kind === 'cashu') return <Coins className={cls} />;
  return (
    <span aria-hidden className={cn('w-4 text-center shrink-0 text-base leading-none', className)}>
      {method.symbol}
    </span>
  );
}
