import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TestApp } from '@/test/TestApp';
import { LayoutStore, LayoutStoreContext } from '@/contexts/LayoutContext';
import { BaoFundChatPage } from './BaoFundChatPage';

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: null }),
}));

const mocks = vi.hoisted(() => ({
  locationState: null as null | { defaultRoomName?: string; campaignRoomId?: string; title?: string },
  chat: {
    importCampaign: vi.fn(async () => ({ roomId: 'room-1' }) as { roomId: string } | null),
    selectRoom: vi.fn(async () => {}),
  },
}));

vi.mock('react-router-dom', async (original) => ({
  ...(await original<typeof import('react-router-dom')>()),
  useLocation: () => ({ state: mocks.locationState, pathname: '/community', search: '', hash: '', key: 'test' }),
}));

// The protocol stack opens relay sockets and hits the fund API; stub the
// provider + context and assert the shell and the campaign-room deep link.
vi.mock('@/baofund/chat/ChatContext', () => ({
  ChatProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useChatContext: () => mocks.chat,
}));

const panelSpy = vi.fn();
vi.mock('@/baofund/chat/ChatPanel', () => ({
  ChatPanel: (props: { defaultRoomName?: string | null; onFundCampaign?: (id: string, title: string) => void }) => {
    panelSpy(props);
    return <div data-testid="bao-chat-panel" />;
  },
}));

function renderPage() {
  return render(
    <LayoutStoreContext.Provider value={new LayoutStore()}>
      <TestApp>
        <BaoFundChatPage />
      </TestApp>
    </LayoutStoreContext.Provider>,
  );
}

describe('BaoFundChatPage', () => {
  beforeEach(() => {
    mocks.locationState = null;
    mocks.chat.importCampaign.mockClear();
    mocks.chat.selectRoom.mockClear();
    panelSpy.mockClear();
  });

  it('renders the ₿AO chat shell and passes the fund-from-room callback', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/^₿AO$/);
    expect(screen.getByTestId('bao-chat-panel')).toBeInTheDocument();
    expect(panelSpy).toHaveBeenCalledWith(
      expect.objectContaining({ onFundCampaign: expect.any(Function) }),
    );
  });

  it('lands on a public room from the gate deep link', async () => {
    mocks.locationState = { defaultRoomName: 'Trollbox' };
    renderPage();

    await screen.findByTestId('bao-chat-panel');
    expect(panelSpy).toHaveBeenCalledWith(expect.objectContaining({ defaultRoomName: 'Trollbox' }));
  });

  it('imports and opens a campaign room from the fund page deep link', async () => {
    mocks.locationState = { campaignRoomId: 'fr-42', title: 'Fizz Campaign' };
    renderPage();

    await waitFor(() =>
      expect(mocks.chat.importCampaign).toHaveBeenCalledWith('fr-42', 'Fizz Campaign', expect.anything()),
    );
    await waitFor(() => expect(mocks.chat.selectRoom).toHaveBeenCalledWith('room-1'));
  });
});
