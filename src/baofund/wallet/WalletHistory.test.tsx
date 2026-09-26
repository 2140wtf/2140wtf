import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WalletHistory, shortMintLabel } from './WalletHistory';
import { testnet4ExplorerTxUrl } from '../lib/testnet4Rail';
import { liquidTestnetExplorerTxUrl } from '../lib/liquidTestnetRail';
import type { WalletTransaction } from './walletHistory';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const tx = (over: Partial<WalletTransaction>): WalletTransaction => ({
  id: 't1',
  type: 'receive',
  mintUrl: 'https://mint.example.com/Bitcoin',
  amountSats: 42,
  at: 1_700_000_000_000,
  ...over,
});

it('renders an empty state and short mint labels', async () => {
  await act(async () => root.render(<WalletHistory transactions={[]} />));
  expect(container.textContent).toContain('No wallet activity yet.');
  expect(shortMintLabel('https://mint.example.com/Bitcoin/')).toBe('mint.example.com/Bitcoin');
  expect(shortMintLabel('not a url')).toBe('not a url');
});

it('renders entries with signed amounts and calls onClear', async () => {
  const onClear = vi.fn();
  await act(async () => root.render(
    <WalletHistory
      transactions={[
        tx({ id: 'a', type: 'send', amountSats: 100 }),
        tx({ id: 'b', type: 'topup', amountSats: 21 }),
        tx({ id: 'c', type: 'pay', amountSats: 5, feeSats: 1 }),
      ]}
      onClear={onClear}
    />,
  ));
  expect(container.querySelectorAll('[data-testid=wallet-history-item]').length).toBe(3);
  expect(container.textContent).toContain('Sent');
  expect(container.textContent).toContain('-100');
  expect(container.textContent).toContain('+21');
  expect(container.textContent).toContain('fee 1');

  const clear = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Clear');
  await act(async () => clear?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(onClear).toHaveBeenCalled();
});

it('renders rail sends with the chain label and an explorer tx link', async () => {
  const txid = 'ab'.repeat(32);
  await act(async () => root.render(
    <WalletHistory
      transactions={[
        tx({ id: 'r1', type: 'send', rail: 'l1', mintUrl: 'bitcoin-testnet4', amountSats: 500, feeSats: 12, txid }),
        tx({ id: 'r2', type: 'send', rail: 'liquid', mintUrl: 'liquid-testnet', amountSats: 100 }),
      ]}
    />,
  ));
  expect(container.textContent).toContain('Sent · Bitcoin testnet4');
  expect(container.textContent).toContain('Sent · Liquid testnet');
  const links = container.querySelectorAll('[data-testid=wallet-history-tx-link]');
  expect(links.length).toBe(1);
  const link = links[0] as HTMLAnchorElement;
  expect(link.getAttribute('href')).toBe(testnet4ExplorerTxUrl(txid));
  expect(link.getAttribute('href')).toContain('mempool.space');
  expect(link.textContent).toBe('tx ababab…abab');
  expect(link.getAttribute('title')).toContain(txid);
  expect(testnet4ExplorerTxUrl(txid)).not.toBe(liquidTestnetExplorerTxUrl(txid));
});
