/**
 * DmCallSettingsSection - the "Calls in DMs" Settings surface
 * (ADR-dm-calls, owner input 2026-10-14).
 *
 * Sits inside the existing Settings tab (nav order untouched) and edits the
 * per-identity call policy:
 *   - "Calls in DMs" toggle over `callsEnabled` (default OFF);
 *   - "Send missed call notice" toggle over `missedNotice` (default OFF; the
 *     copy states the indistinguishability trade-off the ADR documents);
 *   - `whoMayRing`: nobody / follows / mutuals / anyone - with explicit copy
 *     that follows/mutuals fail closed until a follows graph is wired
 *     (this app has none yet; the evaluation oracle returns not-followed);
 *   - the local block list (add by 64-hex or npub, remove/unblock).
 *
 * The section is rendered by SettingsPanel only when the DmCallProvider is
 * present; it renders nothing without a calls controller.
 */

import React from 'react';
import { parsePeerInput } from './DmPanel';
import type { DmCallsController } from './useDmCalls';
import type { WhoMayRing } from './dmCallStore';

const WHO_MAY_RING_OPTIONS: Array<{ value: WhoMayRing; label: string }> = [
  { value: 'nobody', label: 'Nobody' },
  { value: 'follows', label: 'People I follow (not available yet - currently nobody)' },
  { value: 'mutuals', label: 'Mutual follows (not available yet - currently nobody)' },
  { value: 'anyone', label: 'Anyone' },
];

function shortPeer(peer: string): string {
  return `${peer.slice(0, 12)}…`;
}

export interface DmCallSettingsSectionProps {
  calls: DmCallsController;
}

export function DmCallSettingsSection({ calls }: DmCallSettingsSectionProps): React.ReactElement {
  const [blockInput, setBlockInput] = React.useState('');
  const [blockError, setBlockError] = React.useState<string | null>(null);

  const addBlock = React.useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      const peer = parsePeerInput(blockInput);
      if (!peer) {
        setBlockError('Enter a 64-hex pubkey or an npub1… identifier.');
        return;
      }
      setBlockError(null);
      setBlockInput('');
      calls.block(peer);
    },
    [blockInput, calls],
  );

  return (
    <section className="border p-5" style={{ borderColor: 'var(--np-rule)', background: 'var(--np-paper)' }} data-testid="dmcall-settings">
      <h3 className="mb-2 font-serif text-lg font-bold">Calls in DMs</h3>

      {calls.access !== 'ready' ? (
        <p className="text-xs leading-relaxed" style={{ color: 'var(--np-muted)' }} data-testid="dmcall-settings-unavailable">
          {calls.access === 'signed-out'
            ? 'Sign in to enable calls. Calls need a seed-phrase identity this browser can hold.'
            : 'Calls are unavailable for this sign-in method: this browser cannot build or open the encrypted call messages. Sign in with your seed phrase (or unlock the seed session) to use them.'}
        </p>
      ) : (
        <div className="space-y-4">
          <p className="text-xs leading-relaxed" style={{ color: 'var(--np-muted)' }}>
            Calls are private, peer-to-peer ringing over the same encrypted DM lane. Both sides must opt in:
            nobody can ring you until &ldquo;Calls in DMs&rdquo; is on, and ringing is only possible if the
            caller enabled calls too.
          </p>

          <label className="flex items-start gap-2 text-xs" style={{ color: 'var(--np-ink)' }}>
            <input
              type="checkbox"
              checked={calls.policy.callsEnabled}
              onChange={(e) => calls.setPolicy({ callsEnabled: e.target.checked })}
              data-testid="dmcall-enabled"
            />
            <span>
              <b>Calls in DMs</b>
              <span className="block text-[10px]" style={{ color: 'var(--np-muted)' }}>
                Let friends ring this identity and allow placing calls. Off by default; nobody can ring you while off.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2 text-xs" style={{ color: 'var(--np-ink)' }}>
            <input
              type="checkbox"
              checked={calls.policy.missedNotice}
              onChange={(e) => calls.setPolicy({ missedNotice: e.target.checked })}
              data-testid="dmcall-missed-notice"
            />
            <span>
              <b>Send missed call notice</b>
              <span className="block text-[10px]" style={{ color: 'var(--np-muted)' }}>
                Send a plain &ldquo;Missed call&rdquo; message when a call rings out unanswered. Off by default:
                a notice tells the caller your device rang and you did not pick up, which the silent-drop
                design otherwise keeps indistinguishable from being offline.
              </span>
            </span>
          </label>

          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-muted)', fontFamily: 'var(--np-font-mono)' }}>
              Who may ring me
            </label>
            <select
              value={calls.policy.whoMayRing}
              onChange={(e) => calls.setPolicy({ whoMayRing: e.target.value as WhoMayRing })}
              className="w-full rounded border bg-transparent px-2 py-1 text-xs"
              style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
              data-testid="dmcall-who-may-ring"
            >
              {WHO_MAY_RING_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[10px]" style={{ color: 'var(--np-muted)' }}>
              Follow-based rules need a follows list this app does not import yet - they currently behave like
              &ldquo;Nobody&rdquo;. Refused calls are dropped silently: the caller cannot tell you refused.
            </p>
          </div>

          <div>
            <form onSubmit={addBlock} className="flex gap-1">
              <input
                value={blockInput}
                onChange={(e) => setBlockInput(e.target.value)}
                placeholder="Block a pubkey (npub1… or 64-hex)"
                className="flex-1 rounded border bg-transparent px-2 py-1 text-xs"
                style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
                data-testid="dmcall-block-input"
              />
              <button
                type="submit"
                className="rounded border px-2 py-1 text-[10px] font-bold uppercase tracking-widest"
                style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)', fontFamily: 'var(--np-font-mono)' }}
                data-testid="dmcall-block-add"
              >
                Block
              </button>
            </form>
            {blockError && (
              <p className="mt-1 text-[10px]" style={{ color: 'var(--np-error, #b91c1c)' }} data-testid="dmcall-block-error">
                {blockError}
              </p>
            )}
            {calls.blocks.length === 0 ? (
              <p className="mt-2 text-[10px]" style={{ color: 'var(--np-muted)' }} data-testid="dmcall-block-empty">
                No blocked pubkeys.
              </p>
            ) : (
              <ul className="mt-2 space-y-1" data-testid="dmcall-block-list">
                {calls.blocks.map((pk) => (
                  <li key={pk} className="flex items-center justify-between gap-2 text-xs" style={{ fontFamily: 'var(--np-font-mono)' }}>
                    <span className="truncate" title={pk}>
                      {shortPeer(pk)}
                    </span>
                    <button
                      type="button"
                      onClick={() => calls.unblock(pk)}
                      className="rounded border px-2 py-0.5 text-[10px] uppercase tracking-widest"
                      style={{ borderColor: 'var(--np-rule)', color: 'var(--np-muted)', fontFamily: 'var(--np-font-mono)' }}
                      data-testid={`dmcall-unblock-${pk}`}
                    >
                      Unblock
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
