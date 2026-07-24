import { useEffect } from "react";

/**
 * A tiny module-level bus that lets any component ask the active chat composer
 * to start a bot command. The same shape as the mention bus, and for the same
 * reason: it avoids threading a callback down through page → chat → message row.
 *
 * Starting a command means seeding the draft with `/name` and focusing it, which
 * is exactly what typing the slash does — so the picker opens itself, already
 * filtered, and there is only one code path into it rather than two that could
 * drift apart.
 *
 * The composer subscribes via `useCommandRequests`; callers (a command line in
 * the timeline) fire `requestCommand(name)`.
 */
type CommandListener = (name: string) => void;

const listeners = new Set<CommandListener>();

/** Ask the active composer to start `/name`. False when no composer is mounted. */
export function requestCommand(name: string): boolean {
  for (const listener of listeners) listener(name);
  return listeners.size > 0;
}

/** Subscribe the active composer's command starter to those requests. */
export function useCommandRequests(start: (name: string) => void) {
  useEffect(() => {
    listeners.add(start);
    return () => {
      listeners.delete(start);
    };
  }, [start]);
}
