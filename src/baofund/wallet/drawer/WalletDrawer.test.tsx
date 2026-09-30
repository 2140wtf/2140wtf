/**
 * WalletDrawer tests — open/close via the global event (the bao.markets
 * pattern), tab switching, and Escape-to-close. Rail scans run against
 * jsdom's absent network and surface as honest error rows; the drawer shell
 * must still render and stay interactive.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// 2140's auth hook is adapted (own provider elsewhere); the drawer only needs
// a signed-in-shaped context for this shell test.
vi.mock('../../auth/useAuth', () => ({
  useAuth: () => ({
    status: 'ready',
    pubkey: 'ab'.repeat(32),
    seedIdentityHex: null,
    signer: { signEvent: async (e: unknown) => e, getPublicKey: async () => 'ab'.repeat(32) },
  }),
}));
import { WalletDrawer } from './WalletDrawer';
import { WalletDrawerProvider, useWalletDrawer } from './WalletDrawerContext';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderDrawer(): Promise<void> {
  await act(async () => {
    root.render(
      <WalletDrawerProvider>
        <WalletDrawer />
      </WalletDrawerProvider>,
    );
  });
}

async function openDrawer(): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new CustomEvent('bao-open-wallet-drawer', { detail: { tab: 'balances' } }));
  });
}

it('opens from the global event and renders the rail inventory', async () => {
  await renderDrawer();
  expect(container.querySelector('[data-testid=wallet-drawer]')).toBeNull();
  await openDrawer();
  expect(container.querySelector('[data-testid=wallet-drawer]')).toBeTruthy();
  expect(container.textContent).toContain('Cashu (this browser)');
  expect(container.textContent).toContain('Bitcoin testnet4');
  expect(container.textContent).toContain('Liquid testnet');
});

it('switches tabs and closes on Escape', async () => {
  await renderDrawer();
  await openDrawer();
  const send = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Send') as HTMLButtonElement;
  await act(async () => send.click());
  expect(container.querySelector('[data-testid=drawer-send]')).toBeTruthy();

  const history = [...container.querySelectorAll('button')].find((b) => b.textContent === 'History') as HTMLButtonElement;
  await act(async () => history.click());
  expect(container.querySelector('[data-testid=drawer-history]')).toBeTruthy();

  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });
  expect(container.querySelector('[data-testid=wallet-drawer]')).toBeNull();
});

it('closes via the global close event', async () => {
  await renderDrawer();
  await openDrawer();
  await act(async () => {
    window.dispatchEvent(new Event('bao-close-wallet-drawer'));
  });
  expect(container.querySelector('[data-testid=wallet-drawer]')).toBeNull();
});

it('does not carry a stale send intent into a later plain open', async () => {
  const probe = React.createRef<HTMLSpanElement>();
  function IntentProbe(): React.ReactElement {
    const { sendIntent, openDrawer } = useWalletDrawer();
    return (
      <div>
        <span data-testid="intent" ref={probe}>{sendIntent?.to ?? 'none'}</span>
        <button type="button" data-testid="plain-open" onClick={() => openDrawer({ tab: 'send' })}>open</button>
      </div>
    );
  }
  await act(async () => {
    root.render(
      <WalletDrawerProvider>
        <IntentProbe />
        <WalletDrawer />
      </WalletDrawerProvider>,
    );
  });
  // A pledge pre-fills the escrow address…
  await act(async () => {
    window.dispatchEvent(new CustomEvent('bao-open-wallet-drawer', {
      detail: { tab: 'send', rail: 'l1', to: 'tb1pstaleescrowaddress', sats: '25000' },
    }));
  });
  expect(container.querySelector('[data-testid=intent]')?.textContent).toBe('tb1pstaleescrowaddress');

  // …the user closes the drawer, and a later plain open must NOT re-prefill it.
  await act(async () => {
    window.dispatchEvent(new CustomEvent('bao-close-wallet-drawer'));
  });
  await act(async () => {
    (container.querySelector('[data-testid=plain-open]') as HTMLButtonElement).click();
  });
  expect(container.querySelector('[data-testid=intent]')?.textContent).toBe('none');
});
