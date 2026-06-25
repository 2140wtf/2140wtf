import type { NPool, NostrEvent } from '@nostrify/nostrify';

import { BATTLE_SYNC_KIND } from './battleMessages';

export interface BattleNetworkOptions {
  nostr: NPool;
  battleId: string;
  opponentPubkey: string;
  since: number;
  onMessage: (event: NostrEvent) => void;
  signal?: AbortSignal;
}

/**
 * Subscribe to live ephemeral battle-sync events from a single opponent.
 *
 * Returns a cleanup function that aborts the subscription.
 */
export function subscribeBattleMessages(options: BattleNetworkOptions): () => void {
  const { nostr, battleId, opponentPubkey, since, onMessage, signal } = options;
  const ac = new AbortController();
  if (signal) {
    signal.addEventListener('abort', () => ac.abort(), { once: true });
  }

  let alive = true;

  (async () => {
    try {
      for await (const msg of nostr.req(
        [
          {
            kinds: [BATTLE_SYNC_KIND],
            authors: [opponentPubkey],
            '#e': [battleId],
            since,
            limit: 0,
          },
        ],
        { signal: ac.signal },
      )) {
        if (!alive) break;
        if (msg[0] === 'EVENT') {
          onMessage(msg[2]);
        } else if (msg[0] === 'CLOSED') {
          break;
        }
      }
    } catch {
      // Abort expected on cleanup.
    }
  })();

  return () => {
    alive = false;
    ac.abort();
  };
}
