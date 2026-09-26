/**
 * invite-ledger — durable invite-use ledger (node-only, JOIN-01/P5).
 *
 * The welcomer's invite-v2 enforcement (`maxUses`) lives in
 * `WelcomerJoinState` + an injected `InviteLedger`. The in-memory default
 * (welcomer-core.ts) resets on daemon restart, reopening every consumed
 * invite; this file-backed implementation makes consumption durable.
 *
 * Contract (see InviteLedger in welcomer-core.ts):
 *   - `reserve` is SYNCHRONOUS and in-memory only (a reservation that never
 *     becomes a join must vanish without a write).
 *   - `commit` is called by `publishJoinWrap` BEFORE the wrap publish (the
 *     wrap IS the admission, so a durable write that fails afterwards would
 *     already have admitted a use a restart reopens). It moves the
 *     reservation to the committed count and PERSISTS; when the write fails —
 *     including when `maxEntries` is reached and the use therefore cannot be
 *     persisted — it throws `InviteLedgerWriteError`, leaving BOTH the file
 *     and the in-memory state exactly as a restart would load them (the use
 *     is not committed). The caller then publishes nothing and returns the
 *     typed, retryable rejection.
 *   - `rollbackCommit` undoes a commit whose publish subsequently failed, so
 *     the client's retry can still admit. If THIS write fails too, the use
 *     stays durably consumed: fail closed — a burned invite is safe, an
 *     invite that reopens after a restart is not.
 *   - `release` drops a pending reservation (later-gate rejection); committed
 *     uses are never released by it.
 *
 * Durability discipline (mirrors admissionLog.ts):
 *   - ATOMIC writes: temp file + fsync + rename, so a crash mid-write can
 *     never leave a torn ledger (the old file stays valid).
 *   - CORRUPTION-REFUSING load: unreadable/oversized/malformed/unknown-
 *     version files THROW. The welcomer treats that as fail-closed (room
 *     offline) rather than silently starting from zero and reopening used
 *     invites. The corrupt bytes are never rewritten.
 *   - BOUNDED + FAIL-CLOSED AT CAPACITY: `maxBytes` caps what load will
 *     read; `maxEntries` caps how many distinct lids are persisted. Past the
 *     cap a commit CANNOT persist, so it throws `InviteLedgerWriteError`
 *     (reason 'capacity') instead of admitting a use that lives only in
 *     memory: the caller releases the reservation, publishes nothing, and
 *     the join fails with the typed retryable `'ledger-error'`. A restart
 *     can therefore never reopen a use that was admitted at capacity.
 *     Eviction is deliberately NOT implemented — every persisted lid has
 *     count >= 1, so evicting one reopens a consumed invite; the bounded
 *     invariant "a consumed lid is never reopened" outranks availability.
 *     Recovery is operator-driven: roll back a committed-but-unpublished use
 *     (frees its lid) or reopen the ledger with a larger `maxEntries`; a
 *     room at the cap stays offline rather than degrade.
 *
 * Single writer: the constructor takes a pid lockfile (`<ledger>.lock`) via
 * processLock.ts. A second live PROCESS on the same ledger file is refused
 * (the room stays offline) instead of double-admitting. In-process instances
 * share the lock (test restart simulations and hot reloads); the daemon shares ONE
 * instance per path through `openFileInviteUseLedger`. Cross-process
 * enforcement is therefore "one welcomer per ledger file"; the lock is a
 * guard, not distributed consensus — keep the ledger directory local.
 *
 * This module imports node:fs and is therefore NOT re-exported from the
 * browser entrypoint (browser.ts). The pure contract stays in
 * welcomer-core.ts.
 */
