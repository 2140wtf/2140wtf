import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TestApp } from '@/test/TestApp';
import { BAO_HOSTED_ORIGIN } from '@/lib/baosocial/relayPolicy';
import {
  CHAT_AUTH_OFFER,
  CHAT_AUTH_REQUEST,
  CHAT_AUTH_RESPONSE,
} from '@/lib/baosocial/chatParentAuth';
import { BaoCommunitiesPage } from './BaoCommunitiesPage';

const hex32 = () =>
  Array.from({ length: 32 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');

const mocks = vi.hoisted(() => ({
  currentUser: null as {
    pubkey: string;
    signer: { signEvent: (t: unknown) => Promise<import('@/lib/baosocial/chatParentAuth').ChatAuthResponse['event'] & object> };
  } | null,
  openUrl: vi.fn(),
}));

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: mocks.currentUser }),
}));

vi.mock('@/lib/downloadFile', () => ({
  openUrl: mocks.openUrl,
}));

describe('BaoCommunitiesPage', () => {
  afterEach(() => {
    mocks.currentUser = null;
    mocks.openUrl.mockClear();
  });

  it('embeds the canonical encrypted chat instead of showing a launcher card', async () => {
    render(
      <TestApp>
        <BaoCommunitiesPage />
      </TestApp>,
    );

    const chat = await screen.findByTitle('2140 Community Chat');
    expect(chat).toBeInstanceOf(HTMLIFrameElement);
    expect(chat.getAttribute('src')?.startsWith(BAO_HOSTED_ORIGIN)).toBe(true);
    expect(screen.queryByText(/Room discovery and authentication run/)).not.toBeInTheDocument();
  });

  it('offers the logged-in identity to the chat gate', async () => {
    const privkey = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
    const { getPublicKey, finalizeEvent } = await import('nostr-tools');
    const pubkey = getPublicKey(privkey);
    mocks.currentUser = {
      pubkey,
      signer: {
        signEvent: async (t) =>
          (await finalizeEvent(t as never, privkey)) as unknown as import(
            '@/lib/baosocial/chatParentAuth'
          ).ChatAuthResponse['event'] & object,
      },
    };

    const posted: { payload: unknown; targetOrigin: string }[] = [];
    const postMessageSpy = vi
      .spyOn(window.HTMLIFrameElement.prototype, 'contentWindow', 'get')
      .mockReturnValue({
        postMessage: (payload: unknown, targetOrigin: string) => {
          posted.push({ payload, targetOrigin });
        },
      } as unknown as Window);

    render(
      <TestApp>
        <BaoCommunitiesPage />
      </TestApp>,
    );

    await screen.findByTitle('2140 Community Chat');

    await waitFor(() => {
      expect(
        posted.some(
          (p) =>
            p.targetOrigin === BAO_HOSTED_ORIGIN &&
            typeof p.payload === 'object' &&
            p.payload !== null &&
            (p.payload as { type?: string }).type === CHAT_AUTH_OFFER &&
            (p.payload as { pubkey?: string }).pubkey === pubkey,
        ),
      ).toBe(true);
    });

    postMessageSpy.mockRestore();
  });

  it('signs the gate challenge with the current user and answers the iframe', async () => {
    const privkey = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
    const { getPublicKey, finalizeEvent } = await import('nostr-tools');
    const pubkey = getPublicKey(privkey);
    mocks.currentUser = {
      pubkey,
      signer: {
        signEvent: async (t) =>
          (await finalizeEvent(t as never, privkey)) as unknown as import(
            '@/lib/baosocial/chatParentAuth'
          ).ChatAuthResponse['event'] & object,
      },
    };

    const posted: { payload: unknown; targetOrigin: string }[] = [];
    const contentWindowStub = {
      postMessage: (payload: unknown, targetOrigin: string) => {
        posted.push({ payload, targetOrigin });
      },
    } as unknown as Window;
    const postMessageSpy = vi
      .spyOn(window.HTMLIFrameElement.prototype, 'contentWindow', 'get')
      .mockReturnValue(contentWindowStub);

    render(
      <TestApp>
        <BaoCommunitiesPage />
      </TestApp>,
    );

    const chat = (await screen.findByTitle('2140 Community Chat')) as HTMLIFrameElement;

    await waitFor(() => {
      expect(posted.some((p) => (p.payload as { type?: string })?.type === CHAT_AUTH_OFFER)).toBe(
        true,
      );
    });

    // The gate asks the parent to sign its 32-hex challenge.
    const challenge = hex32();
    const requestId = 'a'.repeat(32);
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: BAO_HOSTED_ORIGIN,
        source: chat.contentWindow as MessageEventSource | null,
        data: { type: CHAT_AUTH_REQUEST, requestId, challenge },
      }),
    );

    await waitFor(() => {
      const response = posted.find(
        (p) => (p.payload as { type?: string })?.type === CHAT_AUTH_RESPONSE,
      );
      expect(response).toBeDefined();
      expect(response!.targetOrigin).toBe(BAO_HOSTED_ORIGIN);
      const payload = response!.payload as {
        requestId: string;
        event?: { kind: number; pubkey: string; tags: string[][] };
        error?: string;
      };
      expect(payload.requestId).toBe(requestId);
      expect(payload.error).toBeUndefined();
      expect(payload.event).toBeDefined();
      expect(payload.event!.kind).toBe(22242);
      expect(payload.event!.pubkey).toBe(pubkey);
      expect(payload.event!.tags).toEqual(
        expect.arrayContaining([
          ['challenge', challenge],
          ['relay', 'wss://2140.social/ws'],
        ]),
      );
    });

    postMessageSpy.mockRestore();
  });

  it('answers the challenge with an error when logged out', async () => {
    const posted: { payload: unknown; targetOrigin: string }[] = [];
    const contentWindowStub = {
      postMessage: (payload: unknown, targetOrigin: string) => {
        posted.push({ payload, targetOrigin });
      },
    } as unknown as Window;
    const postMessageSpy = vi
      .spyOn(window.HTMLIFrameElement.prototype, 'contentWindow', 'get')
      .mockReturnValue(contentWindowStub);

    render(
      <TestApp>
        <BaoCommunitiesPage />
      </TestApp>,
    );

    const chat = (await screen.findByTitle('2140 Community Chat')) as HTMLIFrameElement;

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: BAO_HOSTED_ORIGIN,
        source: chat.contentWindow as MessageEventSource | null,
        data: { type: CHAT_AUTH_REQUEST, requestId: 'b'.repeat(32), challenge: hex32() },
      }),
    );

    await waitFor(() => {
      const response = posted.find(
        (p) => (p.payload as { type?: string })?.type === CHAT_AUTH_RESPONSE,
      );
      expect(response).toBeDefined();
      expect((response!.payload as { error?: string }).error).toBe(
        'not logged in on 2140.wtf',
      );
    });

    postMessageSpy.mockRestore();
  });

  it('ignores auth requests from other origins', async () => {
    const posted: { payload: unknown; targetOrigin: string }[] = [];
    const contentWindowStub = {
      postMessage: (payload: unknown, targetOrigin: string) => {
        posted.push({ payload, targetOrigin });
      },
    } as unknown as Window;
    const postMessageSpy = vi
      .spyOn(window.HTMLIFrameElement.prototype, 'contentWindow', 'get')
      .mockReturnValue(contentWindowStub);

    render(
      <TestApp>
        <BaoCommunitiesPage />
      </TestApp>,
    );

    const chat = (await screen.findByTitle('2140 Community Chat')) as HTMLIFrameElement;

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://evil.example',
        source: chat.contentWindow as MessageEventSource | null,
        data: { type: CHAT_AUTH_REQUEST, requestId: 'c'.repeat(32), challenge: hex32() },
      }),
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(
      posted.some((p) => (p.payload as { type?: string })?.type === CHAT_AUTH_RESPONSE),
    ).toBe(false);

    postMessageSpy.mockRestore();
  });

  it('opens the chat separately when the header button is clicked', async () => {
    render(
      <TestApp>
        <BaoCommunitiesPage />
      </TestApp>,
    );

    await screen.findByTitle('2140 Community Chat');
    fireEvent.click(screen.getByRole('button', { name: /open separately/i }));
    expect(mocks.openUrl).toHaveBeenCalledWith(BAO_HOSTED_ORIGIN);
  });
});
