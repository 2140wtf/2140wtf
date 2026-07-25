import { Plus, RotateCcw, X } from "lucide-react";
import { useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRelayInfo } from "@/hooks/useRelayInfo";
import { toast } from "@/hooks/useToast";
import { normalizeRelayUrl } from "@/lib/platform";

/** Hostname for a relay URL. */
function relayHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^wss?:\/\//, "");
  }
}

/**
 * One relay row showing its NIP-11 identity (icon, name, host) and notable
 * NIP badges (NIP-42 AUTH, NIP-50 search). Adapted from Ditto's RelayIdentity.
 */
function RelayIdentity({ url }: { url: string }) {
  const { data: info } = useRelayInfo(url);
  const host = relayHost(url);
  const name = info?.name || host;
  const nips = (info?.supported_nips ?? []).filter((nip) => nip === 42 || nip === 50);

  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <Avatar className="size-7 rounded-md shrink-0">
        <AvatarImage src={info?.icon} alt={name} />
        <AvatarFallback className="rounded-md bg-secondary text-secondary-foreground text-xs">
          {name.charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <div className="text-sm font-medium truncate leading-tight">{name}</div>
        <div className="text-xs text-muted-foreground font-mono truncate leading-tight">{host}</div>
      </div>
      <div className="flex items-center gap-1 ml-auto shrink-0">
        {nips.includes(50) && <Badge variant="outline" className="text-[10px] px-1.5">NIP-50</Badge>}
        {nips.includes(42) && <Badge variant="outline" className="text-[10px] px-1.5">NIP-42</Badge>}
      </div>
    </div>
  );
}

export interface RelayListEditorProps {
  /** Editable relay URLs. */
  relays: string[];
  /** Persist a new relay list. */
  onChange: (relays: string[]) => void;
  /** Read-only, non-removable relays shown first (e.g. pinned platform relays). */
  pinned?: string[];
  /** Reset the editable list to defaults. */
  onReset?: () => void;
  /** Empty-state message when there are no editable relays. */
  emptyText?: string;
  /** Add-input placeholder. */
  placeholder?: string;
}

/**
 * Reusable relay list editor — pinned (read-only) entries, an editable list
 * with remove buttons, an add form, and an optional reset. Mirrors the layout
 * of Ditto's RelayListManager (NIP-11 identity rows + NIP-50/42 badges), in
 * Armada's simpler `string[]` format (no per-relay read/write markers).
 */
export function RelayListEditor({
  relays,
  onChange,
  pinned = [],
  onReset,
  emptyText = "No relays configured.",
  placeholder = "wss://relay.example.com",
}: RelayListEditorProps) {
  const [newUrl, setNewUrl] = useState("");

  const handleAdd = () => {
    const normalized = normalizeRelayUrl(newUrl);
    if (!normalized) {
      toast({ title: "Invalid relay URL", description: "Enter a ws:// or wss:// URL.", variant: "destructive" });
      return;
    }
    if (pinned.includes(normalized) || relays.includes(normalized)) {
      toast({ title: "Already in the list", description: normalized });
      return;
    }
    onChange([...relays, normalized]);
    setNewUrl("");
  };

  return (
    <div className="space-y-1.5">
      {pinned.map((url) => (
        <div key={url} className="flex items-center gap-2 rounded-md bg-background/40 px-3 py-2.5">
          <RelayIdentity url={url} />
          <span className="text-xs text-muted-foreground shrink-0 ml-1">Pinned</span>
        </div>
      ))}

      {relays.map((url) => (
        <div key={url} className="flex items-center gap-2 rounded-md bg-background/40 px-3 py-2.5">
          <div className="flex-1 min-w-0">
            <RelayIdentity url={url} />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remove ${url}`}
            className="size-7 text-muted-foreground hover:text-destructive shrink-0"
            onClick={() => onChange(relays.filter((u) => u !== url))}
          >
            <X className="size-4" />
          </Button>
        </div>
      ))}

      {relays.length === 0 && pinned.length === 0 && (
        <p className="text-sm text-muted-foreground py-1">{emptyText}</p>
      )}

      {/* Not a <form>: this editor can render inside a parent <form> (e.g. the
          create-community dialog), and nested forms are invalid HTML — the
          browser drops the inner one and "Add" would submit the parent. */}
      <div className="flex gap-2 pt-1">
        <Input
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
          placeholder={placeholder}
          aria-label="Add relay"
          autoComplete="off"
          className="text-base md:text-sm bg-background/40 border-transparent"
        />
        <Button type="button" disabled={!newUrl.trim()} className="clip-corner-lg shrink-0" onClick={handleAdd}>
          <Plus className="size-4 mr-1.5" /> Add
        </Button>
      </div>

      {onReset && (
        <Button type="button" variant="ghost" size="sm" className="text-muted-foreground -ml-2" onClick={onReset}>
          <RotateCcw className="size-3.5 mr-1.5" /> Reset to defaults
        </Button>
      )}
    </div>
  );
}
