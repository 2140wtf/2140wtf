/**
 * BaoWalletNetworkToggle — switches the BAO Wallet between the custodial
 * private-signet demo ledger and the non-custodial Testnet rails
 * (Bitcoin testnet4 + Liquid testnet).
 */
import { cn } from '@/lib/utils';

export type BaoWalletNetwork = 'demo' | 'testnet';

export interface BaoWalletNetworkToggleProps {
  value: BaoWalletNetwork;
  onChange: (value: BaoWalletNetwork) => void;
}

const OPTIONS = [
  { id: 'demo', label: 'Demo · signet' },
  { id: 'testnet', label: 'Testnet' },
] as const;

export function BaoWalletNetworkToggle({ value, onChange }: BaoWalletNetworkToggleProps) {
  return (
    <div
      className='inline-flex rounded-lg border border-border p-0.5'
      role='tablist'
      aria-label='BAO wallet network'
    >
      {OPTIONS.map((opt) => (
        <button
          key={opt.id}
          type='button'
          role='tab'
          aria-selected={value === opt.id}
          onClick={() => onChange(opt.id)}
          className={cn(
            'rounded-md px-3 py-1 text-xs font-medium transition-colors',
            value === opt.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export default BaoWalletNetworkToggle;
