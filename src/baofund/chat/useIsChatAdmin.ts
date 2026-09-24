/**
 * Admin gate for operator-only chat affordances (in-app room creation for
 * arbitrary/invisible rooms; the API's rooms list). The SERVER is the
 * authority: `GET /v1/me` returns the caller's own scopes for the signed-in
 * identity (admins are configured server-side with BAO_ADMIN_PUBKEY(S)).
 *
 * Fail closed: no signer, a failed request, or a malformed body means NOT
 * admin. The value only controls what the UI offers - the API still
 * authorizes every call.
 */
import React from 'react';
import { fundFetch } from '../lib/fundHttp';
import type { SignerLike } from '../lib/baoFundraising';

/** One-shot check (also used by the room-creation guard at call time). */
export async function fetchIsChatAdmin(signer: SignerLike): Promise<boolean> {
  try {
    const res = await fundFetch<{ data?: { admin?: boolean } }>('/v1/me', { method: 'GET', signer });
    return res?.data?.admin === true;
  } catch {
    return false;
  }
}

/** React binding: false until the API confirms the admin scope. */
export function useIsChatAdmin(signer: SignerLike | null | undefined): boolean {
  const [isAdmin, setIsAdmin] = React.useState(false);
  React.useEffect(() => {
    let cancelled = false;
    if (!signer) {
      // Deferred: a synchronous setState in the effect body is a cascading
      // render (react-hooks/set-state-in-effect).
      void Promise.resolve().then(() => {
        if (!cancelled) setIsAdmin(false);
      });
      return () => {
        cancelled = true;
      };
    }
    void fetchIsChatAdmin(signer).then((value) => {
      if (!cancelled) setIsAdmin(value);
    });
    return () => {
      cancelled = true;
    };
  }, [signer]);
  return isAdmin;
}
