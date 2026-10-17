/**
 * useDmCalls - React wiring for the DM call layer (ADR-dm-calls phase 3).
 *
 * The provider owns ONE always-on call lane per signed-in identity: DM call
 * rings must arrive while the DM panel is closed and on every tab, so unlike
 * the text panel (which subscribes only while open) this lane stays live for
 * the whole session. Relay replays are harmless: text records dedupe by wrap
 * id in the store, call signals dedupe by wrap id in the session's seen set.
 *
 * Access rules (mirror useDm):
 *   - guests (no signer) CANNOT place or receive calls - access stays
 *     'signed-out' and no transport is created;
 *   - extension / remote-signer / passkey identities cannot build or open
 *     NIP-17 wraps in this browser (`no-local-key`) - no transport;
 *   - only a seed-phrase identity this browser holds gets a live lane.
 *
 * Lifecycle shape: the session + transport pair is created lazily during
 * render (keyed by identity) and STARTED/stopped in an effect - no
 * setState-in-effect, and an identity switch swaps the pair atomically
 * because both the pair and the `useSyncExternalStore` callbacks are keyed
 * to the same identity string.
 *
 * The session receives raw lane payloads through the transport's
 * `onLanePayload` sink (it reads the call schema AND the raw epk/nonce
 * extras there - parseCallSignal drops unknown fields by design).
 *
 * Follows oracle: this app ships no follows graph yet, so `whoMayRing`
 * follows/mutuals evaluate FAIL CLOSED (nobody rings) until a follows source
 * is wired - the Settings copy states this explicitly.
 */

import React from 'react';
import { hexToBytes } from '@noble/hashes/utils.js';
import { useAuth } from '../auth/useAuth';
import { baoRelayUrl } from '../lib/baoFundraising';
import { DmTransport } from './dmTransport';
import { DmCallRings } from './DmCallRings';
import { DmCallSession, type DmCallMediaState, type DmCallPhase, type DmCallRole } from './dmCallSession';
import { joinDmCallMedia } from './dmCallMedia';
import { loadDmCallGuard, saveDmCallGuard } from './dmCallGuard';
import {
  EMPTY_DM_CALL_SNAPSHOT,
  DM_CALL_SEEN_LIMIT,
  addDmCallBlock,
  appendDmCallLog,
  dmCallSnapshot,
  isDmCallBlocked,
  loadDmCallPolicy,
  loadDmCallSeen,
  onDmCallStoreChange,
  removeDmCallBlock,
  saveDmCallPolicy,
  saveDmCallSeen,
  type DmCallLogEntry,
  type DmCallPolicy,
} from './dmCallStore';

export type DmCallsAccess = 'signed-out' | 'no-local-key' | 'ready';

export interface DmCallsController {
  access: DmCallsAccess;
  phase: DmCallPhase;
  /** Counterparty pubkey while a call state is active. */
  peer: string | null;
  callId: string | null;
  since: number | null;
  answeredAt: number | null;
  role: DmCallRole | null;
  error: string | null;
  /** Media state: off = signaling only, connecting = SFU join in flight,
   *  live = E2EE media connected. */
  media: DmCallMediaState;
  muted: boolean;
  participantCount: number;
  toggleMute: () => Promise<boolean>;
  policy: DmCallPolicy;
  blocks: string[];
  log: DmCallLogEntry[];
  setPolicy: (patch: Partial<Pick<DmCallPolicy, 'callsEnabled' | 'missedNotice' | 'whoMayRing'>>) => void;
  block: (peer: string) => void;
  unblock: (peer: string) => void;
  startCall: (peer: string) => Promise<boolean>;
  accept: () => Promise<boolean>;
  decline: () => void;
  blockAndDecline: () => void;
  cancel: () => void;
  hangup: () => void;
  clearError: () => void;
}

const IDLE_SNAPSHOT = {
  phase: 'idle' as DmCallPhase,
  peer: null,
  callId: null,
  since: null,
  answeredAt: null,
  role: null,
  error: null,
  media: 'off' as DmCallMediaState,
  muted: true,
  participantCount: 0,
};

