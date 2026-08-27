/**
 * Work verbs for headless agent tooling — the relay-first earning surface.
 * Consumes the compute-credit protocol (src/lib/baoComputeCredits.ts) over
 * plain public Nostr events (no gift-wrap, no community chat stack).
 *
 * The Cashu token itself never appears in any event; it travels by NIP-17 DM.
 * Events carry metadata only.
 */
import { hexToBytes } from "@noble/hashes/utils.js";
import { getPublicKey, Relay } from "nostr-tools";
import { finalizeEvent, type EventTemplate, type NostrEvent } from "nostr-tools/pure";

import {
  BAO_COMPUTE_CREDIT_REQUEST_KIND,
  buildComputeCreditRequest,
} from "@/lib/baoComputeCredits";

/** Minimal identity + relay scope the work verbs operate on. */
export interface State {
  sk: Uint8Array;
  community: { relays: string[] };
}

const nowSec = (): number => Math.floor(Date.now() / 1000);

async function signPlain(state: State, template: EventTemplate): Promise<NostrEvent> {
  return finalizeEvent(template, hexToBytes(state.sk));
}

/** Best-effort publish to each relay; resolves once every attempt settles. */
async function publishAll(relays: string[], event: NostrEvent, label: string): Promise<void> {
  await Promise.all(relays.map(async (url) => {
    try {
      const relay = await Relay.connect(url);
      try {
        await relay.publish(event);
      } finally {
        relay.close();
      }
    } catch (error) {
      console.warn(`[${label}] relay ${url} failed:`, error instanceof Error ? error.message : error);
    }
  }));
}

/**
 * Publish an open compute-credit request. Returns the event id (the request
 * id funders will reference).
 */
export async function requestCredits(state: State, amountSats: number, purpose: string, dryRun: boolean, tranches?: number[]): Promise<string> {
  const template = buildComputeCreditRequest({ amountSats, purpose, ...(tranches ? { tranches } : {}) });
  const event = await signPlain(state, template);
  if (!dryRun) await publishAll(state.community.relays, event, "compute-credit request");
  return event.id;
}

/** The agent's public key (hex) for its identity. */
export function agentPubkey(state: State): string {
  return getPublicKey(hexToBytes(state.sk));
}

export { BAO_COMPUTE_CREDIT_REQUEST_KIND, nowSec };
