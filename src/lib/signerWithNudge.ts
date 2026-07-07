import type { NostrEvent, NostrSigner } from '@nostrify/types';
import { createElement } from 'react';
import { toast } from '@/hooks/useToast';
import { NudgeToastContent } from '@/components/SignerToastContent';
import { type BtcSigner, hasBtcSigning, type PsbtSigningOptions } from '@/lib/bitcoin-signers';
import { getKindLabel } from '@/lib/kindLabels';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Show the nudge toast after this delay if a signer op is still pending. */
const NUDGE_DELAY_MS = 4_000;


/** Hard timeout — reject the op entirely after this long with no response. */
const HARD_TIMEOUT_MS = 45_000;


/** How long to back off from decrypt prompts after the user cancels/denies one. */
const DECRYPT_BACKOFF_MS = 30_000;

/** Maximum number of cached decrypt results per signer instance. */
const DECRYPT_CACHE_LIMIT = 50;

/** How long to keep successful decrypt results in the cache. */
const DECRYPT_CACHE_TTL_MS = 5 * 60 * 1_000;


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isAndroid(): boolean {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
}

type OpType = 'sign' | 'encrypt' | 'decrypt';

/**
 * Context-specific overrides for nudge toast descriptions.
 * Falls back to the central kind label registry for kinds not listed here.
 */
const NUDGE_OVERRIDES: Record<number, string> = {
  0: 'profile update',
  1: 'post',
  3: 'contact list update',
  11: 'post',
  8333: 'Bitcoin zap',
  10000: 'mute list update',
  10001: 'pinned notes update',
  10002: 'relay list update',
  10003: 'bookmarks update',
  10015: 'interests update',
  10030: 'emoji list update',
  24242: 'file upload auth',
  30000: 'user list update',
  30078: 'app settings',
  30315: 'status update',
  31925: 'event RSVP',
  39089: 'help content',
};

function labelForOp(kind: number | undefined, opType: OpType): string {
  if (kind !== undefined) {
    if (NUDGE_OVERRIDES[kind]) return NUDGE_OVERRIDES[kind];
    const central = getKindLabel(kind, '');
    if (central) return central.toLowerCase();
  }
  if (opType === 'encrypt') return 'encryption';
  if (opType === 'decrypt') return 'decryption';
  return 'signing';
}

// ---------------------------------------------------------------------------
// Sentinel values used to signal control flow inside Promise.race
// ---------------------------------------------------------------------------

const CANCEL = Symbol('cancel');
const TIMEOUT = Symbol('timeout');

type Signal = typeof CANCEL | typeof TIMEOUT;

// ---------------------------------------------------------------------------
// Toast deduplication — prevent a storm of identical nudge toasts
// ---------------------------------------------------------------------------

/** Timestamp of the last nudge toast shown. Used to throttle. */
let lastNudgeShownAt = 0;
/** Minimum gap between nudge toasts (ms). Prevents rapid-fire replacements. */
const NUDGE_THROTTLE_MS = 8_000;

// ---------------------------------------------------------------------------
// Toast helpers
// ---------------------------------------------------------------------------

/**
 * Shows the nudge toast with interactive buttons. Returns a dismiss handle.
 *
 * On Android the toast includes an "Approve in signer" link that opens the
 * signer via the `nostrsigner:` URI scheme (keeps the WebSocket alive), plus
 * a Skip/Cancel button. On desktop it shows a description with a Skip button.
 */
function showNudgeToast(opts: {
  kind: number | undefined;
  opType: OpType;
  isBunkerConnected: (() => boolean) | undefined;
  onCancel: () => void;
}): { dismiss: () => void } {
  const { kind, opType, isBunkerConnected, onCancel } = opts;
  const android = isAndroid();
  const relayOk = isBunkerConnected ? isBunkerConnected() : true;
  const subject = labelForOp(kind, opType);

  // Throttle: if a nudge was shown recently, return a no-op dismiss handle
  // to avoid a storm of rapidly replacing toasts on unstable connections.
  const now = Date.now();
  if (now - lastNudgeShownAt < NUDGE_THROTTLE_MS) {
    return { dismiss: () => {} };
  }
  lastNudgeShownAt = now;

  let title: string;
  let descriptionText: string;

  if (!relayOk) {
    title = 'Signer relay unreachable';
    descriptionText = 'Check your connection and try again.';
  } else if (android) {
    title = `Approve ${subject}`;
    descriptionText = 'Set to auto-approve for a smoother experience.';
  } else {
    title = `Approve ${subject}`;
    descriptionText = 'Approve the request in your signer app.';
  }

  // We need to capture the dismiss function so the onCancel callback inside
  // the component can dismiss the toast. We use a mutable ref pattern (object
  // wrapper) so the closure captures the container rather than the value.
  const dismissRef: { fn: (() => void) | undefined } = { fn: undefined };

  const description = createElement(NudgeToastContent, {
    description: descriptionText,
    android,
    relayOk,
    onCancel: () => { dismissRef.fn?.(); onCancel(); },
  });

  // Use a long but finite duration so Radix swipe-to-dismiss works on mobile.
  // The toast is dismissed programmatically on operation completion anyway.
  const { dismiss } = toast({ title, description, duration: 120_000 });
  dismissRef.fn = dismiss;

  return { dismiss };
}

