/**
 * ₿AO MARKETS position-sync support.
 *
 * BAO Markets stores individual trades as NIP-44 self-encrypted, NIP-59
 * gift-wrapped events. Pets reads the user's own NIP-78 (kind 30078)
 * position-sync event instead of unwrapping those gift-wraps, preserving
 * trade privacy.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import type { BaoTradeActivity } from './bao-trade-parser';
export type { BaoTradeActivity } from './bao-trade-parser';

export const BAO_POSITION_SYNC_KIND = 30078;
export const BAO_POSITION_SYNC_VERSION = 1;

export const BAO_SYNC_RELAYS = [
  'wss://relay.bao.network',
  'wss://relay.damus.io',
  'wss://nos.lol',
] as const;

export interface SyncedPosition {
  m: string;
  o: string;
  a: number;
  s: number;
  p: number;
  f: number;
  i: string;
  t: number;
  st: string;
}

export interface PositionSyncData {
  pos: SyncedPosition[];
  u: number;
  v: number;
}

export function generateBaoPositionDTag(pubkey: string): string {
  const hash = sha256(new TextEncoder().encode(`bao-positions:${pubkey}:v1`));
  return bytesToHex(hash).slice(0, 32);
}

function parseNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return 0;
}

function parsePosition(pos: unknown): SyncedPosition | null {
  if (!pos || typeof pos !== 'object') return null;
  const p = pos as Record<string, unknown>;

  const marketId = typeof p.m === 'string' ? p.m : '';
  const orderId = typeof p.i === 'string' ? p.i : '';
  if (!marketId || !orderId) return null;

  return {
    m: marketId,
    o: typeof p.o === 'string' ? p.o : '',
    a: parseNumber(p.a),
    s: parseNumber(p.s),
    p: parseNumber(p.p),
    f: parseNumber(p.f),
    i: orderId,
    t: parseNumber(p.t),
    st: typeof p.st === 'string' ? p.st.toLowerCase() : 'unknown',
  };
}

export function parsePositionSyncData(json: string): PositionSyncData | null {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const data = parsed as Record<string, unknown>;

    const version = parseNumber(data.v);
    if (version !== BAO_POSITION_SYNC_VERSION) return null;

    const rawPositions = Array.isArray(data.pos) ? data.pos : [];
    const positions = rawPositions.map(parsePosition).filter((p): p is SyncedPosition => p !== null);

    return {
      pos: positions,
      u: parseNumber(data.u),
      v: version,
    };
  } catch {
    return null;
  }
}

export function aggregateBaoPositionSync(data: PositionSyncData): BaoTradeActivity {
  const nowSeconds = Math.floor(Date.now() / 1000);

  const orders = data.pos.map((pos) => ({
    id: pos.i,
    orderId: pos.i,
    marketId: pos.m,
    side: 'buy' as const,
    outcomeId: pos.o,
    amount: Math.max(0, Math.floor(pos.a)),
    price: Math.max(0, Math.min(100, Math.floor(pos.p))),
    status: pos.st,
    demoBot: false,
    createdAt: pos.t > 0 ? Math.floor(pos.t / 1000) : nowSeconds,
  }));

  const activeOrders = orders.filter((o) => o.status === 'active');
  const markets = new Set(activeOrders.map((o) => o.marketId));

  return {
    totalActiveAmount: activeOrders.reduce((sum, o) => sum + o.amount, 0),
    activeOrderCount: activeOrders.length,
    uniqueMarketCount: markets.size,
    orders,
  };
}

export function emptyBaoTradeActivity(): BaoTradeActivity {
  return {
    totalActiveAmount: 0,
    activeOrderCount: 0,
    uniqueMarketCount: 0,
    orders: [],
  };
}
