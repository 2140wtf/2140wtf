/**
 * Native Passkey Authentication Bridge for 2140.wtf.
 *
 * Thin adapter over the canonical MIT `bao-signer` library
 * (github:baocommunity/bao-signer). The library owns the WebAuthn PRF /
 * largeBlob enrollment, key wrapping, and Nostr identity logic; this module
 * only pins the storage prefix and re-exports the surface the app uses.
 *
 * STORAGE COMPATIBILITY: existing 2140 enrollments live under the
 * `2140_native_passkey_*` localStorage keys. The library's default prefix is
 * `bao_native_passkey`, so we configure ours at import time — key names stay
 * byte-identical and existing passkey accounts keep working.
 *
 * No server interaction required. Pure client-side.
 */

import {
  configureNativePasskey,
  registerNativePasskeyAccount,
  loginNativePasskeyAccount,
  hasNativePasskeyAccount,
  getNativePasskeyAvailability,
  removeNativePasskeyAccount,
} from 'bao-signer/client';

configureNativePasskey({ storagePrefix: '2140_native_passkey' });

export {
  registerNativePasskeyAccount,
  loginNativePasskeyAccount,
  hasNativePasskeyAccount,
  getNativePasskeyAvailability,
  removeNativePasskeyAccount,
};

export type {
  NativePasskeyIdentity,
  NativePasskeyRegistrationResult,
  NativePasskeyAvailability,
} from 'bao-signer/client';

/* ── Error Helpers ─────────────────────────────────────────── */

export const NativePasskeyError = {
  NOT_AVAILABLE: 'Passkeys are not available on this browser.',
  NO_ACCOUNT: 'No passkey account found. Please create one first.',
  CANCELLED: 'Authentication was cancelled.',
  CORRUPTED: 'Passkey data is corrupted. Please remove and re-enroll.',
} as const;
