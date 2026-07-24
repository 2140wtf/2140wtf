/**
 * The single, app-wide consent gate for bulk signer decryption.
 *
 * A cold client with a remote (NIP-46 bunker) or extension (NIP-07) signer is
 * one screen-load away from a "decrypt storm": opening a DM thread wants up to a
 * screenful of `nip04.decrypt` round-trips, the conversation list wants one per
 * peer, and the direct-invite inbox wants two `nip44.decrypt` per gift wrap —
 * each of which a bunker/extension may surface as its own approval prompt. Fired
 * eagerly on entry, that floods the signer before the user has asked for
 * anything.
 *
 * This module gates all of that behind ONE decision, made ONCE, remembered
 * globally:
 *
 *   - unset    → the first surface that needs a real (uncached) decrypt opens a
 *                single prompt; every concurrent caller awaits the SAME prompt
 *                (never a second dialog, never a second signer poke).
 *   - allowed  → decrypts proceed as normal, everywhere, forever.
 *   - declined → bulk decrypts are refused; the UI falls back to manual
 *                affordances ("Decrypt", "Decrypt all") so the user drives when
 *                the signer is touched.
 *
 * The decision is persisted in localStorage and shared across every surface and
 * tab. It is deliberately NOT per-conversation: the question ("do you want this
 * app decrypting with your signer?") is about the signer relationship, not any
 * one room, so it's asked once for the whole app.
 *
 * Cache interplay: a decrypt whose plaintext is already in the AppSigner
 * persistent cache never touches the signer, so callers should gate ONLY the
 * uncached remainder (see `useDirectMessages` / `useDirectInvites2`). When
 * everything is cached there is nothing to prompt about and the gate is skipped
 * entirely.
 */

const STORAGE_KEY = "2140:decrypt-consent";

/** The persisted decision. `null` means "not yet decided". */
export type DecryptConsent = "allowed" | "declined";
export type DecryptConsentState = DecryptConsent | null;

type Listener = () => void;

const listeners = new Set<Listener>();

/** In-memory mirror of the persisted value (source of truth for `getSnapshot`). */
let current: DecryptConsentState = readPersisted();

/** The in-flight prompt, shared by every caller while the decision is pending. */
let pending: Promise<DecryptConsent> | null = null;

/**
 * The app-wide dialog registers an opener here. When a caller needs a decision
 * and none is stored, the opener is invoked to surface the ONE prompt. It must
 * eventually call `resolveConsentPrompt`. Until an opener is registered (or if
 * none ever is), an unset gate resolves conservatively to "declined" so a
 * headless/early caller never blocks forever or silently storms the signer.
 */
let openPrompt: (() => void) | null = null;

function readPersisted(): DecryptConsentState {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "allowed" || v === "declined" ? v : null;
  } catch {
    return null;
  }
}

function emit(): void {
  for (const l of listeners) l();
}

/** Current decision (synchronous). `null` when undecided. */
export function getDecryptConsent(): DecryptConsentState {
  return current;
}

/** Persist and broadcast a decision. Resolves any in-flight prompt. */
export function setDecryptConsent(value: DecryptConsent): void {
  current = value;
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // best-effort; the in-memory value still governs this session
  }
  resolveConsentPrompt(value);
  emit();
}

/** Forget the decision (used on logout). The next need re-prompts. */
export function resetDecryptConsent(): void {
  current = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  emit();
}

/**
 * Resolve to the standing decision, opening the one-time prompt when undecided.
 *
 * Every concurrent caller shares a single pending promise, so N surfaces racing
 * to decrypt on entry produce exactly ONE dialog. If no dialog opener is
 * registered (headless/tests/early boot), an undecided gate resolves to
 * "declined" — never storming the signer without an explicit yes.
 */
export function ensureDecryptConsent(): Promise<DecryptConsent> {
  if (current) return Promise.resolve(current);
  if (pending) return pending;

  const promise = new Promise<DecryptConsent>((resolve) => {
    resolvePending = resolve;
  });
  pending = promise;

  if (openPrompt) {
    openPrompt();
  } else {
    // No UI to ask with: decline rather than block or silently decrypt. This
    // resolves (and clears) `pending`, so return the captured promise.
    resolveConsentPrompt("declined");
  }
  return promise;
}

/** The resolver for the current pending prompt, if any. */
let resolvePending: ((value: DecryptConsent) => void) | null = null;

/**
 * Resolve the in-flight prompt (called by the dialog on the user's choice, or
 * internally when there's no dialog). Persisting a decision goes through
 * `setDecryptConsent`, which calls this; a bare "declined" fallback does NOT
 * persist, so the user is asked again next time a dialog is available.
 */
export function resolveConsentPrompt(value: DecryptConsent): void {
  resolvePending?.(value);
  resolvePending = null;
  pending = null;
}

/** Whether a prompt is currently pending (drives the dialog's open state). */
export function isConsentPromptPending(): boolean {
  return pending !== null;
}

/**
 * Register the app-wide dialog's opener. Returns an unsubscribe. If a prompt is
 * already pending when the dialog mounts, it's opened immediately.
 */
export function registerConsentPromptOpener(opener: () => void): () => void {
  openPrompt = opener;
  if (pending) opener();
  return () => {
    if (openPrompt === opener) openPrompt = null;
  };
}

// ── React store glue (useSyncExternalStore) ──────────────────────────────────

export function subscribeDecryptConsent(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getDecryptConsentSnapshot(): DecryptConsentState {
  return current;
}

/** Test seam: fully reset module state (decision, pending prompt, opener). */
export function __resetDecryptConsentForTests(): void {
  resetDecryptConsent();
  resolvePending = null;
  pending = null;
  openPrompt = null;
}
