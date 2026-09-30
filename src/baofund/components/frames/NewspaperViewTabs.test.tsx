import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NewspaperViewTabs } from './NewspaperViewTabs';

type TabId = 'campaigns' | 'agents';
const OPTIONS: Array<{ id: TabId; label: string; short?: string }> = [
  { id: 'campaigns', label: 'View Campaigns', short: 'Campaigns' },
  { id: 'agents', label: 'Fund Me', short: 'Fund Me' },
];

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

async function render(overrides: {
  centered?: boolean;
  rightSlot?: React.ReactNode;
  onChange?: (id: TabId) => void;
} = {}) {
  await act(async () => root.render(
    <NewspaperViewTabs
      active="campaigns"
      options={OPTIONS}
      onChange={overrides.onChange ?? (() => undefined)}
      centered={overrides.centered}
      rightSlot={overrides.rightSlot}
    />,
  ));
}

it('renders left-aligned by default', async () => {
  await render();
  expect(container.querySelector('[data-testid=tabs-centered]')).toBeNull();
});

it('centers the tab group and keeps the right slot at the edge', async () => {
  await render({ centered: true, rightSlot: <button type="button">gear</button> });
  const grid = container.querySelector('[data-testid=tabs-centered]');
  expect(grid).toBeTruthy();
  expect(grid?.className).toContain('grid-cols-[1fr_minmax(0,auto)_1fr]');
  expect(container.textContent).toContain('gear');
  expect(container.textContent).toContain('View Campaigns');
});

it('fires onChange on tab click', async () => {
  const onChange = vi.fn();
  await render({ centered: true, onChange });
  const btn = [...container.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Fund Me')) as HTMLButtonElement;
  await act(async () => btn.click());
  expect(onChange).toHaveBeenCalledWith('agents');
});
