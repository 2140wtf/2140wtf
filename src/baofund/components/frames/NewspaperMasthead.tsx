/**
 * NewspaperMasthead - editorial masthead for the newspaper view.
 *
 * Nameplate layout inspired by classic broadsheets (The Times):
 *   · folio line with date + edition (top)
 *   · heavy serif nameplate (centre)
 *   · thin rules above and below
 */

import React from 'react';

import '../../theme/newspaperTheme.css';

export const NewspaperMasthead = React.memo(function NewspaperMasthead({ nameplate = '₿AO FUND', folioRight = 'Milestone Edition', mottoLine = 'The Fund Ledger', mottoLine2 = '₿itcoin Agentic Organisation' }: { nameplate?: string; folioRight?: string; mottoLine?: string; mottoLine2?: string }) {
  const now = new Date();
  const dateStr = now.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <header
      className="newspaper py-5 text-center sm:py-6"
      data-testid="newspaper-masthead"
    >
      {/* Folio line */}
      <div
        className="mb-3 flex flex-wrap items-center justify-center gap-2 text-[9px] uppercase tracking-[0.18em] sm:gap-4 sm:text-[10px] sm:tracking-[0.25em]"
        style={{ color: 'var(--np-muted)', fontFamily: 'var(--np-font-mono)' }}
      >
        <span>Vol. I · No. 1</span>
        <span className="h-px w-4 sm:w-6" style={{ background: 'var(--np-rule)' }} />
        <span>{dateStr}</span>
        <span className="h-px w-4 sm:w-6" style={{ background: 'var(--np-rule)' }} />
        <span>{folioRight}</span>
      </div>

      {/* Nameplate */}
      <h1
        className="mb-1 text-[clamp(2.5rem,8vw,5.5rem)] font-bold leading-none tracking-tight"
        style={{ fontFamily: 'var(--np-font-serif)', color: 'var(--np-ink)' }}
      >
        {nameplate}
      </h1>

      {/* Subtitle / motto */}
      <div
        className="mx-auto flex flex-wrap items-center justify-center gap-2 text-[9px] uppercase tracking-[0.16em] sm:gap-3 sm:text-[10px] sm:tracking-[0.2em]"
        style={{ color: 'var(--np-muted)', fontFamily: 'var(--np-font-mono)' }}
      >
        <span className="hidden h-px w-5 sm:inline sm:w-8" style={{ background: 'var(--np-rule)' }} />
        <span>{mottoLine}</span>
        <span className="h-px w-5 sm:w-8" style={{ background: 'var(--np-rule)' }} />
        <span>{mottoLine2}</span>
        <span className="hidden h-px w-5 sm:inline sm:w-8" style={{ background: 'var(--np-rule)' }} />
      </div>
    </header>
  );
});

export default NewspaperMasthead;
