import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CashuTokenQr, shouldAnimateToken } from './CashuTokenQr';

const state = vi.hoisted(() => ({ failEncoder: false, frames: 0 }));

vi.mock('@/baofund/cashu-wallet/lib/cashu/nut16', () => ({
  CashuUrEncoder: class {
    partCount = 4;
    constructor() {
      if (state.failEncoder) throw new Error('too large');
    }
    nextPart(): string {
      state.frames += 1;
      return `ur:bytes/frame-${state.frames}`;
    }
  },
}));

const SHORT_TOKEN = 'cashuBsmall-static-token';
const ANIMATED_TOKEN = `cashuB${'A'.repeat(1000)}`;
const HUGE_TOKEN = `cashuB${'A'.repeat(3500)}`;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.failEncoder = false;
  state.frames = 0;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  // @ts-expect-error remove the per-test matchMedia stub
  delete window.matchMedia;
});

async function render(props: React.ComponentProps<typeof CashuTokenQr>): Promise<void> {
  await act(async () => root.render(<CashuTokenQr {...props} />));
}

function stubReducedMotion(reduce: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

it('flags only large or multi-proof tokens for animation', () => {
  expect(shouldAnimateToken(SHORT_TOKEN)).toBe(false);
  expect(shouldAnimateToken(ANIMATED_TOKEN)).toBe(true);
});

it('renders a small token as a static SVG data-URL QR without loading the UR encoder', async () => {
  await render({ token: SHORT_TOKEN, caption: 'Scan with a Cashu wallet' });
  await vi.waitFor(() => {
    expect(container.querySelector('[data-testid=cashu-token-qr-image]')).toBeTruthy();
  }, { timeout: 5000 });
  const img = container.querySelector('[data-testid=cashu-token-qr-image]') as HTMLImageElement;
  expect(img.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
  expect(container.textContent).toContain('Scan with a Cashu wallet');
  expect(container.textContent).not.toContain('Animated QR');
});

it('animates large tokens and exposes manual frame advance under reduced motion', async () => {
  stubReducedMotion(true);
  await render({ token: ANIMATED_TOKEN });
  await vi.waitFor(() => {
    expect(container.textContent).toContain('Animated QR · 4 fragments');
  }, { timeout: 5000 });
  await vi.waitFor(() => {
    expect(container.querySelector('[data-testid=cashu-token-qr-image]')).toBeTruthy();
  }, { timeout: 5000 });

  const framesBefore = state.frames;
  const next = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Next QR frame'));
  expect(next).toBeTruthy();
  await act(async () => next?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(state.frames).toBeGreaterThan(framesBefore);
});

it('degrades to a static QR when the UR encoder cannot be constructed', async () => {
  state.failEncoder = true;
  await render({ token: ANIMATED_TOKEN });
  await vi.waitFor(() => {
    expect(container.querySelector('[data-testid=cashu-token-qr-static-note]')).toBeTruthy();
  }, { timeout: 5000 });
  expect(container.querySelector('[data-testid=cashu-token-qr-image]')).toBeTruthy();
  expect(container.textContent).not.toContain('Animated QR');
});

it('points at the token text when even a static QR cannot hold it', async () => {
  state.failEncoder = true;
  await render({ token: HUGE_TOKEN });
  await vi.waitFor(() => {
    expect(container.textContent).toContain('too large for a QR code');
  }, { timeout: 5000 });
});
