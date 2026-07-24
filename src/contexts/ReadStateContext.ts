import { createContext } from "react";

/** Map of conversation id → last-read timestamp (unix seconds). */
export type ReadStateMap = Record<string, number>;

export interface ReadStateContextType {
  /** The whole read-state map (reactive). */
  readState: ReadStateMap;
  /** Last-read unix timestamp for a conversation, or 0 if never read. */
  getLastRead: (key: string) => number;
  /**
   * Mark a conversation read up to `timestamp` (unix seconds). No-ops if the
   * stored value is already >= timestamp. Persists locally and syncs to the
   * user's encrypted settings (debounced).
   */
  markRead: (key: string, timestamp: number) => void;
  /** Replace the entire map (used when hydrating from synced settings). */
  hydrate: (map: ReadStateMap) => void;
}

/** Stable conversation key for a NIP-29 channel. */
export function channelReadKey(relayUrl: string, groupId: string): string {
  return `${relayUrl}::${groupId}`;
}

/** Stable conversation key for a direct-message thread. */
export function dmReadKey(pubkey: string): string {
  return `dm:${pubkey}`;
}

export const ReadStateContext = createContext<ReadStateContextType | undefined>(undefined);
