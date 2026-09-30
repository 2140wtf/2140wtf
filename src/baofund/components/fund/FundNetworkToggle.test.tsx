import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { FundNetworkToggle } from './FundNetworkToggle';
import { getFundNetwork } from '../../lib/fundNetworkStore';

let root: Root | null = null;
let container: HTMLDivElement;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container.remove();
  localStorage.clear();
});

const pressed = (id: string) =>
  container.querySelector(`[data-testid="fund-network-${id}"]`)?.getAttribute('aria-pressed');

it('shows the active universe and switches to demo (persist + reload hook)', async () => {
  const onAfterSwitch = vi.fn();
  await act(async () => {
    root!.render(<FundNetworkToggle onAfterSwitch={onAfterSwitch} />);
  });
  expect(pressed('testnet')).toBe('true');
  expect(pressed('demo')).toBe('false');

  await act(async () => {
    (container.querySelector('[data-testid="fund-network-demo"]') as HTMLButtonElement).click();
  });

  expect(getFundNetwork()).toBe('demo');
  expect(onAfterSwitch).toHaveBeenCalledTimes(1);
  expect(pressed('demo')).toBe('true');
  expect(pressed('testnet')).toBe('false');
});

it('does nothing when the active universe is clicked', async () => {
  const onAfterSwitch = vi.fn();
  await act(async () => {
    root!.render(<FundNetworkToggle onAfterSwitch={onAfterSwitch} />);
  });
  await act(async () => {
    (container.querySelector('[data-testid="fund-network-testnet"]') as HTMLButtonElement).click();
  });
  expect(onAfterSwitch).not.toHaveBeenCalled();
  expect(getFundNetwork()).toBe('testnet');
});
