import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useEncryptedSettings } from '@/hooks/useEncryptedSettings';
import { getEffectiveRelays } from '@/lib/appRelays';
import { isAllowedRelayUrl } from '@/lib/sanitizeUrl';
import { cn } from '@/lib/utils';

interface RelayPickerProps {
  selected: string[];
  onChange: (selected: string[]) => void;
  className?: string;
}

function normalizeRelayUrl(url: string): string {
  return url.toLowerCase().replace(/\/+$/, '');
}

export function RelayPicker({ selected, onChange, className }: RelayPickerProps) {
  const { config, updateConfig } = useAppContext();
  const { user } = useCurrentUser();
  const { updateSettings } = useEncryptedSettings();
  const [newRelay, setNewRelay] = useState('');

  const effectiveRelays = useMemo(
    () => getEffectiveRelays(config.relayMetadata, config.useAppRelays, config.useUserRelays).relays,
    [config.relayMetadata, config.useAppRelays, config.useUserRelays],
  );
  const effectiveUrls = effectiveRelays.map((r) => r.url);
  const customUrls = config.marketplaceRelays ?? [];

  const persistCustomRelays = (next: string[]) => {
    updateConfig((prev) => ({ ...prev, marketplaceRelays: next }));
    if (user) {
      updateSettings.mutate({ marketplaceRelays: next });
    }
  };

  const toggle = (url: string) => {
    const normalized = normalizeRelayUrl(url);
    const exists = selected.some((s) => normalizeRelayUrl(s) === normalized);
    if (exists) {
      onChange(selected.filter((s) => normalizeRelayUrl(s) !== normalized));
    } else {
      onChange([...selected, url]);
    }
  };

  const handleAdd = () => {
    const trimmed = newRelay.trim();
    if (!isAllowedRelayUrl(trimmed)) return;

    const normalized = normalizeRelayUrl(trimmed);
    const allExisting = [...effectiveUrls, ...customUrls].map(normalizeRelayUrl);
    if (allExisting.includes(normalized)) {
      setNewRelay('');
      return;
    }

    const next = [...customUrls, trimmed];
    persistCustomRelays(next);
    onChange([...selected, trimmed]);
    setNewRelay('');
  };

  const handleRemove = (url: string) => {
    const normalized = normalizeRelayUrl(url);
    onChange(selected.filter((s) => normalizeRelayUrl(s) !== normalized));
    const next = customUrls.filter((u) => normalizeRelayUrl(u) !== normalized);
    persistCustomRelays(next);
  };

  const RelayRow = ({ url, removable }: { url: string; removable?: boolean }) => {
    const checked = selected.some((s) => normalizeRelayUrl(s) === normalizeRelayUrl(url));
    return (
      <div key={url} className="flex items-start gap-2">
        <Checkbox
          id={`relay-${url}`}
          checked={checked}
          onCheckedChange={() => toggle(url)}
        />
        <div className="grid gap-0.5 leading-none flex-1 min-w-0">
          <Label htmlFor={`relay-${url}`} className="text-sm font-normal cursor-pointer truncate">
            {url}
          </Label>
        </div>
        {removable && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 -mr-2 text-muted-foreground hover:text-destructive"
            onClick={() => handleRemove(url)}
            aria-label={`Remove ${url}`}
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>
    );
  };

  return (
    <div className={cn('space-y-4', className)}>
      <div className="text-sm font-medium">Publish to relays</div>

      <div className="space-y-2">
        {effectiveUrls.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Your relays</p>
            {effectiveUrls.map((url) => (
              <RelayRow key={url} url={url} />
            ))}
          </div>
        )}

        {customUrls.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Custom marketplace relays</p>
            {customUrls.map((url) => (
              <RelayRow key={url} url={url} removable />
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <Input
          type="url"
          placeholder="wss://relay.example.com"
          value={newRelay}
          onChange={(e) => setNewRelay(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleAdd();
            }
          }}
          className="text-sm"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleAdd}
          disabled={!isAllowedRelayUrl(newRelay.trim())}
        >
          <Plus className="size-4 mr-1" />
          Add
        </Button>
      </div>

      {selected.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No relay selected. Select at least one relay to publish.
        </p>
      )}
    </div>
  );
}
