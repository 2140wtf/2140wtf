/**
 * processLock — single-writer lockfile with pid liveness (node-only).
 *
 * `FileInviteUseLedger` is shared per process (see openFileInviteUseLedger),
 * which stops a HOT RELOAD from opening a second ledger for the same path.
 * It does NOT stop a second welcomer PROCESS from serving the same ledger
 * file: two writers each load the file once, overwrite each other, and both
 * can admit past `maxUses`. Cross-process coordination is out of scope by
 * design, so the cheap guard is a lockfile:
 *
 *   - acquire with O_EXCL (`wx`) — the create is atomic, exactly one winner;
 *   - the file holds the owner pid; a lock whose pid is no longer alive is
 *     STALE (writer crashed) and is taken over;
 *   - a live owner means REFUSE and fail closed: the second writer's room
 *     stays offline rather than double-admitting invites;
 *   - the lock is released on process exit (best effort); a hard crash leaves
 *     a stale lock that the next start detects by pid liveness.
 *
 * Limitations (accepted, documented for operators): pid liveness is
 * per-NODE, not per-host. A ledger file on a shared/network filesystem with
 * a live pid from another host cannot be distinguished from a local one, and
 * pid recycling can make an unrelated process "hold" a crashed writer's
 * lock. Run ONE welcomer per ledger directory (one per ledger file) and keep
 * the directory local to the writer.
 */
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
/** Resolved lock paths held by THIS process. Re-entrant: a second ledger
 *  instance on the same path (tests simulating a restart, the factory after a
 *  hot reload) is allowed — the lockfile only guards other PROCESSES. */
const held = new Set();
let exitHookInstalled = false;
function defaultIsAlive(pid) {
    if (!Number.isSafeInteger(pid) || pid <= 0)
        return false;
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (err) {
        // EPERM = the process exists but we may not signal it → alive.
        return err.code === 'EPERM';
    }
}
/** Atomic exclusive create (O_EXCL) carrying this process's pid. */
function writeLock(lockPath) {
    const fd = openSync(lockPath, 'wx');
    try {
        writeSync(fd, `${process.pid}\n`);
    }
    finally {
        closeSync(fd);
    }
}
/**
 * Acquire the single-writer lock at `lockPath`. Idempotent within one
 * process; throws when another LIVE process holds it.
 */
export function acquireProcessLock(lockPath, opts = {}) {
    const key = resolve(lockPath);
    if (held.has(key))
        return;
    mkdirSync(dirname(key), { recursive: true });
    const isAlive = opts.isAlive ?? defaultIsAlive;
    try {
        writeLock(key);
    }
    catch (err) {
        if (err.code !== 'EEXIST')
            throw err;
        let pid = NaN;
        try {
            pid = Number.parseInt(readFileSync(key, 'utf8').trim(), 10);
        }
        catch {
            // Unreadable lock: fall through to the stale-takeover path. The 'wx'
            // re-create below is still race-safe — exactly one writer wins.
        }
        if (Number.isFinite(pid) && isAlive(pid)) {
            throw new Error(`another process (pid ${pid}) holds ${key} — refusing a second writer (run one welcomer per ledger file)`);
        }
        rmSync(key, { force: true });
        writeLock(key); // a concurrent racer surfaces as EEXIST to its own call
    }
    held.add(key);
    if (!exitHookInstalled) {
        exitHookInstalled = true;
        process.once('exit', () => {
            for (const path of held) {
                try {
                    rmSync(path, { force: true });
                }
                catch {
                    /* best effort — a stale lock is recovered by pid liveness */
                }
            }
        });
    }
}
