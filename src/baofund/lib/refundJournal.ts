/**
 * refundJournal - durable, append-only journal for the rail refund executor
 * (WS-3). One JSON object per line; every write is followed by fsync so an
 * intent (raw tx) survives a crash BEFORE the broadcast is attempted. `read`
 * returns the LAST entry for an id, tolerating a torn trailing line.
 *
 * Node-only (imported by rail scripts + tests), never by the browser bundle.
 */
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RefundJournal, RefundJournalEntry } from './railRefund';

export class FileRefundJournal implements RefundJournal {
  constructor(private readonly path: string) {}

  read(id: string): RefundJournalEntry | null {
    if (!existsSync(this.path)) return null;
    let last: RefundJournalEntry | null = null;
    for (const line of readFileSync(this.path, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as RefundJournalEntry;
        if (entry.id === id) last = entry;
      } catch {
        // A torn/partial trailing line is ignored; earlier durable lines stand.
      }
    }
    return last;
  }

  write(entry: RefundJournalEntry): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const fd = openSync(this.path, 'a');
    try {
      writeSync(fd, `${JSON.stringify(entry)}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
}
