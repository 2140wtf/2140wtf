import { useSyncExternalStore } from "react";

import {
  getDecryptConsentSnapshot,
  resetDecryptConsent,
  setDecryptConsent,
  subscribeDecryptConsent,
  type DecryptConsentState,
} from "@/lib/decryptConsent";

/**
 * Subscribe to the app-wide bulk-decrypt consent decision (see
 * `@/lib/decryptConsent`). Re-renders when the decision changes — including
 * from another surface or tab — so timelines can flip between "decrypting" and
 * the manual "Decrypt" / "Decrypt all" affordances without a reload.
 */
export function useDecryptConsent(): {
  /** `"allowed" | "declined"`, or `null` when the user hasn't decided yet. */
  consent: DecryptConsentState;
  /** Whether the user has explicitly declined bulk decryption. */
  declined: boolean;
  /** Grant consent (persisted, resolves any pending prompt). */
  allow: () => void;
  /** Decline consent (persisted, surfaces the manual decrypt affordances). */
  decline: () => void;
  /** Forget the decision (re-prompts next time). */
  reset: () => void;
} {
  const consent = useSyncExternalStore(subscribeDecryptConsent, getDecryptConsentSnapshot, getDecryptConsentSnapshot);
  return {
    consent,
    declined: consent === "declined",
    allow: () => setDecryptConsent("allowed"),
    decline: () => setDecryptConsent("declined"),
    reset: resetDecryptConsent,
  };
}
