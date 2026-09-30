// src/wallet/pendingDelivery.ts
//
// Per-identity journal of ISSUED BUT UNDELIVERED pledge tokens.
//
// The mainnet Cashu pledge path mints a real token out of the donor's wallet
// and shows it for hand-off. Until the token reaches the founder (nutzap
// accepted, or the donor copied/used it), it is the ONLY copy of those sats:
// closing the modal used to destroy it, turning "delivery failed" into a
// silent burn. The modal persists every issued token here BEFORE it is shown
// and clears the entry once the nutzap delivers; the modal also restores the
// entry when the campaign is re-opened, so a closed tab never loses the
// token. Local convenience store - the token itself is the value, and the
// founder is who can claim it.

export interface PendingDeliveryRecord {
  v: 1;
  frId: string;
  mint: string;
  amountSats: number;
  token: string;
  /** Delivery channel that failed/never ran, for display only. */
  via: 'nutzap' | 'manual';
  createdAt: number;
}

const PREFIX = 'baofund:pending-delivery:';
const MAX_RECORDS = 10;

function storeKey(pubkey: string | null | undefined): string | null {
  return typeof pubkey === 'string' && /^[0-9a-f]{64}$/i.test(pubkey) ? `${PREFIX}${pubkey.toLowerCase()}` : null;
}

function isValid(record: unknown): record is PendingDeliveryRecord {
  if (!record || typeof record !== 'object') return false;
  const r = record as Record<string, unknown>;
  return (
    r.v === 1
    && typeof r.token === 'string' && r.token.length > 0
    && typeof r.mint === 'string' && r.mint.length > 0
    && typeof r.frId === 'string' && r.frId.length > 0
    && typeof r.amountSats === 'number' && Number.isSafeInteger(r.amountSats) && r.amountSats > 0
  );
}

/** Undelivered tokens for an identity, newest first. Never throws. */
export function listPendingDeliveries(pubkey: string | null | undefined): PendingDeliveryRecord[] {
  const key = storeKey(pubkey);
  if (!key) return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValid);
  } catch {
    return [];
  }
}

/** Persist an issued token. Deduped by token (re-issuing the same token is
 *  idempotent), bounded. Returns false when it could not be stored - the
 *  caller must then warn the donor not to close the window. `createdAt` is
 *  stamped here (an impure clock read in a component handler trips the
 *  react-compiler purity rule) unless the caller supplies one. */
export function savePendingDelivery(
  pubkey: string | null | undefined,
  record: Omit<PendingDeliveryRecord, 'v' | 'createdAt'> & { v?: 1; createdAt?: number },
): boolean {
  const key = storeKey(pubkey);
  if (!key) return false;
  try {
    const full: PendingDeliveryRecord = { v: 1, createdAt: Date.now(), ...record };
    const existing = listPendingDeliveries(pubkey).filter((r) => r.token !== full.token);
    const next = [full, ...existing].slice(0, MAX_RECORDS);
    localStorage.setItem(key, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

/** Clear one delivered/abandoned record by its token. */
export function removePendingDelivery(pubkey: string | null | undefined, token: string): void {
  const key = storeKey(pubkey);
  if (!key) return;
  try {
    const next = listPendingDeliveries(pubkey).filter((r) => r.token !== token);
    if (next.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(next));
  } catch {
    /* best effort */
  }
}

/** The newest undelivered token for one campaign (modal re-open restore). */
export function pendingDeliveryFor(pubkey: string | null | undefined, frId: string): PendingDeliveryRecord | null {
  return listPendingDeliveries(pubkey).find((r) => r.frId === frId) ?? null;
}
