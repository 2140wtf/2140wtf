// src/wallet/walletHistory.ts
//
// Local wallet history (2140 parity). A bounded, append-only log of the
// user-visible wallet operations: receive, send, Lightning top-up, Lightning
// payment. It lives in its own localStorage key so the wallet store's shape
// (and its migration) stays untouched; the UI mirrors it through useWallet.

export type WalletTxType = 'receive' | 'send' | 'topup' | 'pay';

/** On-chain rails: `l1` = Bitcoin testnet4, `liquid` = Liquid testnet. */
export type WalletTxRail = 'l1' | 'liquid';

export interface WalletTransaction {
  id: string;
  type: WalletTxType;
  /** Cashu mint URL, or the rail label for on-chain rail sends (no mint). */
  mintUrl: string;
  amountSats: number;
  /** Actual Lightning fee paid (pay only). */
  feeSats?: number;
  at: number;
  /** sha256 of the received token (receive only, audit). */
  tokenHash?: string;
  /** Set for on-chain rail sends (l1/liquid); omitted for cashu entries. */
  rail?: WalletTxRail;
  /** Broadcast transaction id (rail sends only, audit). */
  txid?: string;
}

export const TX_STORAGE_KEY = 'bao-fund-wallet-tx';
export const MAX_TRANSACTIONS = 200;

/** `mintUrl` value stored for rail sends — the chain, not a mint. */
export const RAIL_HISTORY_LABEL: Record<WalletTxRail, string> = {
  l1: 'bitcoin-testnet4',
  liquid: 'liquid-testnet',
};

let txCounter = 0;

export function isTxid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

function isValidTransaction(raw: unknown): raw is WalletTransaction {
  if (!raw || typeof raw !== 'object') return false;
  const t = raw as Partial<WalletTransaction>;
  if (typeof t.id !== 'string' || !t.id) return false;
  if (t.type !== 'receive' && t.type !== 'send' && t.type !== 'topup' && t.type !== 'pay') return false;
  if (typeof t.mintUrl !== 'string' || !t.mintUrl) return false;
  if (!Number.isSafeInteger(t.amountSats) || (t.amountSats as number) < 0) return false;
  if (!Number.isFinite(t.at)) return false;
  if (t.rail !== undefined && t.rail !== 'l1' && t.rail !== 'liquid') return false;
  if (t.txid !== undefined && !isTxid(t.txid)) return false;
  return true;
}

// Same-tab push notification (localStorage writes do not fire `storage` in
// the writing tab), so useWallet can mirror rail sends immediately.
type HistoryListener = () => void;
const listeners = new Set<HistoryListener>();

/** Subscribe to history writes. Returns the unsubscribe function. */
export function onHistoryChange(listener: HistoryListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emitHistoryChanged(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* a broken listener must never break a wallet operation */
    }
  }
}

/** Newest first, bounded, drop-on-corruption (history is an audit aid, never
 *  a source of truth for funds). */
export function loadTransactions(): WalletTransaction[] {
  try {
    const raw = localStorage.getItem(TX_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidTransaction).slice(0, MAX_TRANSACTIONS);
  } catch {
    return [];
  }
}

/** Append one transaction (newest first) and persist. Returns the record. */
export function recordTransaction(tx: Omit<WalletTransaction, 'id' | 'at'> & { at?: number }): WalletTransaction {
  txCounter += 1;
  const entry: WalletTransaction = {
    ...tx,
    id: `${Date.now().toString(36)}-${txCounter}-${Math.random().toString(36).slice(2, 8)}`,
    at: tx.at ?? Date.now(),
  };
  try {
    const next = [entry, ...loadTransactions()].slice(0, MAX_TRANSACTIONS);
    localStorage.setItem(TX_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: the operation itself still committed */
  }
  emitHistoryChanged();
  return entry;
}

export function clearTransactions(): void {
  try {
    localStorage.removeItem(TX_STORAGE_KEY);
  } catch {
    /* noop */
  }
  emitHistoryChanged();
}

/**
 * Record a broadcast on-chain send from a rail card. `mintUrl` carries the
 * rail label (`RAIL_HISTORY_LABEL`) so the shared row renderer keeps working;
 * a txid that does not validate is omitted rather than poisoning the log.
 */
export function recordRailSend(rail: WalletTxRail, sats: number, txid: string, feeSats?: number): WalletTransaction {
  return recordTransaction({
    type: 'send',
    rail,
    mintUrl: RAIL_HISTORY_LABEL[rail],
    amountSats: Number.isFinite(sats) && sats > 0 ? Math.floor(sats) : 0,
    ...(isTxid(txid) ? { txid } : {}),
    ...(typeof feeSats === 'number' && Number.isFinite(feeSats) && feeSats >= 0 ? { feeSats: Math.floor(feeSats) } : {}),
  });
}
