/**
 * Work verbs for the headless ₿AO agent driver — the relay-first earning
 * surface. Consumes the compute-credit protocol (src/lib/baoComputeCredits.ts)
 * over the SAME relay primitives the chat verbs use (chat-core queryAll /
 * publishAll / signerOf), so an agent can discover, request, fulfill, and
 * receipt compute funding with no GUI.
 *
 * These are PUBLIC Nostr events (kinds 4971/4972/4973) — no gift-wrap, unlike
 * community chat. The Cashu token itself never appears in any event; it
 * travels by NIP-17 DM. Events carry metadata only.
 *
 * Wired into scripts/bao-agent.ts as the `work` mode. Shared with the MCP
 * server so the two front-ends cannot diverge (same pattern as chat-core).
 */
import { hexToBytes } from "@noble/hashes/utils.js";
import * as nip19 from "nostr-tools/nip19";
import * as nip17 from "nostr-tools/nip17";

import {
  BAO_COMPUTE_CREDIT_FULFILLMENT_KIND,
  BAO_COMPUTE_CREDIT_RECEIPT_KIND,
  BAO_COMPUTE_CREDIT_REQUEST_KIND,
  BAO_COMPUTE_CREDIT_TAG,
  buildComputeCreditFulfillment,
  buildComputeCreditReceipt,
  buildComputeCreditRequest,
  parseComputeCreditFulfillment,
  parseComputeCreditReceipt,
  parseComputeCreditRequest,
  type ComputeCreditFulfillment,
  type ComputeCreditReceipt,
  type ComputeCreditRequest,
} from "@/lib/baoComputeCredits";
import { openCreditRequests, totalOpenSats } from "@/lib/baoWorkDiscovery";
import { publishAll, queryAll, signerOf } from "./chat-core";
import type { State } from "./chat-core";

/** Re-exported so impure shells (e.g. Paradise runtime) can build a State shim
 *  and reuse the shared relay verbs without coupling to chat-core directly. */
export type { State };

const nowSec = (): number => Math.floor(Date.now() / 1000);
const npub = (hex: string): string => {
  try {
    return nip19.npubEncode(hex);
  } catch {
    return hex;
  }
};

/** Resolve a npub/hex argument to a 32-byte hex pubkey. */
function resolvePubkey(arg: string): string {
  if (/^[0-9a-f]{64}$/.test(arg)) return arg;
  const decoded = nip19.decode(arg);
  if (decoded.type === "npub") return decoded.data as string;
  if (decoded.type === "nprofile") return (decoded.data as { pubkey: string }).pubkey;
  throw new Error(`expected an npub or hex pubkey, got ${arg}`);
}

async function signPlain(state: State, template: { kind: number; content: string; tags: string[][] }): Promise<import("nostr-tools/pure").NostrEvent> {
  const signer = signerOf(hexToBytes(state.sk));
  return signer.signEvent({ ...template, created_at: nowSec() });
}

// ── list ──────────────────────────────────────────────────────────────────────

export interface WorkListing {
  open: ComputeCreditRequest[];
  totalOpenSats: number;
  fulfillments: ComputeCreditFulfillment[];
}

export interface WorkHistoryBundle {
  version: 1;
  exportedAt: string;
  identityPubkey: string;
  requests: ComputeCreditRequest[];
  fulfillments: ComputeCreditFulfillment[];
  receipts: ComputeCreditReceipt[];
}

export interface CreditInboxMessage {
  eventId: string;
  senderPubkey: string;
  createdAt: number;
  requestId?: string;
  token?: string;
  content: string;
}

const CASHU_TOKEN_RE = /cashu[0-9A-Za-z_-]+/g;

/**
 * Read NIP-17 gift-wrapped compute-credit messages addressed to this agent.
 * Tokens are returned for local processing only; they are never republished.
 */
export async function listCreditInbox(state: State): Promise<CreditInboxMessage[]> {
  const pubkey = getPublicKey(hexToBytes(state.sk));
  const wraps = await queryAll(state.community.relays, { kinds: [1059], "#p": [pubkey], limit: 100 });
  const messages: CreditInboxMessage[] = [];
  for (const wrap of wraps) {
    try {
      const rumor = nip17.unwrapEvent(wrap, hexToBytes(state.sk));
      const content = rumor.content.trim();
      const token = content.match(CASHU_TOKEN_RE)?.[0];
      const requestId = content.match(/request ([0-9a-f]{64})\\b/i)?.[1];
      messages.push({ eventId: wrap.id, senderPubkey: rumor.pubkey, createdAt: rumor.created_at, ...(requestId ? { requestId } : {}), ...(token ? { token } : {}), content });
    } catch {
      // Ignore gift wraps that are not decryptable by this identity.
    }
  }
  return messages.sort((a, b) => b.createdAt - a.createdAt);
}

