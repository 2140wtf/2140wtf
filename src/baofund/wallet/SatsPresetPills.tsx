import React from 'react';

/** Wallet amount presets - the ₿AO ladder shared by the 2140 wallet UX:
 *  100, 1k, 2140, 10k, 21.4k, 100k, 214k. */
export const WALLET_SATS_PRESETS = [100, 1000, 2140, 10000, 21400, 100000, 214000] as const;

/** `2140` -> "2,140"; `21400` -> "21.4k". */
export function presetLabel(sats: number): string {
  if (sats >= 10000) {
    const k = sats / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
  }
  return sats.toLocaleString('en-US');
}

interface SatsPresetPillsProps {
  /** Current raw input value (string state) - highlights the matching pill. */
  value: string;
  onSelect: (sats: number) => void;
  disabled?: boolean;
}

/**
 * One-tap sat amount presets for the wallet's amount inputs. Fills the input;
 * the active pill highlights when the current value matches exactly.
 */
export function SatsPresetPills({ value, onSelect, disabled }: SatsPresetPillsProps): React.ReactElement {
  const current = Number(value);
  return (
    <div className="flex flex-wrap gap-1.5" data-testid="sats-preset-pills">
      {WALLET_SATS_PRESETS.map((sats) => {
        const active = current === sats;
        return (
          <button
            key={sats}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(sats)}
            aria-pressed={active}
            data-testid={`sats-preset-${sats}`}
            className="rounded-full border px-2.5 py-1 text-xs disabled:opacity-50"
            style={{
              borderColor: active ? 'var(--np-accent)' : 'var(--np-rule)',
              color: active ? 'var(--np-accent)' : 'var(--np-muted)',
              fontFamily: 'var(--np-font-mono)',
            }}
          >
            {presetLabel(sats)}
          </button>
        );
      })}
    </div>
  );
}

export default SatsPresetPills;
