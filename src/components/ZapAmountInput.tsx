import { useMemo, useRef, useState } from 'react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { satsToUSD } from '@/lib/bitcoin';
import type { CurrencyDisplay } from '@/contexts/AppContext';

interface ZapAmountInputProps {
  /** Satoshi amount (canonical value used for the actual payment). */
  amountSats: number | string;
  onChange: (amountSats: number | string) => void;
  btcPrice?: number;
  currencyDisplay: CurrencyDisplay;
  presets?: number[];
  disabled?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
  autoFocus?: boolean;
}

const DEFAULT_PRESETS = [100, 500, 1000, 5000, 10000];

function formatSats(value: number): string {
  return value.toLocaleString('en-US');
}

function parseInput(value: string): number | string {
  if (value === '') return '';
  const normalized = value.replace(/,/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : value;
}

/**
 * Satoshi-first amount editor with a currency-aware display.
 *
 * - When the user's currency preference is `sats`, the main input is in sats
 *   and a USD equivalent is shown in the corner (when a BTC price is available).
 * - When the preference is `usd`, the main input is in USD and the satoshi
 *   equivalent is shown in the corner.
 */
export function ZapAmountInput({
  amountSats,
  onChange,
  btcPrice,
  currencyDisplay,
  presets = DEFAULT_PRESETS,
  disabled = false,
  inputRef,
  editing = false,
  onEditingChange,
  autoFocus = false,
}: ZapAmountInputProps) {
  const localInputRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? localInputRef;
  const [localEditing, setLocalEditing] = useState(editing);
  const isEditing = onEditingChange ? editing : localEditing;
  const setIsEditing = onEditingChange ? onEditingChange : setLocalEditing;

  const numericSats = useMemo(() => {
    const value = typeof amountSats === 'string' ? Number(amountSats.replace(/,/g, '')) : amountSats;
    return Number.isFinite(value) && value >= 0 ? value : 0;
  }, [amountSats]);

  const usdValue = useMemo(() => {
    if (!btcPrice || numericSats <= 0) return null;
    return (numericSats * btcPrice) / 100_000_000;
  }, [numericSats, btcPrice]);

  const displayValue = useMemo(() => {
    if (currencyDisplay === 'usd') {
      if (usdValue === null) return '';
      return usdValue < 1 ? usdValue.toFixed(2) : String(Math.round(usdValue * 100) / 100);
    }
    return typeof amountSats === 'string' ? amountSats : formatSats(amountSats);
  }, [currencyDisplay, usdValue, amountSats]);

  const cornerText = useMemo(() => {
    if (currencyDisplay === 'usd') {
      if (numericSats <= 0) return null;
      return `${formatSats(numericSats)} sats`;
    }
    if (usdValue === null) return null;
    return satsToUSD(numericSats, btcPrice ?? 0);
  }, [currencyDisplay, numericSats, usdValue, btcPrice]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (currencyDisplay === 'usd') {
      if (raw === '') {
        onChange('');
        return;
      }
      const usd = Number(raw);
      if (!Number.isFinite(usd) || usd < 0) return;
      if (!btcPrice || btcPrice <= 0) {
        onChange(raw);
        return;
      }
      const sats = Math.round((usd / btcPrice) * 100_000_000);
      onChange(sats);
      return;
    }
    onChange(parseInput(raw));
  };

  const handleBlur = () => {
    setIsEditing(false);
    if (typeof amountSats === 'string' && amountSats.trim() === '') {
      onChange(0);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      setIsEditing(false);
    }
  };

  const activateEdit = () => {
    if (disabled) return;
    setIsEditing(true);
    setTimeout(() => {
      ref.current?.focus();
      ref.current?.select();
    }, 0);
  };

  const isSelectedPreset = (preset: number) => {
    if (currencyDisplay === 'usd' && usdValue !== null) {
      const presetUsd = (preset * (btcPrice ?? 0)) / 100_000_000;
      return Math.abs(usdValue - presetUsd) < 0.005;
    }
    const value = typeof amountSats === 'string' ? Number(amountSats.replace(/,/g, '')) : amountSats;
    return Number.isFinite(value) && value === preset;
  };

  const handlePreset = (preset: string) => {
    const value = Number(preset);
    if (!Number.isFinite(value) || value <= 0) return;
    onChange(value);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center pt-2">
        {isEditing ? (
          <div className="flex items-baseline justify-center gap-1">
            {currencyDisplay === 'usd' && (
              <span className="text-4xl font-semibold text-muted-foreground">$</span>
            )}
            <input
              ref={ref}
              type="number"
              inputMode={currencyDisplay === 'usd' ? 'decimal' : 'numeric'}
              min={0}
              step={currencyDisplay === 'usd' ? '0.01' : '1'}
              value={displayValue}
              onChange={handleInputChange}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              autoFocus={autoFocus}
              className="bg-transparent border-0 outline-none text-4xl font-semibold text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none max-w-[260px]"
            />
            {currencyDisplay === 'sats' && (
              <span className="text-xl text-muted-foreground">sats</span>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={activateEdit}
            className="flex flex-col items-center rounded-md px-2 -mx-2 hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
          >
            <div className="flex items-baseline justify-center gap-1">
              {currencyDisplay === 'usd' && (
                <span className="text-4xl font-semibold text-muted-foreground">$</span>
              )}
              <span className="text-4xl font-semibold tabular-nums">
                {currencyDisplay === 'usd'
                  ? (displayValue || '0')
                  : (displayValue || '0')}
              </span>
              {currencyDisplay === 'sats' && (
                <span className="text-xl text-muted-foreground">sats</span>
              )}
            </div>
            {cornerText && (
              <span className="text-xs text-muted-foreground mt-1">≈ {cornerText}</span>
            )}
          </button>
        )}
      </div>

      <ToggleGroup
        type="single"
        value={presets.find((p) => isSelectedPreset(p))?.toString() ?? ''}
        onValueChange={handlePreset}
        className="grid grid-cols-5 gap-1 w-full"
      >
        {presets.map((preset) => {
          const selected = isSelectedPreset(preset);
          const label =
            currencyDisplay === 'usd'
              ? (btcPrice ? satsToUSD(preset, btcPrice) : `${preset.toLocaleString()}`)
              : preset >= 1000
                ? `${(preset / 1000).toFixed(0)}k`
                : preset.toLocaleString();
          return (
            <ToggleGroupItem
              key={preset}
              value={String(preset)}
              disabled={disabled}
              className="h-8 min-w-0 text-xs font-semibold px-1"
              data-state={selected ? 'on' : 'off'}
            >
              {label}
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>
    </div>
  );
}
