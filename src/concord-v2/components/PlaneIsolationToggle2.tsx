import { useState } from "react";

import { Switch } from "@/components/ui/switch";
import { planeIsolationEnabled, setPlaneIsolation } from "@/concord-v2/lib/concordTransport";
import type { CommunityV2 } from "@/concord-v2/lib/types";
import { toast } from "@/hooks/useToast";

/**
 * Per-plane socket isolation toggle (P1-3, opt-in per community per device).
 *
 * Default transport puts every stream key of a community on ONE relay
 * connection, so an auth-gated relay can see which streams/epochs belong
 * together (the NIP-42 auth set is a key-possession graph). Isolation mode
 * fans the client out to one connection per stream key, so no socket ever
 * carries more than one identity — at the cost of extra connections and a
 * reconnect to apply. Local-only setting; nothing is published.
 */
export function PlaneIsolationToggle2({ community }: { community: CommunityV2 }) {
  const [enabled, setEnabled] = useState(() => planeIsolationEnabled(community.idHex));

  const toggle = (next: boolean) => {
    setPlaneIsolation(community.idHex, next);
    setEnabled(next);
    toast({
      title: next ? "Connection isolation on" : "Connection isolation off",
      description: next
        ? "Each stream now uses its own relay connection. Reopen the community to reconnect."
        : "Streams share one relay connection again. Reopen the community to reconnect.",
    });
  };

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="space-y-1">
        <p className="text-sm font-medium">Isolate relay connections</p>
        <p className="text-xs text-muted-foreground max-w-sm">
          Use a separate relay connection per stream, so relays can't link this community's
          streams and epochs together. Uses more connections; applies the next time the
          community connects. Stored only on this device.
        </p>
      </div>
      <Switch
        checked={enabled}
        onCheckedChange={toggle}
        aria-label="Isolate relay connections per stream"
      />
    </div>
  );
}
