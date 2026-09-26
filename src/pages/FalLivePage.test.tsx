import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { TestApp } from '@/test/TestApp';
import { LayoutStore, LayoutStoreContext } from '@/contexts/LayoutContext';
import { FalLivePage } from './FalLivePage';

const mocks = vi.hoisted(() => ({
  currentUser: null as { pubkey: string } | null,
}));

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: mocks.currentUser }),
}));

// The panel is the shared ₿AO chat (relay.bao.fund); stub it so this suite
// stays about the page chrome and its overlay architecture, not the protocol.
vi.mock('@/baofund/chat/ChatPanel', () => ({
  ChatPanel: () => <div data-testid="bao-chat-panel" />,
}));
vi.mock('@/baofund/chat/ChatContext', () => ({
  ChatProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('FalLivePage chat panel', () => {
  beforeEach(() => {
    mocks.currentUser = null;
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

  it('mounts the shared ₿AO chat panel for guests and authed users alike', async () => {
    renderPage();
    await screen.findByTestId('bao-chat-panel');
    expect(screen.getByText('TROLL₿OX')).toBeInTheDocument();
    // No members-only gate: the landing room is open to guests.
    expect(screen.queryByText('Members-only chat')).not.toBeInTheDocument();
  });

  it('never resizes the studio iframe when the chat expands (overlay architecture)', async () => {
    renderPage();
    await screen.findByTestId('bao-chat-panel');

    const studio = screen.getByTitle('fal.live AI generation studio');
    const main = screen.getByRole('main');
    const aside = main.querySelector('aside') as HTMLElement;
    const videoColumn = studio.parentElement as HTMLElement;

    expect(main.className).toContain('relative');
    expect(aside.className).toContain('absolute');
    expect(videoColumn.className).toContain('pb-11');

    const iframeClassBefore = studio.className;
    fireEvent.click(screen.getByRole('button', { name: 'Expand Trollbox' }));
    expect(screen.getByRole('button', { name: 'Collapse Trollbox' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTitle('fal.live AI generation studio')).toBe(studio);
    expect(studio.className).toBe(iframeClassBefore);
    expect(aside.className).toContain('h-[min(40dvh,360px)]');
  });
});
