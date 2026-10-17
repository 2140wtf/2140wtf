/**
 * VoiceCallBar — the in-chat call surface contract (ADR v10.2 §6): join muted
 * with E2EE, text+icon state, leave, presence hint, fail-closed when the
 * broker is not configured. Rendered with the repo's createRoot pattern.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VoicePresence } from '@/baofund/community/voicePresence.js';
import { VoiceCallBar } from './VoiceCallBar';
import type { VoiceSdk, VoiceSdkRoom } from './call';

const MATERIAL = { voiceRoot: 'ab'.repeat(32), voiceGeneration: 0 };
const IDENTITY = 'ab'.repeat(16);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function makeRoom(): { room: VoiceSdkRoom; setMic: ReturnType<typeof vi.fn>; leave: ReturnType<typeof vi.fn> } {
  const setMic = vi.fn(async () => {});
  const leave = vi.fn(async () => {});
  const room: VoiceSdkRoom = {
    setMicrophoneEnabled: setMic,
    leave,
    participants: () => [{ identity: IDENTITY, speaking: false, muted: false }],
  };
  return { room, setMic, leave };
}

function makeSdk(room: VoiceSdkRoom): { sdk: VoiceSdk; join: ReturnType<typeof vi.fn> } {
  const join = vi.fn(async () => room);
  return { sdk: { join } as VoiceSdk, join };
}

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ token: `tok_${'x'.repeat(32)}`, url: 'wss://av.example', identity: IDENTITY }),
    })),
  );
}

function renderBar(overrides: Partial<React.ComponentProps<typeof VoiceCallBar>> = {}) {
  const listeners = new Set<(presence: VoicePresence) => void>();
  const postPresence = vi.fn(async () => true);
  const subscribePresence = vi.fn((_roomId: string, listener: (presence: VoicePresence) => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  });
  const props = {
    roomId: '0011223344556677',
    material: MATERIAL,
    postPresence,
    subscribePresence,
    brokerOrigin: 'https://voice.example',
    ...overrides,
  };
  act(() => {
    root.render(<VoiceCallBar {...props} />);
  });
  return { listeners, postPresence };
}

async function click(testId: string): Promise<void> {
  const button = container.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement | null;
  expect(button).not.toBeNull();
  await act(async () => {
    button!.click();
  });
}

describe('VoiceCallBar', () => {
  it('joins a muted E2EE call and shows the private indicator + roster', async () => {
    const { room, setMic } = makeRoom();
    const { sdk, join } = makeSdk(room);
    stubFetch();
    renderBar({ sdk });
    await click('voice-join');
    await vi.waitFor(() => expect(container.querySelector('[data-testid="voice-mute"]')).not.toBeNull());
    expect(join).toHaveBeenCalledWith(expect.objectContaining({ e2ee: true, identity: IDENTITY, url: 'wss://av.example' }));
    expect(setMic).toHaveBeenCalledWith(false); // join muted
    expect(container.textContent).toContain('private · E2EE');
    expect(container.textContent).toContain('1 in call');
    expect(container.textContent).toContain(IDENTITY.slice(0, 6));
    expect(container.textContent).toContain('Muted');
  });

  it('shows the operator kick chip only with moderation and fires the identity', async () => {
    const { room } = makeRoom();
    const { sdk } = makeSdk(room);
    stubFetch();
    const onKickParticipant = vi.fn();
    renderBar({ sdk, canModerate: true, onKickParticipant });
    await click('voice-join');
    await vi.waitFor(() => expect(container.querySelector('[data-testid="voice-mute"]')).not.toBeNull());
    const chip = container.querySelector(`[aria-label="Remove ${IDENTITY.slice(0, 6)} from the call"]`) as HTMLButtonElement | null;
    expect(chip).not.toBeNull();
    await act(async () => {
      chip!.click();
    });
    expect(onKickParticipant).toHaveBeenCalledWith(IDENTITY);
  });

  it('hides the kick chip without moderation', async () => {
    const { room } = makeRoom();
    const { sdk } = makeSdk(room);
    stubFetch();
    renderBar({ sdk });
    await click('voice-join');
    await vi.waitFor(() => expect(container.querySelector('[data-testid="voice-mute"]')).not.toBeNull());
    expect(container.querySelector(`[aria-label="Remove ${IDENTITY.slice(0, 6)} from the call"]`)).toBeNull();
  });

  it('toggles the microphone with text+icon state', async () => {
    const { room, setMic } = makeRoom();
    const { sdk } = makeSdk(room);
    stubFetch();
    renderBar({ sdk });
    await click('voice-join');
    await vi.waitFor(() => expect(container.querySelector('[data-testid="voice-mute"]')).not.toBeNull());
    await click('voice-mute');
    expect(setMic).toHaveBeenLastCalledWith(true);
    await vi.waitFor(() => expect(container.textContent).toContain('Live'));
    await click('voice-mute');
    expect(setMic).toHaveBeenLastCalledWith(false);
  });

  it('leaves the call and returns to the join state', async () => {
    const { room, leave } = makeRoom();
    const { sdk } = makeSdk(room);
    stubFetch();
    renderBar({ sdk });
    await click('voice-join');
    await vi.waitFor(() => expect(container.querySelector('[data-testid="voice-leave"]')).not.toBeNull());
    await click('voice-leave');
    expect(leave).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(container.querySelector('[data-testid="voice-join"]')).not.toBeNull());
  });

  it('shows a fresh presence count before joining (same live lane)', async () => {
    const { room } = makeRoom();
    const { sdk } = makeSdk(room);
    const { listeners } = renderBar({ sdk });
    act(() => {
      for (const listener of listeners) {
        listener({ v: 1, type: 'voice-presence', op: 'joined', identity: 'cd'.repeat(16), ms: Date.now() } as VoicePresence);
      }
    });
    expect(container.textContent).toContain('Join voice · 1');
  });

  it('fails closed with a visible message when no broker is configured', async () => {
    const { room } = makeRoom();
    const { sdk, join } = makeSdk(room);
    renderBar({ sdk, brokerOrigin: undefined });
    await click('voice-join');
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());
    expect(container.textContent).toContain('Voice is not configured on this host.');
    expect(join).not.toHaveBeenCalled();
  });
});
