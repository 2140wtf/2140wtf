import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SatsPresetPills, WALLET_SATS_PRESETS, presetLabel } from './SatsPresetPills';

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

async function render(props: React.ComponentProps<typeof SatsPresetPills>): Promise<void> {
  await act(async () => root.render(<SatsPresetPills {...props} />));
}

it('renders the ₿AO preset ladder and reports the picked amount', async () => {
  const onSelect = vi.fn();
  await render({ value: '', onSelect });
  const pills = container.querySelectorAll('button[data-testid^=sats-preset-]');
  expect(pills.length).toBe(WALLET_SATS_PRESETS.length);
  expect(container.textContent).toContain('2,140');
  expect(container.textContent).toContain('21.4k');

  await act(async () => {
    container.querySelector('[data-testid=sats-preset-2140]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  expect(onSelect).toHaveBeenCalledWith(2140);
});

it('highlights the pill matching the current value exactly', async () => {
  await render({ value: '2140', onSelect: vi.fn() });
  const active = container.querySelector('[data-testid=sats-preset-2140]') as HTMLButtonElement;
  const inactive = container.querySelector('[data-testid=sats-preset-1000]') as HTMLButtonElement;
  expect(active.getAttribute('aria-pressed')).toBe('true');
  expect(inactive.getAttribute('aria-pressed')).toBe('false');
});

it('disables every pill while a wallet action is in flight', async () => {
  await render({ value: '', onSelect: vi.fn(), disabled: true });
  for (const pill of Array.from(container.querySelectorAll('button[data-testid^=sats-preset-]'))) {
    expect((pill as HTMLButtonElement).disabled).toBe(true);
  }
});

it('labels presets the 2140 way', () => {
  expect(presetLabel(100)).toBe('100');
  expect(presetLabel(2140)).toBe('2,140');
  expect(presetLabel(10000)).toBe('10k');
  expect(presetLabel(21400)).toBe('21.4k');
  expect(presetLabel(214000)).toBe('214k');
});
