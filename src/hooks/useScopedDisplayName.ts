import type { NostrMetadata } from "@nostrify/nostrify";

import { useServerScope } from "@/contexts/ServerScopeContext";
import { useServerProfile } from "@/hooks/useServerProfile";
import { getDisplayName } from "@/lib/getDisplayName";

/** A user's resolved identity within the current server scope. */
export interface ScopedIdentity {
  /** Per-server nickname if set, else the global display name. */
  displayName: string;
  /** Per-server username color (CSS hex), or undefined to use the default. */
  color?: string;
  /** Per-server label (short tag), or undefined when not set. */
  label?: string;
}

/**
 * Resolve a user's display name + color + label within the current server
 * scope. When the subtree is wrapped in a {@link ServerScopeProvider} and the
 * user has set a per-server nickname/color/label on that relay, those are
 * returned; otherwise it falls back to the global kind-0 display name and no
 * color/label.
 *
 * The per-server values are queried ONLY from the scoped relay and only applied
 * here, so they never manifest outside the server they were set on.
 */
export function useScopedIdentity(
  pubkey: string | undefined,
  metadata: NostrMetadata | undefined,
): ScopedIdentity {
  const relayUrl = useServerScope();
  const { data: profile } = useServerProfile(relayUrl, pubkey);
  return {
    displayName: profile?.nickname?.trim() || getDisplayName(metadata, pubkey),
    color: profile?.color,
    label: profile?.label?.trim() || undefined,
  };
}

/**
 * Resolve just a user's display name within the current server scope. Thin
 * wrapper over {@link useScopedIdentity} for the many sites that only render
 * the name.
 */
export function useScopedDisplayName(
  pubkey: string | undefined,
  metadata: NostrMetadata | undefined,
): string {
  return useScopedIdentity(pubkey, metadata).displayName;
}
