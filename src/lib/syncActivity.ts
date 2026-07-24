/**
 * Sync-activity signal — named catch-up tasks the UI can report honestly
 * ("Syncing #general — 84 messages") instead of a vague global spinner.
 *
 * Post-login cold starts and wakes from background trigger a burst of
 * background work (control/guestbook plane sweeps, per-channel history
 * backfills, the login warm-up) with no user-visible completion signal of its
 * own. Each of those paths registers a task via {@link beginSyncTask},
 * updates its progress detail as data lands, and ends it in a `finally`.
 * The in-chat status bar renders whatever is in flight.
 *
 * Deliberately NOT pulsed by the wire's standing live subscription — a
 * long-lived REQ streaming zero new events is not "syncing", and reporting it
 * made the indicator a false positive. Only paths that page real history
 * register tasks.
 *
 * Style mirrors the wire bus (src/wire/bus.ts): module-level state, plain
 * listener set, a test reset. Fast bursts are expected — the UI debounces
 * with useDelayedFlag so sub-second syncs never paint an indicator.
 */

export interface SyncTask {
  /** Monotonic task id (insertion order == start order). */
  id: number;
  /** What's being synced — e.g. `#general`, `community updates`, `message history`. */
  label: string;
  /** Live progress detail — e.g. `84 messages`, `3/12 channels`. */
  detail?: string;
  /**
   * Optional conversation scope in wire-bus grammar (e.g. `c2:<channelIdHex>`),
   * so views can tell whether a task concerns the conversation on screen.
   */
  scope?: string;
}

/** The handle a catch-up path holds while its task is in flight. */
export interface SyncTaskHandle {
  /** Update the task's visible label/detail as progress lands. */
  update(patch: { label?: string; detail?: string }): void;
  /** Finish the task. Idempotent — safe to call from `finally` plus early-outs. */
  end(): void;
}

type SyncActivityListener = () => void;

let nextId = 1;
const tasks = new Map<number, SyncTask>();
const listeners = new Set<SyncActivityListener>();
/** Cached immutable snapshot so useSyncExternalStore gets a stable reference. */
let snapshot: readonly SyncTask[] = [];

function notify(): void {
  snapshot = [...tasks.values()];
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // A listener must never break the signal for the others.
    }
  }
}

/** Register one catch-up task. End it in a `finally` so failures can't leak it. */
export function beginSyncTask(label: string, opts?: { scope?: string }): SyncTaskHandle {
  const id = nextId++;
  tasks.set(id, { id, label, scope: opts?.scope });
  notify();
  return {
    update(patch) {
      const current = tasks.get(id);
      if (!current) return;
      tasks.set(id, { ...current, ...patch });
      notify();
    },
    end() {
      if (tasks.delete(id)) notify();
    },
  };
}

/** The tasks currently in flight, oldest first. Stable reference between changes. */
export function getSyncTasks(): readonly SyncTask[] {
  return snapshot;
}

/** Subscribe to task-set changes. Returns an unsubscribe. */
export function onSyncActivity(listener: SyncActivityListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test helper: drop all tasks and listeners. */
export function resetSyncActivity(): void {
  tasks.clear();
  snapshot = [];
  listeners.clear();
}
