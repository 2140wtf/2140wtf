/**
 * CampaignChatGate - the graceful wall in front of donor-gated campaign
 * rooms.
 *
 * Campaign rooms open to contributors only (and only once the contribution
 * is confirmed). Non-contributors are not rejected silently: they are told
 * why, and offered the two public doors - Trollbox and Public Chat - which
 * are available to every authenticated user.
 */

import React from 'react';

import { DEFAULT_ROOM_NAMES } from '../../lib/baoCommunity';

export interface CampaignChatGateProps {
  campaignTitle: string;
  /** Close without changing rooms. */
  onClose: () => void;
  /** Open one of the public rooms in the in-app chat. */
  onOpenRoom: (roomName: string) => void;
}

export function CampaignChatGate({ campaignTitle, onClose, onOpenRoom }: CampaignChatGateProps): React.ReactElement {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(26, 26, 26, 0.55)' }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Campaign room is for contributors"
        data-testid="campaign-chat-gate"
        className="w-full max-w-md border p-5"
        style={{
          borderColor: 'var(--np-rule)',
          background: 'var(--np-bg)',
          fontFamily: 'var(--np-font-serif)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ fontSize: '1.15rem', marginBottom: '0.5rem' }}>
          The campaign room opens to contributors
        </h2>
        <p style={{ fontSize: '0.88rem', color: 'var(--np-muted)', lineHeight: 1.6 }}>
          Chat for <b style={{ color: 'var(--np-ink)' }}>{campaignTitle}</b> is reserved for donors.
          Contribute first - the room opens as soon as your contribution is confirmed.
        </p>
        <p style={{ fontSize: '0.88rem', color: 'var(--np-muted)', lineHeight: 1.6, marginTop: '0.6rem' }}>
          Until then, these two rooms are open to you:
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {DEFAULT_ROOM_NAMES.map((name) => (
            <button
              key={name}
              type="button"
              data-testid={`gate-open-room-${name}`}
              onClick={() => onOpenRoom(name)}
              className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.15em]"
              style={{
                fontFamily: 'var(--np-font-mono)',
                color: 'var(--np-on-accent)',
                background: 'var(--np-accent)',
                border: '1px solid var(--np-accent)',
              }}
            >
              {name}
            </button>
          ))}
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.15em]"
            style={{
              fontFamily: 'var(--np-font-mono)',
              color: 'var(--np-ink)',
              background: 'transparent',
              border: '1px solid var(--np-rule)',
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default CampaignChatGate;
