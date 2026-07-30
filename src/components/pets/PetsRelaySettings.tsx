import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useEncryptedSettings } from '@/hooks/useEncryptedSettings';
import { getEffectiveRelays } from '@/lib/appRelays';
import { isAllowedRelayUrl } from '@/lib/sanitizeUrl';

function normalizeRelayUrl(url: string): string {
  return url.toLowerCase().replace(/\/+$/, '');
}

/**
 * Pets-specific relay settings.
 *
 * Unlike private-group relays (which REPLACE the global set), pets relays are
 * ADDITIVE: pet events are always published to the effective global relay set,
 * plus any extra relays listed here. That keeps pets readable by other clients
 * while letting users mirror them onto their own infrastructure.
 */
export function PetsRelaySettings() {
  const { config, updateConfig } = useAppContext();
  const { user } = useCurrentUser();
  const { updateSettings } = useEncryptedSettings();
  const [input, setInput] = useState('');

  const effectiveUrls = getEffectiveRelays(
    config.relayMetadata,
    config.useAppRelays,
    config.useUserRelays,
  ).relays.map((r) => r.url);

  const extraUrls = config.petsRelays ?? [];

  const persist = (next: string[]) => {
    updateConfig((prev) => ({ ...prev, petsRelays: next }));
    if (user) {
      updateSettings.mutate({ petsRelays: next });
    }
  };

  const handleAdd = () => {
    const trimmed = input.trim();
    if (!isAllowedRelayUrl(trimmed)) return;

    const normalized = normalizeRelayUrl(trimmed);
    const existing = [...effectiveUrls, ...extraUrls].map(normalizeRelayUrl);
    if (existing.includes(normalized)) {
      setInput('');
      return;
    }

    persist([...extraUrls, trimmed]);
    setInput('');
  };

  const handleRemove = (url: string) => {
    const normalized = normalizeRelayUrl(url);
    persist(extraUrls.filter((u) => normalizeRelayUrl(u) !== normalized));
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Pet events are always published to your global relays. Relays added here
        receive an <span className="font-medium text-foreground">extra copy</span> of
        every new pet event — existing pets are not moved or copied retroactively.
      </p>

      {extraUrls.length > 0 && (
        <div className="space-y-2">
          {extraUrls.map((url) => (
            <div
              key={url}
              className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
            >
              <span className="text-sm truncate">{url}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-destructive shrink-0"
                onClick={() => handleRemove(url)}
                aria-label={`Remove ${url}`}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <Input
          type="url"
          placeholder="wss://relay.example.com"
          value={input}
          onChange={(e) => setInput(e.target.value)}
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
          disabled={!isAllowedRelayUrl(input.trim())}
        >
          <Plus className="size-4 mr-1" />
          Add
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Saved locally and synced across devices via encrypted NIP-78 settings.
      </p>
    </div>
  );
}
