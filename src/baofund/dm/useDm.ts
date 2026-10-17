/**
 * useDm - React wiring for the text-DM lane (deliverable D).
 *
 * Scope + fail-closed rules:
 *   - DMs ride the NIP-17 lane on the fund relay via DmTransport. Both SEND
 *     and RECEIVE need the identity's raw secret key (buildDmWrap/openDmWrap),
 *     which this browser only holds for a SEED-PHRASE identity (including an
 *     at-rest-unlocked seed session). Extension / remote-signer / passkey
 *     identities keep the key outside the page - the panel shows that state
 *     explicitly instead of faking a lane it cannot operate.
 *   - Signed-out guests get `access: 'signed-out'` (the panel renders the
 *     app's standard sign-in prompt).
 *   - The transport instance is keyed to the identity: an identity change
 *     stops the old subscription before starting the new one (chat identity
 *     binding rule). Selection/connection state is keyed to the identity too,
 *     so a switch can never show the previous identity's thread.
 *   - Message content is never logged anywhere in this path.
 */

import React from 'react';
import { hexToBytes } from '@noble/hashes/utils.js';
import { useAuth } from '../auth/useAuth';
import { baoRelayUrl } from '../lib/baoFundraising';
import { errorMessage } from '../lib/errors';
import {
  DM_MAX_TEXT,
  EMPTY_DM_SNAPSHOT,
  dmSlotKey,
  dmSnapshot,
  markThreadRead,
  onDmStoreChange,
  type DmThread,
} from './dmStore';
import { DmTransport, type DmConnectionState } from './dmTransport';

export type DmAccess = 'signed-out' | 'no-local-key' | 'ready';

export interface DmController {
  access: DmAccess;
  /** The sign-in method's constraint copy when access is 'no-local-key'. */
  accessDetail: string | null;
  threads: DmThread[];
  unread: number;
  activePeer: string | null;
  selectThread: (peer: string | null) => void;
  sending: boolean;
  send: (peer: string, text: string) => Promise<void>;
  error: string | null;
  connection: DmConnectionState;
  relayUrl: string;
  maxTextLength: number;
}

export function useDm(): DmController {
  const auth = useAuth();
  const pubkey = auth.status === 'ready' ? auth.pubkey : null;
  // Raw identity hex exists only for seed sessions this browser holds
  // (including at-rest-unlocked ones); extension/remote/passkey sessions
  // return null and stay read-only.
  const secretHex = pubkey && auth.method === 'seed' ? auth.seedIdentityHex() : null;

  const [selection, setSelection] = React.useState<{ pubkey: string; peer: string | null } | null>(null);
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [connectionState, setConnectionState] = React.useState<{ pubkey: string; state: DmConnectionState } | null>(null);

  // Identity-keyed derivations: a switch can never leak the previous
  // identity's selection or connection state into the new one.
  const activePeer = pubkey && selection?.pubkey === pubkey ? selection.peer : null;
  const connection: DmConnectionState = pubkey && connectionState?.pubkey === pubkey ? connectionState.state : 'stopped';
  const relayUrl = React.useMemo(() => baoRelayUrl(), []);

  // Store subscription via useSyncExternalStore: `dmSnapshot` returns a
  // CACHED object per identity, invalidated by every local write - stable
  // between writes (no render loop) and fresh on change.
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      const off = onDmStoreChange((changed) => {
        if (changed === pubkey?.toLowerCase()) onChange();
      });
      return off;
    },
    [pubkey],
  );
  const getSnapshot = React.useCallback(() => (pubkey ? dmSnapshot(pubkey) : EMPTY_DM_SNAPSHOT), [pubkey]);
  const { threads, unread } = React.useSyncExternalStore(subscribe, getSnapshot);

  const activePeerRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    activePeerRef.current = activePeer;
  }, [activePeer]);

  // Identity binding: one transport per identity + key. The previous
  // transport is torn down by the effect cleanup BEFORE the next starts.
  const transportRef = React.useRef<DmTransport | null>(null);
  React.useEffect(() => {
    if (!pubkey || !secretHex) return;
    const transport = new DmTransport({
      relayUrl,
      onIncoming: (record) => {
        if (record.peer === activePeerRef.current) {
          markThreadRead(pubkey, record.peer);
        }
      },
      onState: (state) => setConnectionState({ pubkey, state }),
    });
    transport.start(pubkey, hexToBytes(secretHex));
    transportRef.current = transport;
    return () => {
      transport.stop();
      if (transportRef.current === transport) transportRef.current = null;
    };
  }, [pubkey, secretHex, relayUrl]);

  const selectThread = React.useCallback(
    (peer: string | null) => {
      if (!pubkey) return;
      if (peer !== null && !dmSlotKey(peer)) return;
      setSelection({ pubkey, peer });
      if (peer) markThreadRead(pubkey, peer);
    },
    [pubkey],
  );

  const send = React.useCallback(
    async (peer: string, text: string) => {
      const transport = transportRef.current;
      if (!transport || !pubkey) {
        setError('Direct messages are unavailable for this sign-in method.');
        throw new Error('dm: no local identity key for this sign-in method');
      }
      setSending(true);
      setError(null);
      try {
        await transport.send(peer, text);
      } catch (e) {
        setError(errorMessage(e));
        throw e;
      } finally {
        setSending(false);
      }
    },
    [pubkey],
  );

  const accessDetail = !pubkey
    ? null
    : auth.method === 'nip07'
      ? 'Signed in with a browser extension - its key stays in the extension, so this browser cannot build or open encrypted DMs.'
      : auth.method === 'nip46'
        ? 'Signed in with a remote signer - its key stays on the signer, so this browser cannot build or open encrypted DMs.'
        : 'Signed in with a passkey identity - DMs need a seed-phrase identity this browser can hold.';

  return {
    access: !pubkey ? 'signed-out' : secretHex ? 'ready' : 'no-local-key',
    accessDetail: secretHex ? null : accessDetail,
    threads,
    unread,
    activePeer,
    selectThread,
    sending,
    send,
    error,
    connection,
    relayUrl,
    maxTextLength: DM_MAX_TEXT,
  };
}
