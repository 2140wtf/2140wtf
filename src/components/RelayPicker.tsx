import { useMemo } from 'react';

import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useAppContext } from '@/hooks/useAppContext';
import { getEffectiveRelays } from '@/lib/appRelays';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

const BAO_RELAY = 'wss://relay.bao.network';

interface RelayPickerProps {
  selected: string[];
  onChange: (selected: string[]) => void;
  className?: string;
}

function normalizeRelayUrl(url: string): string {
  return url.toLowerCase().replace(/\/+$/, '');
}

export function RelayPicker({ selected, onChange, className }: RelayPickerProps) {
  const { config } = useAppContext();

  const relays = useMemo(() => {
    const effective = getEffectiveRelays(config.relayMetadata, config.useAppRelays, config.useUserRelays);
    const urls = effective.relays.map((r) => r.url);
    if (!urls.some((u) => normalizeRelayUrl(u) === normalizeRelayUrl(BAO_RELAY))) {
      urls.unshift(BAO_RELAY);
    }
    return urls;
  }, [config.relayMetadata, config.useAppRelays, config.useUserRelays]);

  const toggle = (url: string) => {
    const normalized = normalizeRelayUrl(url);
    const exists = selected.some((s) => normalizeRelayUrl(s) === normalized);
    if (exists) {
      onChange(selected.filter((s) => normalizeRelayUrl(s) !== normalized));
    } else {
      onChange([...selected, url]);
    }
  };

  return (
    <div className={cn('space-y-3', className)}>
      <div className="text-sm font-medium">Publish to relays</div>
      <div className="space-y-2">
        {relays.map((url) => {
          const isBao = normalizeRelayUrl(url) === normalizeRelayUrl(BAO_RELAY);
          const checked = selected.some((s) => normalizeRelayUrl(s) === normalizeRelayUrl(url));
          return (
            <div key={url} className="flex items-start gap-2">
              <Checkbox
                id={`relay-${url}`}
                checked={checked}
                onCheckedChange={() => toggle(url)}
              />
              <div className="grid gap-0.5 leading-none">
                <Label htmlFor={`relay-${url}`} className="text-sm font-normal cursor-pointer">
                  {url}
                </Label>
                {isBao && (
                  <Badge variant="secondary" className="w-fit text-[10px]">
                    ₿AO marketplace
                  </Badge>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {selected.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No relay selected. Select at least one relay to publish.
        </p>
      )}
    </div>
  );
}
