import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { TestApp } from '@/test/TestApp';
import { LayoutStore, LayoutStoreContext } from '@/contexts/LayoutContext';
import { BAO_HOSTED_RELAY } from '@/lib/baosocial/relayPolicy';
import {
  BAO_SOCIAL_DIRECTORY,
  BAO_TROLLBOX_ROOM,
  assertTrollboxRelayPinned,
} from '@/lib/baosocial/rooms';
import { FalLivePage } from './FalLivePage';

const mocks = vi.hoisted(() => ({
  currentUser: null as { pubkey: string } | null,
}));

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: mocks.currentUser }),
}));

// The encrypted scroll client opens its own WebSocket to the pinned relay.
// Mock the socket so tests never hit the network; the component under test
// must NOT receive any publish path toward the app's relays.
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

describe('FalLivePage trollbox', () => {
  beforeEach(() => {
    mocks.currentUser = null;
    MockWebSocket.instances.length = 0;
    vi.clearAllMocks();
  });

  const renderPage = () =>
    render(
      <LayoutStoreContext.Provider value={new LayoutStore()}>
        <TestApp>
          <FalLivePage />
        </TestApp>
      </LayoutStoreContext.Provider>,
    );

  it('shows the members-only gate for anonymous users (no chat socket)', async () => {
    renderPage();

    expect(await screen.findByText('Members-only chat')).toBeInTheDocument();
    // No scroll connection at all for logged-out visitors.
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it('mounts the in-page encrypted scroll for authed users — no redirect to the hosted origin', async () => {
    mocks.currentUser = { pubkey: 'a'.repeat(64) };
    renderPage();

    // The gate is gone — the chat panel is mounted in-page — and the studio
    // iframe is still fal.live. Both resolve once the authed branch renders.
    await vi.waitFor(() => {
      expect(screen.queryByText('Members-only chat')).not.toBeInTheDocument();
      expect(screen.getByText('TROLLBOX')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'SIGN OUT' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Expand Trollbox' })).toHaveAttribute('aria-expanded', 'false');
      expect(MockWebSocket.instances.length).toBeGreaterThan(0);
      const studio = screen.getByTitle('fal.live AI generation studio');
      expect(studio).toHaveAttribute('src', expect.stringContaining('fal.live'));
      expect(studio.className).toContain('flex-1');
    });

    // Expanding is opt-in so the live answer controls keep the available
    // mobile height until the viewer explicitly opens the chat.
    const expand = screen.getByRole('button', { name: 'Expand Trollbox' });
    fireEvent.click(expand);
    expect(screen.getByRole('button', { name: 'Collapse Trollbox' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('connects ONLY to the pinned 2140.social relay — never the app relays', async () => {
    mocks.currentUser = { pubkey: 'a'.repeat(64) };
    renderPage();

    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBeGreaterThan(0));
    for (const sock of MockWebSocket.instances) {
      expect(sock.url).toBe(BAO_HOSTED_RELAY);
    }
  });

  it('relay-pin guard accepts the bundled trollbox room', () => {
    expect(() => assertTrollboxRelayPinned(BAO_TROLLBOX_ROOM)).not.toThrow();
    expect(BAO_SOCIAL_DIRECTORY.relayUrl).toBe(BAO_HOSTED_RELAY);
  });

  it('relay-pin guard fails closed if the directory drifts to another relay', () => {
    const original = BAO_SOCIAL_DIRECTORY.relayUrl;
    try {
      (BAO_SOCIAL_DIRECTORY as { relayUrl: string }).relayUrl = 'wss://evil.example/ws';
      expect(() => assertTrollboxRelayPinned(BAO_TROLLBOX_ROOM)).toThrow(
        /relay policy violated/i,
      );
    } finally {
      (BAO_SOCIAL_DIRECTORY as { relayUrl: string }).relayUrl = original;
    }
  });

  it('relay-pin guard rejects external-redirect rows masquerading as rooms', () => {
    expect(() =>
      assertTrollboxRelayPinned({ ...BAO_TROLLBOX_ROOM, externalUrl: 'https://evil.example' }),
    ).toThrow(/external redirect/i);
  });
});
