/**
 * LiveKit adapter tests (ADR-voice-invisible-rooms v10.2): the SDK is mocked,
 * so these pin the adapter's contract — mandatory E2EE with a per-sender
 * 256-bit provider, keys derived for every SFU identity, join muted, local
 * encryption failures fatal, remote tolerated.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { deriveSenderKey } from './keys';

const mockState = vi.hoisted(() => ({
  rooms: [] as Array<{
    options: Record<string, unknown>;
    connectArgs: unknown[];
    disconnected: boolean;
    handlers: Map<string, Set<(...args: unknown[]) => void>>;
    emit: (event: string, ...args: unknown[]) => void;
    localParticipant: { identity: string; isMicrophoneEnabled: boolean; isSpeaking: boolean; setMicrophoneEnabled: (v: boolean) => Promise<void> };
    remoteParticipants: Map<string, unknown>;
    activeSpeakers: Array<{ identity: string }>;
  }>,
  providers: [] as Array<{ options: Record<string, unknown>; keys: Array<[string | undefined, unknown]> }>,
}));

vi.mock('livekit-client', () => {
  class BaseKeyProvider {
    options: Record<string, unknown>;
    keys: Array<[string | undefined, unknown]> = [];
    constructor(options: Record<string, unknown>) {
      this.options = options;
      mockState.providers.push(this as unknown as (typeof mockState.providers)[number]);
    }
    onSetEncryptionKey(key: unknown, identity?: string): void {
      this.keys.push([identity, key]);
    }
    getOptions(): Record<string, unknown> {
      return this.options;
    }
  }
  class Room {
    options: Record<string, unknown>;
    connectArgs: unknown[] = [];
    disconnected = false;
    handlers = new Map<string, Set<(...args: unknown[]) => void>>();
    localParticipant = {
      identity: 'aa'.repeat(16),
      isMicrophoneEnabled: false,
      isSpeaking: false,
      setMicrophoneEnabled: async (value: boolean) => {
        this.localParticipant.isMicrophoneEnabled = value;
      },
    };
    remoteParticipants = new Map<string, unknown>();
    activeSpeakers: Array<{ identity: string }> = [];
    constructor(options: Record<string, unknown>) {
      this.options = options;
      mockState.rooms.push(this as unknown as (typeof mockState.rooms)[number]);
    }
    on(event: string, listener: (...args: unknown[]) => void): () => void {
      if (!this.handlers.has(event)) this.handlers.set(event, new Set());
      this.handlers.get(event)!.add(listener);
      return () => this.handlers.get(event)?.delete(listener);
    }
    off(event: string, listener: (...args: unknown[]) => void): void {
      this.handlers.get(event)?.delete(listener);
    }
    emit(event: string, ...args: unknown[]): void {
      for (const listener of this.handlers.get(event) ?? []) listener(...args);
    }
    async connect(url: string, token: string): Promise<void> {
      this.connectArgs = [url, token];
    }
    async disconnect(): Promise<void> {
      this.disconnected = true;
    }
  }
  return {
    BaseKeyProvider,
    Room,
    RoomEvent: {
      ParticipantConnected: 'participantConnected',
      ParticipantDisconnected: 'participantDisconnected',
      ActiveSpeakersChanged: 'activeSpeakersChanged',
      TrackMuted: 'trackMuted',
      TrackUnmuted: 'trackUnmuted',
      EncryptionError: 'encryptionError',
      ParticipantEncryptionStatusChanged: 'participantEncryptionStatusChanged',
    },
  };
});

import { RoomEvent } from 'livekit-client';
import { LiveKitVoiceSdk, VoiceSenderKeyProvider, type VoiceE2EEWorker } from './livekitAdapter';

const MEDIA_KEY = new Uint8Array(32).fill(0x42);

class TestKeyProvider extends VoiceSenderKeyProvider {
  senderKeyBytes: Uint8Array | undefined;
  protected override async importSenderKey(senderKey: Uint8Array): Promise<CryptoKey> {
    this.senderKeyBytes = senderKey;
    return 'CRYPTO_KEY' as unknown as CryptoKey;
  }
}

function fakeWorker(): VoiceE2EEWorker {
  return {} as VoiceE2EEWorker;
}

beforeEach(() => {
  mockState.rooms.length = 0;
  mockState.providers.length = 0;
  // jsdom has no crypto.subtle: stub the CryptoKey import seam for SDK tests.
  vi.spyOn(VoiceSenderKeyProvider.prototype as unknown as { importSenderKey: (key: Uint8Array) => Promise<CryptoKey> }, 'importSenderKey').mockResolvedValue('CRYPTO_KEY' as unknown as CryptoKey);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('VoiceSenderKeyProvider', () => {
  it('is a per-sender 256-bit provider with ratcheting disabled', () => {
    const provider = new VoiceSenderKeyProvider();
    expect(provider.getOptions()).toMatchObject({ sharedKey: false, keySize: 256, ratchetWindowSize: 0, failureTolerance: -1 });
  });

  it('derives the per-identity sender key and installs it for that identity', async () => {
    const provider = new TestKeyProvider();
    await provider.setSenderKey('ab'.repeat(16), MEDIA_KEY);
    expect(Array.from(provider.senderKeyBytes ?? [])).toEqual(Array.from(deriveSenderKey(MEDIA_KEY, 'ab'.repeat(16))));
    expect(mockState.providers[0].keys).toEqual([['ab'.repeat(16), 'CRYPTO_KEY']]);
  });
});

describe('LiveKitVoiceSdk', () => {
  it('joins with mandatory E2EE and installs keys for every current identity', async () => {
    const sdk = new LiveKitVoiceSdk({ createWorker: fakeWorker });
    const room = await sdk.join({ url: 'wss://av.example', token: 'tok', e2ee: true, identity: 'ignored', voiceMediaKey: MEDIA_KEY });
    const raw = mockState.rooms[0];
    expect(raw.connectArgs).toEqual(['wss://av.example', 'tok']);
    expect(raw.options.e2ee).toMatchObject({ worker: expect.anything() });
    expect((raw.options.e2ee as { keyProvider: { options: unknown } }).keyProvider.options).toMatchObject({ sharedKey: false, keySize: 256 });
    expect(mockState.providers[0].keys.map(([identity]) => identity)).toEqual(['aa'.repeat(16)]);
    // A participant that joins later gets its key installed too.
    raw.remoteParticipants.set('cd'.repeat(16), { identity: 'cd'.repeat(16) });
    raw.emit(RoomEvent.ParticipantConnected, { identity: 'cd'.repeat(16) });
    await vi.waitFor(() => expect(mockState.providers[0].keys.map(([identity]) => identity)).toContain('cd'.repeat(16)));
    await room.leave();
    expect(raw.disconnected).toBe(true);
  });

  it('delegates mute and maps participants (speaking from SFU levels, muted from mic state)', async () => {
    const sdk = new LiveKitVoiceSdk({ createWorker: fakeWorker });
    const room = await sdk.join({ url: 'wss://av.example', token: 'tok', e2ee: true, identity: 'ignored', voiceMediaKey: MEDIA_KEY });
    const raw = mockState.rooms[0];
    await room.setMicrophoneEnabled(true);
    expect(raw.localParticipant.isMicrophoneEnabled).toBe(true);
    raw.remoteParticipants.set('cd'.repeat(16), { identity: 'cd'.repeat(16), isMicrophoneEnabled: false, isSpeaking: false });
    raw.activeSpeakers = [{ identity: 'cd'.repeat(16) }];
    expect(room.participants()).toEqual([
      { identity: 'aa'.repeat(16), speaking: false, muted: false },
      { identity: 'cd'.repeat(16), speaking: true, muted: true },
    ]);
  });

  it('fires onEncryptionError for local failures only', async () => {
    const sdk = new LiveKitVoiceSdk({ createWorker: fakeWorker });
    const room = await sdk.join({ url: 'wss://av.example', token: 'tok', e2ee: true, identity: 'ignored', voiceMediaKey: MEDIA_KEY });
    const raw = mockState.rooms[0];
    const errors: string[] = [];
    room.onEncryptionError?.(() => errors.push('fatal'));
    const remote = { identity: 'cd'.repeat(16) };
    raw.emit(RoomEvent.ParticipantEncryptionStatusChanged, false, remote);
    raw.emit(RoomEvent.EncryptionError, new Error('remote key'), remote);
    expect(errors).toHaveLength(0);
    raw.emit(RoomEvent.ParticipantEncryptionStatusChanged, false, raw.localParticipant);
    raw.emit(RoomEvent.EncryptionError, new Error('worker died'));
    expect(errors).toHaveLength(2);
  });
});