/** The voice broker origin (same env the room voice bar reads). Read at CALL
 *  time so a host without the env fails closed with the standard copy. */
function voiceBrokerOrigin(): string | null {
  return (import.meta.env as Record<string, string | undefined>).VITE_VOICE_BROKER_URL ?? null;
}

const NOOP_UNSUBSCRIBE = (): void => {
  /* no lane for this session */
};

interface DmCallRuntime {
  session: DmCallSession;
  transport: DmTransport;
}

/** Build the session + transport pair for one identity and secret key. */
function createRuntime(pubkey: string, secretHex: string, relayUrl: string): DmCallRuntime {
  const seen = new Set<string>(loadDmCallSeen(pubkey));
  const persistSeen = (): void => {
    while (seen.size > DM_CALL_SEEN_LIMIT) {
      const oldest = seen.values().next().value;
      if (oldest === undefined) break;
      seen.delete(oldest);
    }
    saveDmCallSeen(pubkey, [...seen]);
  };
  const transport = new DmTransport({
    relayUrl,
    onLanePayload: (payload, envelope) => session.handleLanePayload(payload, envelope),
  });
  const session = new DmCallSession({
    me: pubkey,
    now: () => Math.floor(Date.now() / 1000),
    send: (peer, payload) => transport.sendPayload(peer, payload),
    getPolicy: () => loadDmCallPolicy(pubkey),
    isBlocked: (peer) => isDmCallBlocked(pubkey, peer),
    addBlock: (peer) => {
      addDmCallBlock(pubkey, peer);
    },
    // No follows graph ships in this app yet: fail closed.
    follows: () => ({ followed: false, mutual: false }),
    loadGuard: () => loadDmCallGuard(pubkey),
    saveGuard: (state) => {
      saveDmCallGuard(pubkey, state);
    },
    appendLog: (entry) => {
      appendDmCallLog(pubkey, entry);
    },
    seenHas: (wrapId) => seen.has(wrapId),
    seenAdd: (wrapId) => {
      if (seen.has(wrapId)) return;
      seen.add(wrapId);
      persistSeen();
    },
    sendNotice: async (peer, text) => {
      await transport.send(peer, text);
    },
    // Phase 4: on accept, mint the SFU token for the derived call room and
    // join the E2EE media stack (same broker + LiveKit as room voice). The
    // broker origin is read per join; a host without VITE_VOICE_BROKER_URL
    // fails closed with the same copy the room call bar uses.
    mediaJoin: async (input) => await joinDmCallMedia(input, { brokerOrigin: voiceBrokerOrigin() }),
  });
  return { session, transport };
}

