import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useEncryptedSettings } from '@/hooks/useEncryptedSettings';
import { getEffectiveRelays } from '@/lib/appRelays';
import { isAllowedRelayUrl } from '@/lib/sanitizeUrl';
import { cn } from '@/lib/utils';

function normalizeRelayUrl(url: string): string {
  return url.toLowerCase().replace(/\/+$/, '');
}

export function GroupChatRelaySettings() {
  const { config, updateConfig } = useAppContext();
  const { user } = useCurrentUser();
  const { updateSettings } = useEncryptedSettings();
  const [input, setInput] = useState('');

  const effectiveUrls = getEffectiveRelays(
    config.relayMetadata,
    config.useAppRelays,
    config.useUserRelays,
  ).relays.map((r) => r.url);

  const customUrls = config.groupChatRelays ?? [];

  const persist = (next: string[]) => {
    updateConfig((prev) => ({ ...prev, groupChatRelays: next }));
    if (user) {
      updateSettings.mutate({ groupChatRelays: next });
    }
  };

  const handleAdd = () => {
    const trimmed = input.trim();
    if (!isAllowedRelayUrl(trimmed)) return;

    const normalized = normalizeRelayUrl(trimmed);
    const existing = [...effectiveUrls, ...customUrls].map(normalizeRelayUrl);
    if (existing.includes(normalized)) {
      setInput('');
      return;
    }

    const next = [...customUrls, trimmed];
    persist(next);
    setInput('');
  };

  const handleRemove = (url: string) => {
    const normalized = normalizeRelayUrl(url);
    const next = customUrls.filter((u) => normalizeRelayUrl(u) !== normalized);
    persist(next);
  };

  return (
    <div className="space-y-4">
      {customUrls.length === 0 ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            No custom relays set. Private groups will fall back to your effective global relays:
          </p>
          {effectiveUrls.length > 0 ? (
            <ul className="text-sm space-y-1">
              {effectiveUrls.map((url) => (
                <li key={url} className="truncate">
                  {url}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-destructive">
              No global relays are configured. Add relays above or set group-chat-specific relays here.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            New groups and group events will be published to these relays instead of your global relays.
          </p>
          {customUrls.map((url) => (
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

      <p className={cn('text-xs text-muted-foreground')}>
        Custom group-chat relays are saved locally and synced across devices via encrypted NIP-78 settings.
      </p>
    </div>
  );
}
