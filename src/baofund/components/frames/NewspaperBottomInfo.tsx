/**
 * NewspaperBottomInfo - fixed bottom-left info panel + terminal hint.
 *
 * Ported from feat/newspaper-redesign-poll-terminal-check. Shows the active
 * edition count and filtered market count, and offers a one-click shortcut to
 * the global command terminal.
 */

import React from 'react';

import '../../theme/newspaperTheme.css';

export interface NewspaperBottomInfoProps {
  marketCount?: number;
  onTerminal?: () => void;
}

export const NewspaperBottomInfo = React.memo(function NewspaperBottomInfo({
  marketCount,
  onTerminal,
}: NewspaperBottomInfoProps) {
  return (
    <div className="fixed bottom-4 left-4 z-40 hidden sm:block" data-testid="newspaper-bottom-info">
      <button
        type="button"
        data-testid="newspaper-bottom-info-button"
        onClick={onTerminal}
        className="border px-3 py-2 text-left transition-colors hover:border-orange-500/50"
        style={{
          background: 'var(--np-paper)',
          borderColor: 'var(--np-rule)',
          fontFamily: 'var(--np-font-mono)',
        }}
      >
        <div className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>
          ₿AO Fund
        </div>
        <div className="text-[11px]" style={{ color: 'var(--np-ink)' }}>
          {marketCount ?? 0} live campaign{(marketCount ?? 0) === 1 ? '' : 's'}
        </div>
        <div className="text-[10px]" style={{ color: 'var(--np-accent)' }}>
          Press / for terminal
        </div>
      </button>
    </div>
  );
});

export default NewspaperBottomInfo;
