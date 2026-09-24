import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TestApp } from '@/test/TestApp';
import { LayoutStore, LayoutStoreContext } from '@/contexts/LayoutContext';
import { BaoFundChatPage } from './BaoFundChatPage';

// Smoke test for the ported ₿AO Fund chat surface. The protocol stack
// (ChatProvider/useProtocolChat) opens relay sockets and hits the fund API, so
// the shell is tested with the panel stubbed — this verifies the page mounts,
// composes the provider tree, and exposes the fund-from-room callback contract.
vi.mock('@/baofund/chat/ChatContext', () => ({
  ChatProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const panelSpy = vi.fn();
vi.mock('@/baofund/chat/ChatPanel', () => ({
  ChatPanel: (props: { onFundCampaign?: (id: string, title: string) => void }) => {
    panelSpy(props);
    return <div data-testid="bao-chat-panel" />;
  },
}));

describe('BaoFundChatPage', () => {
  it('renders the ₿AO chat shell and passes the fund-from-room callback', async () => {
    render(
      <LayoutStoreContext.Provider value={new LayoutStore()}>
        <TestApp>
          <BaoFundChatPage />
        </TestApp>
      </LayoutStoreContext.Provider>,
    );

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/AO Chat/);
    expect(screen.getByTestId('bao-chat-panel')).toBeInTheDocument();
    expect(panelSpy).toHaveBeenCalledWith(
      expect.objectContaining({ onFundCampaign: expect.any(Function) }),
    );
  });
});
