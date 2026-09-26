export interface ProcessLockOptions {
    /** Liveness probe for the lock owner pid (default: signal 0 probe). */
    isAlive?: (pid: number) => boolean;
}
/**
 * Acquire the single-writer lock at `lockPath`. Idempotent within one
 * process; throws when another LIVE process holds it.
 */
export declare function acquireProcessLock(lockPath: string, opts?: ProcessLockOptions): void;
