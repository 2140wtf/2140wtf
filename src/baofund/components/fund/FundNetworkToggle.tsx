/**
 * FundNetworkToggle - switch the app between the testnet and demo (signet)
 * universes at runtime. The choice persists; the page reloads so every fetch
 * and cache is rebuilt against the selected universe.
 */
import { useSyncExternalStore } from 'react';

import {
  getFundNetwork,
  setFundNetwork,
  subscribeFundNetwork,
  type FundNetwork,
} from '../../lib/fundNetworkStore';

const OPTIONS: { id: FundNetwork; label: string; title: string }[] = [
  {
    id: 'testnet',
    label: 'Testnet',
    title: 'Non-custodial Fund API (testnet4 / Liquid): real testnet rails, no faucet',
  },
  {
    id: 'demo',
    label: 'Demo signet',
    title: 'Demo universe (private signet): fast faucet claims + instant demo-sat pledges',
  },
];

export function FundNetworkToggle({ onAfterSwitch }: { onAfterSwitch?: () => void } = {}) {
  const network = useSyncExternalStore(subscribeFundNetwork, getFundNetwork);

  const choose = (next: FundNetwork) => {
    if (next === network) return;
    setFundNetwork(next);
    if (onAfterSwitch) onAfterSwitch();
    else window.location.reload();
  };

  return (
    <div
      role="group"
      aria-label="Fund network"
      data-testid="fund-network-toggle"
      className="flex items-center border"
      style={{ borderColor: 'var(--np-rule)', fontFamily: 'var(--np-font-mono)' }}
    >
      {OPTIONS.map((option) => {
        const active = network === option.id;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => choose(option.id)}
            title={option.title}
            aria-pressed={active}
            data-testid={`fund-network-${option.id}`}
            className="px-2 py-1 text-[10px] uppercase tracking-widest"
            style={
              active
                ? { background: 'var(--np-ink)', color: 'var(--np-paper)' }
                : { background: 'transparent', color: 'var(--np-muted)' }
            }
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
