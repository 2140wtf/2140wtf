/**
 * FileRefundJournal - durability fixtures: last-write-wins per id, unknown ids
 * null, and a torn trailing line does not lose earlier entries (the crash
 * between broadcast and completion record depends on this).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileRefundJournal } from './refundJournal';
import type { RefundJournalEntry } from './railRefund';

const dirs: string[] = [];
function tmpJournal(): { journal: FileRefundJournal; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'refund-journal-'));
  dirs.push(dir);
  const path = join(dir, 'nested', 'refund.ndjson');
  return { journal: new FileRefundJournal(path), path };
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const entry = (over: Partial<RefundJournalEntry>): RefundJournalEntry => ({
  id: 'tx:0',
  rail: 'btc-testnet4',
  depositTxid: 'd'.repeat(64),
  vout: 0,
  amountSats: 1000,
  status: 'intent',
  at: 1,
  ...over,
});

describe('FileRefundJournal', () => {
  it('returns the LAST entry for an id and null for unknown ids', () => {
    const { journal: j } = tmpJournal();
    expect(j.read('tx:0')).toBeNull();
    j.write(entry({ status: 'intent', rawTxHex: 'raw' }));
    j.write(entry({ status: 'broadcast', txid: 'txid-1' }));
    expect(j.read('tx:0')).toMatchObject({ status: 'broadcast', txid: 'txid-1' });
    expect(j.read('other')).toBeNull();
  });

  it('survives a torn trailing line (append-only crash safety)', () => {
    const { journal: j, path } = tmpJournal();
    j.write(entry({ status: 'intent', rawTxHex: 'raw' }));
    appendFileSync(path, '{"id":"tx:0","status":"broa');
    expect(j.read('tx:0')).toMatchObject({ status: 'intent', rawTxHex: 'raw' });
  });
});
