/**
 * DmEntry - the "Direct messages" launcher + overlay for DM-capable surfaces.
 *
 * Placement follows the chat-placement owner rule ("one chat, many surfaces -
 * placed by the surfaces that OWN it"): the fund app's ₿AO tab and the BAO
 * chat entry render this next to their ChatPanel. It is deliberately a NEW
 * element - the canonical ChatPanel JSX/contract is untouched, so vendored
 * consumers (bao.markets, 2140.wtf) are unaffected.
 *
 * Guests see the launcher too; the panel itself renders the standard in-page
 * sign-in pattern (`#bao-signin` scroll, or the surface's `onSignIn`).
 */

import React from 'react';
import { DmPanel } from './DmPanel';

export interface DmEntryProps {
  /** App-level sign-in trigger (surfaces without a #bao-signin block). */
  onSignIn?: () => void;
}

export function DmEntry({ onSignIn }: DmEntryProps): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <div className="mx-auto flex w-full max-w-5xl justify-end px-4 pt-1 sm:px-5">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded border px-2 py-1 text-[10px] font-bold uppercase tracking-widest hover:bg-black/5"
          style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)', fontFamily: 'var(--np-font-mono)' }}
          title="Private, encrypted direct messages"
          data-testid="dm-open"
        >
          Direct messages
        </button>
      </div>
      {open && (
        <div
          className="fixed inset-0 z-[80] overflow-y-auto p-4"
          style={{ background: 'rgba(0, 0, 0, 0.45)' }}
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Direct messages"
          data-testid="dm-overlay"
        >
          <div onClick={(e) => e.stopPropagation()}>
            <DmPanel onClose={() => setOpen(false)} onSignIn={onSignIn} />
          </div>
        </div>
      )}
    </>
  );
}
