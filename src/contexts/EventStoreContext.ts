import { createContext } from 'react';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

/**
 * The surface every app event store implements. This is the ₿AO chat
 * (Concord V2) foundation's store contract — the wire's plaintext write
 * target and the community list's cache-first boot read.
 *
 * In this client it is backed by the shared `@nostrify/indexeddb` NIndexedDB
 * instance that also backs the relay-pool cache (see
 * `components/NostrProvider.tsx`). Armada backed this interface with a
 * SQLite-WASM worker; that worker was deliberately NOT ported — NIndexedDB
 * satisfies the same contract.
 */
export interface BaoEventStore {
  event(event: NostrEvent, opts?: { signal?: AbortSignal }): Promise<void>;
  query(filters: NostrFilter[], opts?: { signal?: AbortSignal }): Promise<NostrEvent[]>;
  count(filters: NostrFilter[], opts?: { signal?: AbortSignal }): Promise<{ count: number; approximate?: boolean }>;
  remove(filters: NostrFilter[], opts?: { signal?: AbortSignal }): Promise<void>;
  close(): Promise<void>;
}

/**
 * The event store may be opened asynchronously, so the context carries a
 * `Promise<BaoEventStore>` rather than the store itself. Consumers `await`
 * it inside their query functions.
 */
export type EventStoreContextType = Promise<BaoEventStore>;

export const EventStoreContext = createContext<EventStoreContextType | null>(null);