function showSuccessToast(opType: OpType): void {
  const verb = opType === 'encrypt' ? 'Encryption' : opType === 'decrypt' ? 'Decryption' : 'Signing';
  toast({ title: `${verb} approved`, duration: 3000, variant: 'success' });
}


// ---------------------------------------------------------------------------
// Core: run a signer operation with nudge + retry logic
// ---------------------------------------------------------------------------

interface RunOpts {
  kind: number | undefined;
  opType: OpType;
  isBunkerConnected: (() => boolean) | undefined;
}

/** Creates a deferred promise. Used to race against the actual signer op. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

/** Result of `runWithNudge` — value + whether the nudge toast was shown. */
interface RunResult<T> {
  value: T;
  nudgeFired: boolean;
}

/**
 * Runs `op` with:
 * - A nudge toast after NUDGE_DELAY_MS if still pending.
 * - A hard timeout at HARD_TIMEOUT_MS.
 */
async function runWithNudge<T>(op: () => Promise<T>, opts: RunOpts): Promise<RunResult<T>> {
  const { kind, opType, isBunkerConnected } = opts;

  // Tagged outcome type used to distinguish op results from control signals.
  type Outcome =
    | { tag: 'value'; value: T }
    | { tag: 'error'; error: unknown }
    | { tag: 'signal'; signal: Signal };

  let nudgeFired = false;

  // Signal channels — each resolves with a sentinel when its condition fires.
  const cancelSignal = deferred<typeof CANCEL>();
  const timeoutSignal = deferred<typeof TIMEOUT>();

  // --- Nudge timer ---
  let dismissNudge: (() => void) | undefined;
  const nudgeTimer = setTimeout(() => {
    nudgeFired = true;
    const handle = showNudgeToast({
      kind, opType, isBunkerConnected,
      onCancel: () => cancelSignal.resolve(CANCEL),
    });
    dismissNudge = handle.dismiss;
  }, NUDGE_DELAY_MS);

  // --- Hard timeout ---
  const hardTimer = setTimeout(() => timeoutSignal.resolve(TIMEOUT), HARD_TIMEOUT_MS);

  function cleanup() {
    clearTimeout(nudgeTimer);
    clearTimeout(hardTimer);
    dismissNudge?.();
  }

  const opOutcome: Promise<Outcome> = op().then(
    (value): Outcome => ({ tag: 'value', value }),
    (error): Outcome => ({ tag: 'error', error }),
  );

  const signalOutcome: Promise<Outcome> = Promise.race([
    cancelSignal.promise,
    timeoutSignal.promise,
  ]).then((signal): Outcome => ({ tag: 'signal', signal }));

  const outcome = await Promise.race([opOutcome, signalOutcome]);
  cleanup();

  if (outcome.tag === 'value') {
    if (nudgeFired) showSuccessToast(opType);
    return { value: outcome.value, nudgeFired };
  }

  if (outcome.tag === 'error') {
    throw outcome.error;
  }

  // outcome.tag === 'signal'
  switch (outcome.signal) {
    case CANCEL:
      throw new Error('Signing cancelled by user');

    case TIMEOUT:
      throw new Error('Signer timed out');
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Wraps a `NostrSigner` to add UX improvements for remote/external signers:
 *
 * - Shows a nudge toast after 4s if a signing or encryption op is still
 *   pending, so the user knows to check their signer app.
 * - When a nip44 encrypt is immediately followed by a signEvent (e.g. saving
 *   encrypted settings), shows a phase-transition toast so the user knows to
 *   approve the second request.
 * - Caches in-flight and completed decrypt calls so duplicate ciphertexts only
 *   prompt the signer once, and pauses decrypt prompts for a short cooldown
 *   after the user cancels/denies a request to stop extension prompt storms.
 *
 * @param signer - The underlying NostrSigner to wrap.
 * @param isBunkerConnected - Optional callback checked at nudge time; when it
 *   returns false the toast warns about a relay connectivity problem instead.
 */
export function signerWithNudge(
  signer: NostrSigner,
  isBunkerConnected?: () => boolean,
  pubkey?: string,
): NostrSigner {
  /** Run an op and return just the value (discarding nudge metadata). */
  function run<T>(op: () => Promise<T>, kind: number | undefined, opType: OpType): Promise<T> {
    return runWithNudge(op, { kind, opType, isBunkerConnected }).then((r) => r.value);
  }

  const wrapped: NostrSigner = {
    getPublicKey: () => {
      if (pubkey) return Promise.resolve(pubkey);
      return run(() => signer.getPublicKey(), undefined, 'sign');
    },

    signEvent: (event: NostrEvent) => {
      return run(() => signer.signEvent(event), event.kind, 'sign');
    },
  };

  if (signer.getRelays) {
    const getRelays = signer.getRelays.bind(signer);
    wrapped.getRelays = () => run(() => getRelays(), undefined, 'sign');
  }

  // -------------------------------------------------------------------------
  // Decrypt cache + backoff (per signer instance)
  // -------------------------------------------------------------------------

  interface DecryptPromise extends Promise<string> {
    resolvedAt?: number;
  }

  const decryptCache = new Map<string, DecryptPromise>();
  let decryptPausedUntil = 0;

  function isUserDenied(error: unknown): boolean {
    const msg = error instanceof Error ? error.message : String(error);
    return /\b(cancel|rejected?|denied|deny|closed|abort|permission|user rejected|user denied)\b/i.test(
      msg,
    );
  }

  function evictDecryptCache(): void {
    const now = Date.now();
    // Drop completed entries that have expired first.
    for (const [key, promise] of decryptCache) {
      if ((promise as { resolvedAt?: number }).resolvedAt !== undefined) {
        const resolvedAt = (promise as { resolvedAt: number }).resolvedAt;
        if (now - resolvedAt > DECRYPT_CACHE_TTL_MS) {
          decryptCache.delete(key);
        }
      }
    }
    // If still over the limit, drop the oldest completed entries.
    if (decryptCache.size > DECRYPT_CACHE_LIMIT) {
      const completed = Array.from(decryptCache.entries())
        .filter(([, p]) => p.resolvedAt !== undefined)
        .sort((a, b) => a[1].resolvedAt! - b[1].resolvedAt!);
      const toDrop = decryptCache.size - DECRYPT_CACHE_LIMIT;
      for (let i = 0; i < toDrop && i < completed.length; i++) {
        decryptCache.delete(completed[i][0]);
      }
    }
    // As a last resort, drop the oldest in-flight entries so a burst of
    // concurrent decrypts cannot grow the cache without bound.
    if (decryptCache.size > DECRYPT_CACHE_LIMIT) {
      const inFlight = Array.from(decryptCache.entries())
        .filter(([, p]) => p.resolvedAt === undefined);
      const toDrop = decryptCache.size - DECRYPT_CACHE_LIMIT;
      for (let i = 0; i < toDrop && i < inFlight.length; i++) {
        decryptCache.delete(inFlight[i][0]);
      }
    }
  }

  function makeDecryptKey(algorithm: string, pubkey: string, ciphertext: string): string {
    return `${algorithm}:${pubkey}:${ciphertext.length}:${ciphertext}`;
  }

  function wrapDecrypt(
    algorithm: 'nip04' | 'nip44',
    crypto: { decrypt: (pubkey: string, ciphertext: string) => Promise<string> },
  ): (pubkey: string, ciphertext: string) => Promise<string> {
    return (pubkey: string, ciphertext: string) => {
      // If the user recently cancelled a decrypt prompt, fail fast instead of
      // re-prompting for every new gift-wrap event.
      if (Date.now() < decryptPausedUntil) {
        return Promise.reject(new Error('Decryption paused after cancellation'));
      }

      const key = makeDecryptKey(algorithm, pubkey, ciphertext);
      const cached = decryptCache.get(key);
      if (cached) return cached;

      evictDecryptCache();

      const promise: DecryptPromise = crypto
        .decrypt(pubkey, ciphertext)
        .then((plaintext) => {
          promise.resolvedAt = Date.now();
          evictDecryptCache();
          return plaintext;
        })
        .catch((error) => {
          decryptCache.delete(key);
          if (isUserDenied(error)) {
            decryptPausedUntil = Date.now() + DECRYPT_BACKOFF_MS;
          }
          throw error;
        });

      decryptCache.set(key, promise);
      return promise;
    };
  }

  // Shared wrapper for nip04/nip44 encrypt and decrypt methods.
  function wrapCrypto(
    algorithm: 'nip04' | 'nip44',
    crypto: {
      encrypt: (pubkey: string, plaintext: string) => Promise<string>;
      decrypt: (pubkey: string, ciphertext: string) => Promise<string>;
    },
  ) {
    return {
      encrypt: (pubkey: string, plaintext: string) => crypto.encrypt(pubkey, plaintext),
      decrypt: wrapDecrypt(algorithm, crypto),
    };
  }

  if (signer.nip04) {
    wrapped.nip04 = wrapCrypto('nip04', signer.nip04);
  }

  if (signer.nip44) {
    wrapped.nip44 = wrapCrypto('nip44', signer.nip44);
  }

  // Forward signPsbt if the underlying signer supports Bitcoin signing.
  if (hasBtcSigning(signer)) {
    const btcWrapped = wrapped as BtcSigner;
    const btcSigner = signer;
    btcWrapped.signPsbt = (psbtHex: string, options?: PsbtSigningOptions) =>
      run(() => btcSigner.signPsbt(psbtHex, options), undefined, 'sign');
  }

  return wrapped;
}
