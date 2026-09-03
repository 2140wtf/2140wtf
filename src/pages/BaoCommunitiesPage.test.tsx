import { render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { TestApp } from '@/test/TestApp';
import { BAO_HOSTED_ORIGIN } from '@/lib/baosocial/relayPolicy';
import { BaoCommunitiesPage } from './BaoCommunitiesPage';

const { signEvent } = vi.hoisted(() => ({ signEvent: vi.fn() }));

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({
    user: { pubkey: 'a'.repeat(64), signer: { signEvent } },
  }),
}));

describe('BaoCommunitiesPage', () => {
  it('embeds the canonical encrypted chat instead of showing a launcher card', async () => {
    render(
      <TestApp>
        <BaoCommunitiesPage />
      </TestApp>,
    );

    const chat = await screen.findByTitle('2140 Social Chat');
    expect(chat).toBeInstanceOf(HTMLIFrameElement);
    expect(chat).toHaveAttribute('src', BAO_HOSTED_ORIGIN);
    expect(screen.queryByText(/Room discovery and authentication run/)).not.toBeInTheDocument();
  });

  it('signs only well-formed authentication requests from the embedded chat window', async () => {
    const signed = { id: 'b'.repeat(64), pubkey: 'a'.repeat(64), sig: 'c'.repeat(128) };
    signEvent.mockResolvedValueOnce(signed);
    render(<TestApp><BaoCommunitiesPage /></TestApp>);
    const chat = await screen.findByTitle<HTMLIFrameElement>('2140 Social Chat');

    window.dispatchEvent(new MessageEvent('message', {
      origin: BAO_HOSTED_ORIGIN,
      source: chat.contentWindow,
      data: { type: '2140-chat-auth-request', requestId: 'd'.repeat(32), challenge: 'e'.repeat(32) },
    }));

    await waitFor(() => expect(signEvent).toHaveBeenCalledOnce());
    expect(signEvent).toHaveBeenCalledWith(expect.objectContaining({
      kind: 22242,
      tags: [['challenge', 'e'.repeat(32)], ['relay', 'wss://2140.social/ws']],
    }));
  });

  it('ignores authentication requests from any other origin', async () => {
    signEvent.mockClear();
    render(<TestApp><BaoCommunitiesPage /></TestApp>);
    const chat = await screen.findByTitle<HTMLIFrameElement>('2140 Social Chat');
    window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://attacker.example',
      source: chat.contentWindow,
      data: { type: '2140-chat-auth-request', requestId: 'd'.repeat(32), challenge: 'e'.repeat(32) },
    }));
    await Promise.resolve();
    expect(signEvent).not.toHaveBeenCalled();
  });
});

describe('FalLivePage Trollbox', () => {
  it('requests the metadata-minimized single-room view', () => {
    const source = readFileSync('src/pages/FalLivePage.tsx', 'utf8');
    expect(source).toContain('src={`${BAO_HOSTED_ORIGIN}/?room=trollbox&view=trollbox`}');
  });
});
