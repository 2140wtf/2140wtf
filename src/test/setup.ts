import '@testing-library/jest-dom';
import 'fake-indexeddb/auto';
import { vi } from 'vitest';

// jsdom replaces the global TextEncoder with an implementation whose output is
// a `Uint8Array` from a *different realm* — `instanceof Uint8Array` is false in
// test code. Libraries like @noble/hashes guard with `instanceof Uint8Array`
// and reject it ("expected Uint8Array, got object"). Wrap the global so encode()
// always returns a Uint8Array from this realm, matching real browser/Capacitor
// behaviour where seed derivation (sha256) works fine.
const OriginalTextEncoder = globalThis.TextEncoder;
class RealmSafeTextEncoder extends OriginalTextEncoder {
  override encode(input?: string): Uint8Array<ArrayBuffer> {
    return new Uint8Array(super.encode(input)) as Uint8Array<ArrayBuffer>;
  }
}
Object.defineProperty(globalThis, 'TextEncoder', {
  value: RealmSafeTextEncoder,
  writable: true,
  configurable: true,
});

// Node.js 22 has a built-in `localStorage` that lacks standard Web Storage API
// methods (getItem, setItem, etc.) unless `--localstorage-file` is provided.
// This conflicts with jsdom's proper localStorage, so we override the global.
const localStorageMap = new Map<string, string>();
const localStorageMock: Storage = {
  getItem: (key: string) => localStorageMap.get(key) ?? null,
  setItem: (key: string, value: string) => { localStorageMap.set(key, value); },
  removeItem: (key: string) => { localStorageMap.delete(key); },
  clear: () => { localStorageMap.clear(); },
  get length() { return localStorageMap.size; },
  key: (index: number) => [...localStorageMap.keys()][index] ?? null,
};
Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

// jsdom-only mocks: node-environment tests (e.g. real local-relay publish)
// have no `window`; skip these so they can run with the same setup file.
if (typeof window !== 'undefined') {
// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock window.scrollTo
Object.defineProperty(window, 'scrollTo', {
  writable: true,
  value: vi.fn(),
});

// cmdk/Radix keep the keyboard-highlighted option visible with this DOM API.
Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  writable: true,
  value: vi.fn(),
});

// Mock IntersectionObserver as a constructable class (components like
// LinkPreview call `new IntersectionObserver(...)`; a vi.fn arrow
// implementation is not constructable — same reason as ResizeObserver below).
// Callbacks never fire, so visibility-gated code stays in its "not visible" state.
global.IntersectionObserver = class IntersectionObserverMock implements IntersectionObserver {
  root: Element | Document | null = null;
  rootMargin = '';
  thresholds: ReadonlyArray<number> = [];
  constructor(_callback: IntersectionObserverCallback) {}
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] { return []; }
} as typeof IntersectionObserver;

// Mock ResizeObserver as a constructable class (cmdk calls `new
// ResizeObserver(...)`; a vi.fn arrow implementation is not constructable).
global.ResizeObserver = class ResizeObserverMock implements ResizeObserver {
  constructor(_callback: ResizeObserverCallback) {}
  observe() {}
  unobserve() {}
  disconnect() {}
} as typeof ResizeObserver;

// jsdom's TextEncoder returns a Uint8Array from a different realm, which fails
// `@noble/hashes`'s `instanceof Uint8Array` check ("expected Uint8Array, got
// object") — breaking any code that hashes (e.g. Blobbi seed derivation).
// Wrap `encode` so it yields a same-realm Uint8Array, matching real browsers.
{
  const OriginalTextEncoder = globalThis.TextEncoder;
  class SameRealmTextEncoder extends OriginalTextEncoder {
    override encode(input?: string): Uint8Array<ArrayBuffer> {
      return Uint8Array.from(super.encode(input)) as Uint8Array<ArrayBuffer>;
    }
  }
  globalThis.TextEncoder = SameRealmTextEncoder as typeof TextEncoder;
}
}
