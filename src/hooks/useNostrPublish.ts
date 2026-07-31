import { useNostr } from "@nostrify/react";
import { useMutation, type UseMutationResult } from "@tanstack/react-query";
import { nip19, verifyEvent } from "nostr-tools";

import { useAppContext } from "./useAppContext";
import { useCurrentUser } from "./useCurrentUser";
import { sendToInboxRelays } from "@/lib/inboxRelays";

import type { NostrEvent } from "@nostrify/nostrify";

/** Event template accepted by `useNostrPublish`. */
export type EventTemplate = Omit<NostrEvent, 'id' | 'pubkey' | 'sig' | 'created_at'> & {
  created_at?: number;
  /**
   * The previous version of the event being replaced (for replaceable/addressable kinds).
   * When provided, `published_at` from the old event is preserved on the new one.
   * When omitted and the kind is replaceable or addressable, `published_at` is set
   * equal to `created_at` so the two always match on first publish.
   */
  prev?: NostrEvent;
  /**
   * Optional explicit relay set. When provided, the signed event is published
   * only to these relays via `nostr.group()`. Otherwise the event is published
   * to the global effective relay pool.
   */
  relays?: string[];
  /**
   * When set, publish only to this single relay (₿AO chat / Concord traffic
   * that must stay on one host). Takes precedence over `relays`.
   */
  relay?: string;
  /**
   * Called with the fully-signed event immediately before it is sent to the
   * network. Lets callers optimistically insert the event into a local cache
   * (and learn its final id) before the relay round-trip completes.
   */
  onSigned?: (event: NostrEvent) => void;
};

/** Returns true if the kind falls in a replaceable or addressable range. */
function isReplaceableKind(kind: number): boolean {
  // Legacy replaceable kinds
  if (kind === 0 || kind === 3) return true;
  // Replaceable (10000–19999) or addressable (30000–39999)
  return (kind >= 10000 && kind < 20000) || (kind >= 30000 && kind < 40000);
}

/**
 * Builds a NIP-89 "client" tag from the app display name and an optional
 * `naddr1` identifier for the kind 31990 handler event.
 *
 * Tag format (per NIP-89):
 *   ["client", <name>, <31990:pubkey:d-tag>, <relay-hint>]
 *
 * The relay hint is taken from the first relay embedded in the naddr (if any).
 */
function buildClientTag(name: string, clientNaddr: string | undefined): string[] {
  if (!clientNaddr) {
    return ["client", name];
  }

  try {
    const decoded = nip19.decode(clientNaddr);
    if (decoded.type !== "naddr") {
      return ["client", name];
    }
    const { kind, pubkey, identifier, relays } = decoded.data;
    const addr = `${kind}:${pubkey}:${identifier}`;
    const relayHint = relays?.[0];
    return relayHint ? ["client", name, addr, relayHint] : ["client", name, addr];
  } catch {
    return ["client", name];
  }
}

export function useNostrPublish(): UseMutationResult<NostrEvent, Error, EventTemplate> {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { config } = useAppContext();

  return useMutation({
    mutationFn: async (t: EventTemplate) => {
      if (user) {
        // Extract `prev`, `relays`, `relay`, and `onSigned` before building the event — they're not part of the Nostr event schema.
        const { prev, relays, relay, onSigned, ...template } = t;
        const tags = [...(template.tags ?? [])];

        // Add the NIP-89 client tag if it doesn't exist
        if (!tags.some(([name]) => name === "client")) {
          const clientTag = buildClientTag(config.clientName ?? config.appName, config.client);
          tags.push(clientTag);
        }

        const created_at = template.created_at ?? Math.floor(Date.now() / 1000);

        // Handle published_at for replaceable/addressable events (NIP-24)
        if (isReplaceableKind(template.kind) && !tags.some(([name]) => name === "published_at")) {
          // Only reuse `prev` when it is a verified event from the same user and
          // the same kind. A forged or mismatched prev must be rejected rather
          // than silently ignored, otherwise an attacker could roll `published_at`
          // back or reuse metadata from the wrong replaceable coordinate.
          let trustedPrev: NostrEvent | undefined;
          if (prev) {
            const prevValid = (() => {
              try {
                return verifyEvent(prev);
              } catch {
                return false;
              }
            })();
            if (!prevValid || prev.pubkey !== user.pubkey || prev.kind !== template.kind) {
              throw new Error(
                "Rejected forged or mismatched prev event: signature, pubkey, or kind does not match.",
              );
            }
            trustedPrev = prev;
          }

          if (trustedPrev) {
            // Preserve published_at from the previous event if it had one
            const oldTag = trustedPrev.tags.find(([name]) => name === "published_at");
            if (oldTag) {
              tags.push(["published_at", oldTag[1]]);
            }
          } else {
            // First publish: set published_at equal to created_at
            tags.push(["published_at", String(created_at)]);
          }
        }

        const event = await user.signer.signEvent({
          kind: template.kind,
          content: template.content ?? "",
          tags,
          created_at,
        });

        if (event.pubkey !== user.pubkey) {
          throw new Error(
            "Signed event pubkey does not match the currently selected account. Please check your signer configuration.",
          );
        }

        // Let callers optimistically render the event before the network call.
        onSigned?.(event);

        if (relay) {
          await nostr.relay(relay).event(event, { signal: AbortSignal.timeout(5000) });
        } else if (relays && relays.length > 0) {
          await nostr.group(relays).event(event, { signal: AbortSignal.timeout(5000) });
        } else {
          await nostr.event(event, { signal: AbortSignal.timeout(5000) });
        }

        // NIP-65: For reply events (kind 1 and 1111), pet-battle sync messages
        // (kind 21124), battle result attestations (kind 11124), and encrypted
        // protocol gift wraps (kind 1059), also send to the inbox (read) relays
        // of tagged users so they receive the event.
        // This is fire-and-forget — it must not block the publish flow.
        if (event.kind === 1 || event.kind === 1111 || event.kind === 21124 || event.kind === 11124 || event.kind === 1059) {
          const taggedPubkeys = event.tags
            .filter(([name]) => name === 'p' || name === 'P')
            .map(([, pubkey]) => pubkey)
            .filter(Boolean);

          if (taggedPubkeys.length > 0) {
            sendToInboxRelays(nostr, event, taggedPubkeys).catch((error) => {
              // Inbox delivery is best-effort; log failures for debugging.
              console.warn('Inbox relay delivery failed:', error);
            });
          }
        }

        return event;
      } else {
        throw new Error("User is not logged in");
      }
    },
    onError: (error) => {
      console.error("Failed to publish event:", error);
    },
    onSuccess: (data) => {
      console.log("Event published successfully:", data);
    },
  });
}