function useDmCallsShell(pubkey: string | null, secretHex: string | null): DmCallsController {
  const relayUrl = React.useMemo(() => baoRelayUrl(), []);
  const access: DmCallsAccess = !pubkey ? 'signed-out' : secretHex ? 'ready' : 'no-local-key';

  // The session + transport pair is CONSTRUCTED here (pure: no socket, no
  // write - only a localStorage read of the seen set) and STARTED in the
  // effect below; an identity change recomputes the pair, and the effect's
  // cleanup stops the previous one before the next starts.
  const runtime = React.useMemo(
    () => (pubkey && secretHex ? createRuntime(pubkey, secretHex, relayUrl) : null),
    [pubkey, secretHex, relayUrl],
  );
  React.useEffect(() => {
    if (!runtime || !pubkey || !secretHex) return undefined;
    runtime.transport.start(pubkey, hexToBytes(secretHex));
    return () => {
      runtime.session.stop();
      runtime.transport.stop();
    };
  }, [runtime, pubkey, secretHex]);

  const sessionSubscribe = React.useCallback(
    (onChange: () => void) => runtime?.session.subscribe(onChange) ?? NOOP_UNSUBSCRIBE,
    [runtime],
  );
  const sessionSnapshot = React.useCallback(
    () => runtime?.session.getSnapshot() ?? IDLE_SNAPSHOT,
    [runtime],
  );
  const callState = React.useSyncExternalStore(sessionSubscribe, sessionSnapshot);

  const storeSubscribe = React.useCallback(
    (onChange: () => void) =>
      onDmCallStoreChange((changed) => {
        if (changed === pubkey) onChange();
      }),
    [pubkey],
  );
  const storeSnapshot = React.useCallback(
    () => (pubkey ? dmCallSnapshot(pubkey) : EMPTY_DM_CALL_SNAPSHOT),
    [pubkey],
  );
  const store = React.useSyncExternalStore(storeSubscribe, storeSnapshot);

  const setPolicy = React.useCallback(
    (patch: Partial<Pick<DmCallPolicy, 'callsEnabled' | 'missedNotice' | 'whoMayRing'>>) => {
      if (pubkey) saveDmCallPolicy(pubkey, patch);
    },
    [pubkey],
  );

  const block = React.useCallback(
    (peer: string) => {
      if (pubkey) addDmCallBlock(pubkey, peer);
    },
    [pubkey],
  );

  const unblock = React.useCallback(
    (peer: string) => {
      if (pubkey) removeDmCallBlock(pubkey, peer);
    },
    [pubkey],
  );

  const startCall = React.useCallback(async (peer: string) => await (runtime?.session.start(peer) ?? false), [runtime]);
  const accept = React.useCallback(async () => await (runtime?.session.accept() ?? false), [runtime]);
  const decline = React.useCallback(() => runtime?.session.declineIncoming(), [runtime]);
  const blockAndDecline = React.useCallback(() => runtime?.session.blockAndDecline(), [runtime]);
  const cancel = React.useCallback(() => runtime?.session.cancel(), [runtime]);
  const hangup = React.useCallback(() => runtime?.session.hangup(), [runtime]);
  const clearError = React.useCallback(() => runtime?.session.clearError(), [runtime]);
  const toggleMute = React.useCallback(async () => (runtime ? await runtime.session.toggleMute() : true), [runtime]);

  return {
    access,
    phase: callState.phase,
    peer: callState.peer,
    callId: callState.callId,
    since: callState.since,
    answeredAt: callState.answeredAt,
    role: callState.role,
    error: callState.error,
    media: callState.media,
    muted: callState.muted,
    participantCount: callState.participantCount,
    toggleMute,
    policy: store.policy,
    blocks: store.blocks,
    log: store.log,
    setPolicy,
    block,
    unblock,
    startCall,
    accept,
    decline,
    blockAndDecline,
    cancel,
    hangup,
    clearError,
  };
}

const DmCallContext = React.createContext<DmCallsController | null>(null);

export interface DmCallProviderProps {
  children: React.ReactNode;
}

/**
 * Mount once per app (inside AuthProvider). Renders the global ring banner
 * for every surface/tab; the DM panel and Settings consume the same
 * controller through the context. Signed-out / no-local-key sessions get a
 * read-only controller stub (no lane, no ring banner).
 */
export function DmCallProvider({ children }: DmCallProviderProps): React.ReactElement {
  const auth = useAuth();
  const pubkey = auth.status === 'ready' && auth.pubkey ? auth.pubkey.toLowerCase() : null;
  const secretHex = pubkey && auth.method === 'seed' ? auth.seedIdentityHex() : null;
  const calls = useDmCallsShell(pubkey, secretHex);
  return (
    <DmCallContext.Provider value={calls}>
      {children}
      {calls.access === 'ready' && <DmCallRings calls={calls} />}
    </DmCallContext.Provider>
  );
}

/** Context consumer for surfaces the provider wraps (DmPanel, Settings). */
export function useDmCallsOptional(): DmCallsController | null {
  return React.useContext(DmCallContext);
}

/** Strict consumer (throws without the provider) for components that own the
 *  contract. */
export function useDmCalls(): DmCallsController {
  const calls = React.useContext(DmCallContext);
  if (!calls) throw new Error('useDmCalls: DmCallProvider is not mounted');
  return calls;
}
