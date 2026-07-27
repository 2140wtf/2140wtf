import { cn } from '@/lib/utils';

/** Wallet amount presets — ₿AO-flavored ladder: 100, 1k, 2140, 10k, 21.4k, 100k, 214k. */
const WALLET_SATS_PRESETS = [100, 1000, 2140, 10000, 21400, 100000, 214000];

function presetLabel(sats: number): string {
  if (sats >= 10000) {
    const k = sats / 1000;
    // 10k / 21.4k / 100k / 214k — one decimal only when it isn't a round number.
    return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
  }
  return sats.toLocaleString('en-US');
}

interface SatsPresetPillsProps {
  /** Current raw input value (string state) — used to highlight the matching pill. */
  value: string;
  onSelect: (sats: number) => void;
  disabled?: boolean;
}

/**
 * One-tap sat amount presets for the wallet's amount inputs. Compact row of
 * pills that fills the input; the active pill highlights when the current
 * value matches exactly.
 */
export function SatsPresetPills({ value, onSelect, disabled }: SatsPresetPillsProps) {
  const current = Number(value);
  return (
    <div className='flex flex-wrap gap-1.5'>
      {WALLET_SATS_PRESETS.map((sats) => (
        <button
          key={sats}
          type='button'
          disabled={disabled}
          onClick={() => onSelect(sats)}
          className={cn(
            'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
            'hover:bg-primary/10 hover:text-primary disabled:opacity-50',
            current === sats
              ? 'bg-primary/10 text-primary border-primary/40'
              : 'text-muted-foreground',
          )}
        >
          {presetLabel(sats)}
        </button>
      ))}
    </div>
  );
}