import { existsSync, statSync, readFileSync, mkdirSync, openSync, writeSync, fsyncSync, closeSync, renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { InviteLedgerWriteError } from './welcomer-core.js';
import { acquireProcessLock } from './processLock.js';
/** On-disk schema version. Unknown versions are refused, never guessed. */
const LEDGER_VERSION = 1;
const nodeLedgerFs = {
    existsSync: (p) => existsSync(p),
    statSync: (p) => statSync(p),
    readFileSync: (p, enc) => readFileSync(p, enc),
    mkdirSync: (p, o) => mkdirSync(p, o),
    openSync: (p, f) => openSync(p, f),
    writeSync: (fd, d) => writeSync(fd, d),
    fsyncSync: (fd) => fsyncSync(fd),
    closeSync: (fd) => closeSync(fd),
    renameSync: (a, b) => renameSync(a, b),
};
function corrupt(path, why) {
    return new Error(`invite ledger corrupt: ${path} ${why}`);
}
/** Parse + validate a ledger file. Throws on anything that is not exactly a
 *  v1 ledger — callers fail closed instead of starting empty. */
function loadLedger(fs, path, maxBytes, maxEntries) {
    const out = new Map();
    if (!fs.existsSync(path))
        return out; // fresh ledger
    const size = fs.statSync(path).size;
    if (size > maxBytes)
        throw corrupt(path, `exceeds ${maxBytes} bytes (size ${size})`);
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(path, 'utf8'));
    }
    catch {
        throw corrupt(path, 'is not valid JSON');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw corrupt(path, 'is not a JSON object');
    }
    const obj = parsed;
    if (obj.v !== LEDGER_VERSION)
        throw corrupt(path, `has unsupported version ${String(obj.v)}`);
    if (typeof obj.uses !== 'object' || obj.uses === null || Array.isArray(obj.uses)) {
        throw corrupt(path, 'is missing a "uses" object');
    }
    for (const [lid, n] of Object.entries(obj.uses)) {
        if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) {
            throw corrupt(path, `has an invalid count for lid ${JSON.stringify(lid)}`);
        }
        out.set(lid, n);
    }
    if (out.size > maxEntries)
        throw corrupt(path, `has ${out.size} entries (max ${maxEntries})`);
    return out;
}
export class FileInviteUseLedger {
    constructor(path, opts = {}) {
        this.pending = new Map();
        this.path = path;
        this.maxEntries = opts.maxEntries ?? 10_000;
        this.maxBytes = opts.maxBytes ?? 4 * 1024 * 1024;
        this.fs = opts.fs ?? nodeLedgerFs;
        this.committed = loadLedger(this.fs, path, this.maxBytes, this.maxEntries);
        // Single-writer guard: a second live process on this ledger file is
        // refused (fail closed) BEFORE it can load-then-overwrite the counts.
        // Load runs first so a corrupt file refuses without leaving a lock.
        acquireProcessLock(`${path}.lock`);
    }
    count(lid) {
        return (this.committed.get(lid) ?? 0) + (this.pending.get(lid) ?? 0);
    }
    reserve(lid, maxUses) {
        if (this.count(lid) >= maxUses)
            return false;
        this.pending.set(lid, (this.pending.get(lid) ?? 0) + 1);
        return true;
    }
    release(lid) {
        const n = this.pending.get(lid) ?? 0;
        if (n > 0)
            this.pending.set(lid, n - 1);
    }
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
    commit(lid) {
        const n = this.pending.get(lid) ?? 0;
        if (n <= 0)
            return;
        const staged = new Map(this.committed);
        staged.set(lid, (staged.get(lid) ?? 0) + 1);
        if (staged.size > this.maxEntries) {
            // Bounded, fail closed: at the cap this commit CANNOT persist, so it
            // must not admit either. Memory is left untouched (the reservation
            // stays and the caller releases it), nothing is written, and the
            // caller's publishJoinWrap maps this to the typed retryable
            // 'ledger-error'. Admitting here would create a use that only exists
            // in this process — a restart reopens the invite. Eviction is not an
            // option: every persisted lid is consumed, so evicting one reopens it.
            throw new InviteLedgerWriteError(lid, `invite ledger at capacity (${this.committed.size}/${this.maxEntries} entries) for lid ${JSON.stringify(lid)} (${this.path}) — refusing to admit an unpersisted use`, 'capacity');
        }
        try {
            this.persist(staged);
        }
        catch (err) {
            // Memory untouched: the use is NOT committed anywhere, so the caller
            // can release the reservation and the retry can admit after recovery.
            throw new InviteLedgerWriteError(lid, `invite ledger write failed for lid ${JSON.stringify(lid)} (${this.path}): ${err.message}`);
        }
        this.pending.set(lid, n - 1);
        this.committed.set(lid, staged.get(lid));
    }
    /**
     * Undo a commit whose wrap was never published. Persists the decrement so a
     * restart sees the invite as unused again. If the decrement write fails the
     * durable file still counts the use and we DO NOT throw: the use stays
     * consumed — fail closed (the wrap did not publish, so this is an
     * over-rejection, never an over-admission).
     */
    rollbackCommit(lid) {
        const c = this.committed.get(lid) ?? 0;
        if (c <= 0)
            return;
        // A rollback only ever shrinks the set: `committed` can never exceed the
        // cap because commit() refuses before persisting, so this write is always
        // within bounds and can free a distinct lid for a retry.
        const staged = new Map(this.committed);
        if (c === 1)
            staged.delete(lid);
        else
            staged.set(lid, c - 1);
        try {
            this.persist(staged);
        }
        catch (err) {
            console.error(`[invite-ledger] rollback persist failed (${err.message}) — lid ${JSON.stringify(lid)} stays durably consumed (fail closed)`);
            return;
        }
        if (c === 1)
            this.committed.delete(lid);
        else
            this.committed.set(lid, c - 1);
    }
    /** Distinct lids with a persisted committed count (introspection). */
    get size() {
        return this.committed.size;
    }
    /** Atomic write: temp file + fsync + rename. */
    persist(committed) {
        const file = { v: LEDGER_VERSION, uses: Object.fromEntries(committed) };
        const payload = JSON.stringify(file);
        this.fs.mkdirSync(dirname(this.path), { recursive: true });
        const tmp = `${this.path}.tmp`;
        const fd = this.fs.openSync(tmp, 'w');
        try {
            this.fs.writeSync(fd, payload);
            this.fs.fsyncSync(fd);
        }
        finally {
            this.fs.closeSync(fd);
        }
        this.fs.renameSync(tmp, this.path);
    }
}
/** Process-wide open ledgers, keyed by resolved path. */
const sharedLedgers = new Map();
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
export function openFileInviteUseLedger(path, opts = {}) {
    const key = resolve(path);
    let ledger = sharedLedgers.get(key);
    if (!ledger) {
        ledger = new FileInviteUseLedger(path, opts);
        sharedLedgers.set(key, ledger);
    }
    return ledger;
}
