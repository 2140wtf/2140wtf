/**
 * NewspaperViewTabs - sub-view tabs for the newspaper shell.
 */

import React from 'react';

import '../../theme/newspaperTheme.css';

export interface NewspaperViewTabsProps<T extends string> {
  active: T;
  /** `label` renders ≥sm; `short` renders below sm so every tab stays visible
   *  without the row clipping mid-word ("Wall…"). */
  options: { id: T; label: string; short?: string }[];
  onChange: (id: T) => void;
  rightSlot?: React.ReactNode;
  /** Center the tab group under the (centered) masthead. The right slot stays
   *  at the right edge; an equal-width empty cell on the left keeps the tabs
   *  truly centered rather than centered in the space left of the slot. */
  centered?: boolean;
}

export function NewspaperViewTabs<T extends string>({
  active,
  options,
  onChange,
  rightSlot,
  centered = false,
}: NewspaperViewTabsProps<T>) {
  const tabButtons = options.map(({ id, label, short }, i) => {
    const isActive = id === active;
    return (
      <React.Fragment key={id}>
        {/* Section divider: the tab row reads as grouped sections
            instead of one undifferentiated run of labels. */}
        {i > 0 && (
          <span
            aria-hidden
            className="shrink-0 select-none px-1 text-[11px]"
            style={{ color: 'var(--np-rule)', fontFamily: 'var(--np-font-mono)' }}
          >
            |
          </span>
        )}
        <button
          onClick={() => onChange(id)}
          className="flex min-h-[44px] shrink-0 items-center justify-center whitespace-nowrap px-2 text-[11px] font-bold uppercase tracking-widest sm:px-3 sm:text-xs"
          style={{
            fontFamily: 'var(--np-font-mono)',
            color: isActive ? 'var(--np-accent)' : 'var(--np-muted)',
            borderBottom: isActive ? '3px solid var(--np-accent)' : '3px solid transparent',
          }}
        >
          <span className="hidden sm:inline">{label}</span>
          <span className="sm:hidden">{short ?? label}</span>
        </button>
      </React.Fragment>
    );
  });

  return (
    <nav
      className="newspaper"
      style={{ background: 'var(--np-paper)' }}
    >
      {centered ? (
        <div
          className="grid w-full grid-cols-[1fr_minmax(0,auto)_1fr] items-center gap-1 px-3 sm:px-4"
          data-testid="tabs-centered"
        >
          <span aria-hidden />
          <div className="np-tabs-scroll flex items-center justify-center overflow-x-auto">
            {tabButtons}
          </div>
          <div className="flex justify-end">{rightSlot}</div>
        </div>
      ) : (
        /* Full page width: every tab (through Settings) stays visible on a
           laptop without clipping; small screens scroll the row. */
        <div className="flex w-full items-center gap-1 px-3 sm:px-4">
          <div className="np-tabs-scroll flex flex-1 items-center overflow-x-auto">
            {tabButtons}
          </div>
          {rightSlot && <div className="ml-2 shrink-0">{rightSlot}</div>}
        </div>
      )}
    </nav>
  );
}

export default NewspaperViewTabs;
