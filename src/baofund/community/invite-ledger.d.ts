import { type InviteLedger } from './welcomer-core.js';
/**
 * Injectable filesystem surface (default: node:fs). Tests inject a failing
 * layer to prove the fail-closed commit ordering; operators may supply a
 * hardened wrapper (e.g. an audited fd layer) without forking the ledger.
 */
export interface LedgerFs {
    existsSync(path: string): boolean;
    statSync(path: string): {
        size: number;
    };
    readFileSync(path: string, encoding: 'utf8'): string;
    mkdirSync(path: string, opts: {
        recursive: true;
    }): void;
    openSync(path: string, flags: string): number;
    writeSync(fd: number, data: string): number;
    fsyncSync(fd: number): void;
    closeSync(fd: number): void;
    renameSync(oldPath: string, newPath: string): void;
}
export interface FileInviteUseLedgerOptions {
    /** Max distinct lids persisted (default 10_000). Past it, commits fail
     *  closed with InviteLedgerWriteError (capacity) — never an unpersisted
     *  admission. */
    maxEntries?: number;
    /** Max accepted file size in bytes at load (default 4 MiB). */
    maxBytes?: number;
    /** Filesystem layer (default node:fs). */
    fs?: LedgerFs;
}
export declare class FileInviteUseLedger implements InviteLedger {
    private readonly committed;
    private readonly pending;
    private readonly maxEntries;
    private readonly maxBytes;
    private readonly fs;
    readonly path: string;
    constructor(path: string, opts?: FileInviteUseLedgerOptions);
    count(lid: string): number;
    reserve(lid: string, maxUses: number): boolean;
    release(lid: string): void;
    /**
     * Finalize a reservation and PERSIST it — called BEFORE the wrap publish.
     * The write is staged: memory is mutated only after the durable rename
     * succeeds, so a failed write leaves the instance in the same state a
     * restart would load (use not committed) and the caller's release+retry
     * works. At `maxEntries` capacity the staged size would exceed the bound:
     * nothing is persisted or mutated and a reason='capacity' error is thrown.
     * Throws InviteLedgerWriteError on failure; the caller publishes nothing
     * and returns a retryable rejection (fail closed).
     */
    commit(lid: string): void;
    /**
     * Undo a commit whose wrap was never published. Persists the decrement so a
     * restart sees the invite as unused again. If the decrement write fails the
     * durable file still counts the use and we DO NOT throw: the use stays
     * consumed — fail closed (the wrap did not publish, so this is an
     * over-rejection, never an over-admission).
     */
    rollbackCommit(lid: string): void;
    /** Distinct lids with a persisted committed count (introspection). */
    get size(): number;
    /** Atomic write: temp file + fsync + rename. */
    private persist;
}
/**
 * Process-wide factory used by the welcomer daemon: ONE ledger instance per
 * resolved path. Hot reload stops the old runner and starts a new one in the
 * SAME process; if each built its own instance, an in-flight reservation in
 * the old runner would be invisible to the new one and both could admit past
 * `maxUses` (the file would even end up at the same count). Sharing the
 * instance makes reservations visible across the swap. `opts` apply only to
 * the first open of a path.
 *
 * Cross-process coordination is out of scope: run ONE welcomer per ledger
 * file. The constructor's pid lockfile refuses a second live writer; the lock
 * is a fail-closed guard, not distributed consensus.
 */
export declare function openFileInviteUseLedger(path: string, opts?: FileInviteUseLedgerOptions): FileInviteUseLedger;
