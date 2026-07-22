import { Wallet } from 'lucide-react';

import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { NIP99_PAYMENT_METHODS, formatNip99PaymentMethod, type Nip99PaymentMethod } from '@/lib/nip99';

interface PaymentMethodSelectorProps {
  /** Currently selected payment methods. */
  value: Nip99PaymentMethod[];
  /** Called when the selection changes. */
  onChange: (value: Nip99PaymentMethod[]) => void;
}

/**
 * Checkbox group for selecting accepted NIP-99 payment rails.
 *
 * The values are written as `payment` tags on kind 30402 listings and are
 * filtered by {@link ZapDialog} at checkout time.
 */
export function PaymentMethodSelector({ value, onChange }: PaymentMethodSelectorProps) {
  const toggle = (method: Nip99PaymentMethod) => {
    onChange(
      value.includes(method) ? value.filter((m) => m !== method) : [...value, method],
    );
  };

  return (
    <div className="space-y-2 rounded-xl border border-border p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Wallet className="size-4" />
        Accepted payment methods
      </div>
      <div className="grid grid-cols-2 gap-2">
        {NIP99_PAYMENT_METHODS.map((method) => {
          const checked = value.includes(method);
          return (
            <div key={method} className="flex items-center space-x-2">
              <Checkbox
                id={`payment-${method}`}
                checked={checked}
                onCheckedChange={() => toggle(method)}
              />
              <Label htmlFor={`payment-${method}`} className="font-normal text-sm">
                {formatNip99PaymentMethod(method)}
              </Label>
            </div>
          );
        })}
      </div>
    </div>
  );
}
