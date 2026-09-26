// src/relay/ledgerFeed.ts
//
// Relay-native campaign ledger reads (kind 49305): raised totals derived from
// registrar-signed entries. Authority is a client-side pin
// (`VITE_FUND_REGISTRAR_PUBKEY`, `VITE_FUND_REGISTRAR_EPOCH`); without it the
// reader returns nothing rather than trusting self-signed entries.

import { WebRelayConn } from '@/baofund/community/websocket.js';
import type { Event as NostrEvent } from 'nostr-tools/pure';
import {
  ESCROW_LEDGER_KIND,
  foldLedgerEntry,
  genesisPrevHash,
  initialLedgerFold,
  type LedgerEntryContent,
  type LedgerFoldState,
} from '../lib/baoLedger39805';

export interface LedgerSummary {
  /** Gross sats locked by accepted CONTRIB_LOCK entries (refunds/releases
   *  are separate facts; this is the "raised" number the UI shows). */
  raisedSats: number;
  entriesCount: number;
  headHash: string;
  closed: boolean;
}

export interface RegistrarPin {
  epoch: number;
  pubkey: string;
}

const VITE_ENV = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

/** Parse a registrar pin from raw config values. Both values must be
 *  configured or nothing is trusted; an entry can never authorize its own
 *  signer. */
export function registrarPinFromConfig(pubkeyRaw: string | undefined, epochRaw: string | undefined): RegistrarPin | null {
  const pubkey = pubkeyRaw;
  if (!pubkey || !/^[0-9a-fA-F]{64}$/.test(pubkey)) return null;
  const epoch = epochRaw ? Number(epochRaw) : 1;
  if (!Number.isSafeInteger(epoch) || epoch < 1) return null;
  return { epoch, pubkey: pubkey.toLowerCase() };
}

export function registrarPinFromEnv(): RegistrarPin | null {
  return registrarPinFromConfig(VITE_ENV.VITE_FUND_REGISTRAR_PUBKEY, VITE_ENV.VITE_FUND_REGISTRAR_EPOCH);
}

function contentOf(ev: NostrEvent): LedgerEntryContent | null {
  try {
    const c = JSON.parse(ev.content) as LedgerEntryContent;
    if (!c || typeof c !== 'object' || c.v !== 1 || typeof c.campaign !== 'string') return null;
    return c;
  } catch {
    return null;
  }
}

/**
 * Fold relay ledger events per campaign under the pin. A campaign whose fold
 * fails (bad signature, gap, unauthorized epoch, fork) is omitted rather than
 * partially trusted; the API/fallback path remains for those cards.
 */
export function summarizeLedger(
  events: NostrEvent[],
  pin: RegistrarPin,
): Map<string, LedgerSummary> {
  const byCampaign = new Map<string, NostrEvent[]>();
  for (const ev of events) {
    if (ev.kind !== ESCROW_LEDGER_KIND) continue;
    const c = contentOf(ev);
    if (!c) continue;
    byCampaign.set(c.campaign, [...(byCampaign.get(c.campaign) ?? []), ev]);
  }
  const out = new Map<string, LedgerSummary>();
  for (const [campaign, evs] of byCampaign) {
    try {
      let state: LedgerFoldState = initialLedgerFold(campaign);
      const lockAmounts: number[] = [];
      for (const ev of [...evs].sort((a, b) => {
        const ca = contentOf(a)?.seq ?? 0;
        const cb = contentOf(b)?.seq ?? 0;
        return ca - cb;
      })) {
        const before = state;
        state = foldLedgerEntry(state, ev, {
          campaign,
          registrarEpochs: new Map([[pin.epoch, pin.pubkey]]),
        });
        const c = contentOf(ev);
        // `state !== before` is NOT acceptance: a gap/fork/invalid-balance
        // entry returns a frozen state object too, and counting its amount
        // inflated the registrar-verified raised total with a rejected entry.
        // Only an entry the fold actually advanced may contribute.
        const accepted = state.entriesCount === before.entriesCount + 1;
        if (c?.type === 'CONTRIB_LOCK' && accepted && typeof c.amountSats === 'number') {
          lockAmounts.push(c.amountSats);
        }
      }
      out.set(campaign, {
        raisedSats: lockAmounts.reduce((sum, n) => sum + n, 0),
        entriesCount: state.entriesCount,
        headHash: state.headHash,
        closed: state.closed,
      });
    } catch {
      /* invalid/forked stream - leave the campaign un-enriched */
    }
  }
  return out;
}

/** Query + summarize relay ledger events. Never throws; `{}` on failure.
 *  The query is bounded to the pinned registrar's events; the fold re-checks
 *  the pin regardless. */
export async function fetchRelayLedger(
  relayUrl: string,
  pin: RegistrarPin | null,
  timeoutMs = 4_000,
): Promise<Map<string, LedgerSummary>> {
  if (!pin) return new Map();
  let conn: WebRelayConn | null = null;
  try {
    conn = new WebRelayConn(relayUrl);
    const events = await conn.query({ kinds: [ESCROW_LEDGER_KIND], authors: [pin.pubkey] }, timeoutMs);
    return summarizeLedger(events, pin);
  } catch {
    return new Map();
  } finally {
    try {
      conn?.close();
    } catch {
      /* already closed */
    }
  }
}

/** True when the first entry matches the campaign's genesis anchor.
 *  Malformed content is simply not genesis - never a throw. */
export function isGenesisEntry(ev: NostrEvent): boolean {
  try {
    const c = contentOf(ev);
    return !!c && c.seq === 1 && c.prevHash === genesisPrevHash(c.campaign);
  } catch {
    return false;
  }
}
