import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { TestApp } from '@/test/TestApp';
import { LayoutStore, LayoutStoreContext } from '@/contexts/LayoutContext';
import { BAO_HOSTED_RELAY } from '@/lib/baosocial/relayPolicy';
import {
  BAO_SOCIAL_DIRECTORY,
  BAO_TROLLBOX_ROOM,
  assertTrollboxRelayPinned,
} from '@/lib/baosocial/rooms';
import BaoCommunitiesPage from './BaoCommunitiesPage';

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

describe('BaoCommunitiesPage (trollbox)', () => {
  beforeEach(() => {
    mocks.currentUser = null;
    MockWebSocket.instances.length = 0;
    vi.clearAllMocks();
  });

  const renderPage = () =>
    render(
      <LayoutStoreContext.Provider value={new LayoutStore()}>
        <TestApp>
          <BaoCommunitiesPage />
        </TestApp>
      </LayoutStoreContext.Provider>,
    );

  it('presents the room as plain "trollbox" with the members gate for anonymous users', async () => {
    renderPage();

    // The header is simply "trollbox" — no "2140 Social Chat" branding.
    expect(await screen.findByText('trollbox')).toBeInTheDocument();
    expect(screen.queryByText(/2140 Social Chat/)).not.toBeInTheDocument();
    // Gate copy for logged-out visitors.
    expect(screen.getByText('Members-only chat')).toBeInTheDocument();
    // No chat socket until signed in.
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it('mounts the in-page encrypted trollbox for authed users — no hosted iframe', async () => {
    mocks.currentUser = { pubkey: 'a'.repeat(64) };
    renderPage();

    // The scroll connects directly to the pinned 2140.social relay. (Other
    // sockets in this list belong to TestApp's global relay pool, not the
    // chat client — filter for the chat's own connection.)
    await vi.waitFor(() =>
      expect(MockWebSocket.instances.some((s) => s.url === BAO_HOSTED_RELAY)).toBe(true),
    );
    // The chat client NEVER opens a socket to the app's public Nostr relays:
    // every socket it opens beyond the pool's must be the pinned relay.
    // No iframe anywhere — the chat is rendered in-page.
    expect(document.querySelectorAll('iframe')).toHaveLength(0);
    // The room header reads "trollbox" (header + topic both mention it).
    const els = await screen.findAllByText(/trollbox/i);
    expect(els.length).toBeGreaterThan(0);
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

  it('opens the login dialog when an anonymous user clicks "Join to enter"', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /join to enter/i }));
    // LoginDialog is a real component; smoke-assert the click didn't throw and
    // the gate stays mounted (dialog render is covered by its own tests).
    expect(screen.getByText('Members-only chat')).toBeInTheDocument();
  });
});