/** Query the relays and resolve open compute-credit requests. */
export async function listWork(state: State): Promise<WorkListing> {
  const relays = state.community.relays;
  const [reqEvents, rcptEvents, fulEvents] = await Promise.all([
    queryAll(relays, { kinds: [BAO_COMPUTE_CREDIT_REQUEST_KIND], "#t": [BAO_COMPUTE_CREDIT_TAG] }),
    queryAll(relays, { kinds: [BAO_COMPUTE_CREDIT_RECEIPT_KIND] }),
    queryAll(relays, { kinds: [BAO_COMPUTE_CREDIT_FULFILLMENT_KIND] }),
  ]);
  const requests = reqEvents.map(parseComputeCreditRequest).filter((r): r is ComputeCreditRequest => r !== null);
  const receipts = rcptEvents.map(parseComputeCreditReceipt).filter((r): r is ComputeCreditReceipt => r !== null);
  const fulfillments = fulEvents.map(parseComputeCreditFulfillment).filter((f): f is ComputeCreditFulfillment => f !== null);
  const open = openCreditRequests(requests, receipts);
  return { open, totalOpenSats: totalOpenSats(open), fulfillments };
}

/** Export only signed-event metadata needed to reconstruct work status. */
export async function exportWorkHistory(state: State): Promise<WorkHistoryBundle> {
  const pubkey = getPublicKey(hexToBytes(state.sk));
  const [reqEvents, rcptEvents, fulEvents] = await Promise.all([
    queryAll(state.community.relays, { kinds: [BAO_COMPUTE_CREDIT_REQUEST_KIND], authors: [pubkey] }),
    queryAll(state.community.relays, { kinds: [BAO_COMPUTE_CREDIT_RECEIPT_KIND], authors: [pubkey] }),
    queryAll(state.community.relays, { kinds: [BAO_COMPUTE_CREDIT_FULFILLMENT_KIND], '#p': [pubkey] }),
  ]);
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    identityPubkey: pubkey,
    requests: reqEvents.map(parseComputeCreditRequest).filter((r): r is ComputeCreditRequest => r !== null),
    fulfillments: fulEvents.map(parseComputeCreditFulfillment).filter((f): f is ComputeCreditFulfillment => f !== null),
    receipts: rcptEvents.map(parseComputeCreditReceipt).filter((r): r is ComputeCreditReceipt => r !== null),
  };
}

/** Validate an imported metadata bundle and reject secret-bearing payloads. */
export function validateWorkHistory(value: unknown): WorkHistoryBundle {
  if (!value || typeof value !== 'object') throw new Error('Work history must be a JSON object.');
  const raw = JSON.stringify(value);
  if (/(nsec|private.?key|cashu[a-z]|proofs?)/i.test(raw)) throw new Error('Work history must not contain keys, Cashu tokens, or proofs.');
  const bundle = value as Partial<WorkHistoryBundle>;
  if (bundle.version !== 1 || typeof bundle.identityPubkey !== 'string' || !Array.isArray(bundle.requests) || !Array.isArray(bundle.fulfillments) || !Array.isArray(bundle.receipts)) {
    throw new Error('Unsupported or malformed work history bundle.');
  }
  return bundle as WorkHistoryBundle;
}

export function printWorkListing(listing: WorkListing, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(listing.open));
    return;
  }
  if (listing.open.length === 0) {
    console.log("No open compute-credit requests on these relays.");
    return;
  }
  console.log(`\nOpen compute-credit requests (${listing.open.length}, ${listing.totalOpenSats} sats sought):`);
  for (const r of listing.open) {
    console.log(`  ${r.id.slice(0, 12)}…  ${r.amountSats} sats  by ${npub(r.pubkey).slice(0, 20)}…`);
    console.log(`    ${r.purpose}`);
  }
}

// ── request (raise bitcoin) ───────────────────────────────────────────────────

export async function requestCredits(state: State, amountSats: number, purpose: string, dryRun: boolean, tranches?: number[]): Promise<string> {
  const template = buildComputeCreditRequest({ amountSats, purpose, ...(tranches ? { tranches } : {}) });
  const event = await signPlain(state, template);
  if (!dryRun) await publishAll(state.community.relays, event, "compute-credit request");
  return event.id;
}

// ── fulfill (a funder claims they sent the token) ─────────────────────────────

export async function fulfillCredits(
  state: State,
  requestId: string,
  requesterPubkey: string,
  amountSats: number,
  dryRun: boolean,
  shot?: number,
): Promise<string> {
  const template = buildComputeCreditFulfillment({ requestId, requesterPubkey, amountSats, ...(shot ? { shot } : {}) });
  const event = await signPlain(state, template);
  if (!dryRun) await publishAll(state.community.relays, event, "compute-credit fulfillment");
  return event.id;
}

// ── receipt (the agent confirms redemption) ────────────────────────────────────

export async function receiptCredits(
  state: State,
  requestId: string,
  amountSats: number,
  note: string,
  funderPubkeys: string[],
  dryRun: boolean,
  shot?: number,
): Promise<string> {
  const template = buildComputeCreditReceipt({ requestId, amountSats, note, funderPubkeys, ...(shot ? { shot } : {}) });
  const event = await signPlain(state, template);
  if (!dryRun) await publishAll(state.community.relays, event, "compute-credit receipt");
  return event.id;
}

export { resolvePubkey, npub };
