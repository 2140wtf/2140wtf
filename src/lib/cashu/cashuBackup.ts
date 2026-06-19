/**
 * Simplified Cashu wallet backup over Nostr.
 *
 * The wallet state is encrypted with the user's own NIP-44 signer
 * (self-encryption) and published as a kind 30078 replaceable event.
 */
import { SimplePool, verifyEvent, type Event } from 'nostr-tools';
import type { NostrSigner } from '@nostrify/types';
import { devLog } from '@/lib/cashu/devLog';

export const BACKUP_KIND = 30078;
export const BACKUP_D_TAG = 'freedomid:cashu';

const BACKUP_RELAY_TIMEOUT = 8000;

export interface CashuBackupPayload {
  version: 1;
  timestamp: number;
  epoch: number;
  mints: string[];
  proofs: Array<{ mintUrl: string; proofs: unknown[] }>;
  transactions: Array<{
    id: string;
    type: string;
    amount: number;
    memo: string;
    mintUrl: string;
    status: string;
    createdAt: number;
  }>;
  selectedMintUrl: string;
  customMints?: Array<{ name: string; url: string }>;
}

interface BackupUser {
  pubkey: string;
  signer: NostrSigner;
}

/**
 * Validate that a parsed object matches the CashuBackupPayload shape.
 */
function isValidBackupPayload(parsed: unknown): parsed is CashuBackupPayload {
  if (!parsed || typeof parsed !== 'object') return false;
  const p = parsed as Record<string, unknown>;
  if (
    p.version !== 1 ||
    typeof p.timestamp !== 'number' ||
    !Number.isFinite(p.timestamp) ||
    p.timestamp < 0 ||
    typeof p.epoch !== 'number' ||
    !Number.isFinite(p.epoch) ||
    p.epoch < 0 ||
    !Array.isArray(p.mints) ||
    !p.mints.every((m: unknown) => typeof m === 'string') ||
    !Array.isArray(p.proofs) ||
    !Array.isArray(p.transactions) ||
    typeof p.selectedMintUrl !== 'string'
  ) {
    return false;
  }
  for (const entry of p.proofs) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      typeof (entry as Record<string, unknown>).mintUrl !== 'string' ||
      !Array.isArray((entry as Record<string, unknown>).proofs)
    ) {
      return false;
    }
  }
  for (const t of p.transactions) {
    if (
      !t ||
      typeof t !== 'object' ||
      typeof (t as Record<string, unknown>).id !== 'string' ||
      typeof (t as Record<string, unknown>).type !== 'string' ||
      typeof (t as Record<string, unknown>).amount !== 'number' ||
      typeof (t as Record<string, unknown>).memo !== 'string' ||
      typeof (t as Record<string, unknown>).mintUrl !== 'string' ||
      typeof (t as Record<string, unknown>).status !== 'string' ||
      typeof (t as Record<string, unknown>).createdAt !== 'number'
    ) {
      return false;
    }
  }
  if (p.customMints !== undefined) {
    if (!Array.isArray(p.customMints)) return false;
    for (const m of p.customMints) {
      if (
        !m ||
        typeof m !== 'object' ||
        typeof (m as Record<string, unknown>).name !== 'string' ||
        typeof (m as Record<string, unknown>).url !== 'string'
      ) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Encrypt and publish the Cashu wallet state to Nostr relays.
 * Returns the published event id, or null on failure.
 */
export async function syncCashuState(
  payload: CashuBackupPayload,
  user: BackupUser,
  relayUrls: string[],
  dTag: string = BACKUP_D_TAG,
): Promise<string | null> {
  if (!user?.signer?.nip44?.encrypt) {
    devLog.warn('Cashu sync: signer does not support NIP-44');
    return null;
  }
  if (relayUrls.length === 0) {
    devLog.warn('Cashu sync: no relays configured');
    return null;
  }

  try {
    const plaintext = JSON.stringify(payload);
    const content = await user.signer.nip44.encrypt(user.pubkey, plaintext);

    const template = {
      kind: BACKUP_KIND,
      content,
      tags: [
        ['d', dTag],
        ['client', '2140'],
      ],
      created_at: Math.floor(Date.now() / 1000),
    };

    const event = (await user.signer.signEvent(template)) as Event;

    if (!verifyEvent(event)) {
      devLog.error('Cashu sync: generated event has invalid signature');
      return null;
    }

    const pool = new SimplePool();
    try {
      await Promise.race([
        Promise.any(relayUrls.map((url) => pool.publish([url], event))),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Backup relay timeout')), BACKUP_RELAY_TIMEOUT),
        ),
      ]);
      return event.id;
    } catch (err: unknown) {
      devLog.error('Cashu sync: failed to publish to any relay:', err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      pool.close(relayUrls);
    }
  } catch (err: unknown) {
    devLog.error('Cashu sync error:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Query Nostr relays for the newest encrypted Cashu backup and decrypt it.
 * Returns the payload or null if no valid backup is found.
 */
export async function restoreCashuState(
  user: BackupUser,
  relayUrls: string[],
  dTag: string = BACKUP_D_TAG,
): Promise<CashuBackupPayload | null> {
  if (!user?.signer?.nip44?.decrypt) {
    devLog.warn('Cashu restore: signer does not support NIP-44');
    return null;
  }
  if (relayUrls.length === 0) {
    devLog.warn('Cashu restore: no relays configured');
    return null;
  }

  const pool = new SimplePool();
  let events: Event[] = [];
  try {
    events = await pool.querySync(
      relayUrls,
      {
        kinds: [BACKUP_KIND],
        authors: [user.pubkey],
        '#d': [dTag],
        limit: 20,
      },
      { maxWait: 15000 },
    );
  } catch (err: unknown) {
    devLog.warn('Cashu restore: relay query failed:', err instanceof Error ? err.message : String(err));
    return null;
  } finally {
    pool.close(relayUrls);
  }

  const newest = events
    .filter((ev) => verifyEvent(ev))
    .sort((a, b) => b.created_at - a.created_at)[0];

  if (!newest) {
    devLog.warn('Cashu restore: no valid backup event found');
    return null;
  }

  try {
    const plaintext = await user.signer.nip44.decrypt(user.pubkey, newest.content);
    if (!plaintext) {
      devLog.warn('Cashu restore: NIP-44 decryption returned empty');
      return null;
    }
    const parsed = JSON.parse(plaintext) as unknown;
    if (!isValidBackupPayload(parsed)) {
      devLog.warn('Cashu restore: decrypted payload does not match expected shape');
      return null;
    }
    return parsed;
  } catch (err: unknown) {
    devLog.error('Cashu restore: failed to decrypt backup:', err instanceof Error ? err.message : String(err));
    return null;
  }
}
