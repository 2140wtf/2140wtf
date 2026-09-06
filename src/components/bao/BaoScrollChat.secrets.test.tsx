import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { TestApp } from '@/test/TestApp';
import { LayoutStore, LayoutStoreContext } from '@/contexts/LayoutContext';
import { BAO_TROLLBOX_ROOM } from '@/lib/baosocial/rooms';
import { BaoScrollChat } from './BaoScrollChat';

const mocks = vi.hoisted(() => ({
  currentUser: null as { pubkey: string } | null,
}));

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: mocks.currentUser }),
}));

// The encrypted scroll client opens its own WebSocket to the pinned relay.
// Mock the socket so tests never hit the network.
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
  send = vi.fn();
  close = vi.fn();
}
vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);

describe('BaoScrollChat secret hygiene', () => {
  beforeEach(() => {
    mocks.currentUser = { pubkey: 'a'.repeat(64) };
    MockWebSocket.instances.length = 0;
    vi.clearAllMocks();
  });

  it('source contains no nsec encoding or burner-key display (tripwire)', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/bao/BaoScrollChat.tsx'), 'utf-8');
    expect(source).not.toContain('nsecEncode');
    expect(source).not.toContain('Burner key');
    expect(source).not.toContain('authorSecretKey).slice');
  });

  it('renders the trollbox without ever putting secret material in the DOM', async () => {
    render(
      <LayoutStoreContext.Provider value={new LayoutStore()}>
        <TestApp>
          <BaoScrollChat lockedRoom={BAO_TROLLBOX_ROOM} embedded />
        </TestApp>
      </LayoutStoreContext.Provider>,
    );

    // The scroll client mounts and opens its pinned-relay socket.
    await vi.waitFor(() => {
      expect(MockWebSocket.instances.length).toBeGreaterThan(0);
    });
    // Let pending renders settle.
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Whatever state the session reaches, no part of the DOM may advertise a
    // secret key — even truncated. The burner is room-scoped and must never be
    // screen-sharable (this panel sits beside a live-stream page).
    expect(document.body.textContent).not.toMatch(/nsec1/i);
    expect(document.body.textContent).not.toMatch(/burner key/i);
  });
});
