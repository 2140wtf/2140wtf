/**
 * Voice call controller tests (ADR-voice-invisible-rooms v10.2 §4/§6):
 * E2EE mandatory, join muted, presence posted, fail-closed teardown.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseVoicePresence } from '@/baofund/community/voicePresence.js';
import { prepareVoiceJoin, VoiceCall, VoiceCallError, type VoiceParticipant, type VoiceSdk, type VoiceSdkRoom } from './call';
import { deriveVoiceKeys } from './keys';

const ROOT = new Uint8Array(32).fill(0x11);
const ROOM_ID = '0011223344556677';
const IDENTITY = 'ab'.repeat(16);
const GRANT = { token: 'tok_' + 'x'.repeat(32), url: 'wss://av.example', identity: IDENTITY };

function okFetch() {
  return vi.fn(async () => ({ ok: true, status: 200, json: async () => GRANT }));
}

interface Harness {
  sdk: VoiceSdk;
  room: {
    setMicrophoneEnabled: ReturnType<typeof vi.fn>;
    leave: ReturnType<typeof vi.fn>;
    participants: () => VoiceParticipant[];
  };
  joinOptions: () => Record<string, unknown> | undefined;
  emitEncryptionError: () => void;
  posts: unknown[];
  roomSession: { post: (payload: unknown) => Promise<unknown> };
}

function harness(overrides: { joinRejects?: boolean; micRejects?: boolean } = {}): Harness {
  let encryptionListener: (() => void) | undefined;
  let joined: Record<string, unknown> | undefined;
  const posts: unknown[] = [];
  const room = {
    setMicrophoneEnabled: vi.fn(async () => {
      if (overrides.micRejects) throw new Error('mic failed');
    }),
    leave: vi.fn(async () => {}),
    participants: () => [] as VoiceParticipant[],
  };
  const sdk: VoiceSdk = {
    join: async (options) => {
      joined = options as unknown as Record<string, unknown>;
      if (overrides.joinRejects) throw new Error('join failed');
      return {
        ...room,
        onEncryptionError: (listener: () => void) => {
          encryptionListener = listener;
          return () => {
            encryptionListener = undefined;
          };
        },
      } as VoiceSdkRoom;
    },
  };
  return {
    sdk,
    room,
    joinOptions: () => joined,
    emitEncryptionError: () => encryptionListener?.(),
    posts,
    roomSession: { post: async (payload: unknown) => void posts.push(payload) },
  };
}

async function prepared() {
  const result = await prepareVoiceJoin({
    voiceRoot: ROOT,
    roomId: ROOM_ID,
    voiceGeneration: 0,
    brokerOrigin: 'https://voice.example',
    fetchImpl: okFetch() as unknown as typeof fetch,
  });
  if (!result.ok) throw new Error('prepare failed in test setup');
  return result.prepared;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('prepareVoiceJoin (fail-closed preflight)', () => {
  it('derives keys + broker grant on the happy path', async () => {
    const result = await prepareVoiceJoin({
      voiceRoot: ROOT,
      roomId: ROOM_ID,
      voiceGeneration: 0,
      brokerOrigin: 'https://voice.example',
      fetchImpl: okFetch() as unknown as typeof fetch,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.prepared.keys.voiceRoom).toBe(deriveVoiceKeys({ voiceRoot: ROOT, roomId: ROOM_ID, voiceGeneration: 0 }).voiceRoom);
      expect(result.prepared.grant).toEqual(GRANT);
    }
  });

  it('refuses bad room material and an unavailable broker without throwing', async () => {
    await expect(prepareVoiceJoin({ voiceRoot: ROOT.slice(1), roomId: ROOM_ID, voiceGeneration: 0, brokerOrigin: 'https://voice.example' })).resolves.toEqual({ ok: false, reason: 'bad_room_material' });
    await expect(
      prepareVoiceJoin({ voiceRoot: ROOT, roomId: ROOM_ID, voiceGeneration: 0, brokerOrigin: 'https://voice.example', fetchImpl: (async () => { throw new Error('down'); }) as unknown as typeof fetch }),
    ).resolves.toEqual({ ok: false, reason: 'broker_unavailable' });
  });
});

describe('VoiceCall', () => {
  it('joins with E2EE, muted, and posts joined presence', async () => {
    const h = harness();
    const call = await VoiceCall.join({ prepared: await prepared(), sdk: h.sdk, roomSession: h.roomSession });
    expect(h.joinOptions()).toMatchObject({ e2ee: true, identity: IDENTITY, url: 'wss://av.example' });
    expect(h.room.setMicrophoneEnabled).toHaveBeenCalledWith(false);
    expect(call.currentState).toBe('connected');
    expect(call.isMuted).toBe(true);
    const joined = parseVoicePresence(h.posts[0]);
    expect(joined).toMatchObject({ type: 'voice-presence', op: 'joined', identity: IDENTITY, muted: true, publishing: false });
  });

  it('heartbeats, unmutes, and leaves with presence + SFU teardown', async () => {
    vi.useFakeTimers();
    const h = harness();
    const call = await VoiceCall.join({ prepared: await prepared(), sdk: h.sdk, roomSession: h.roomSession, heartbeatMs: 30_000 });
    await vi.advanceTimersByTimeAsync(30_000);
    const heartbeat = parseVoicePresence(h.posts[1]);
    expect(heartbeat).toMatchObject({ op: 'heartbeat', muted: true, publishing: false });
    await call.setMuted(false);
    expect(h.room.setMicrophoneEnabled).toHaveBeenLastCalledWith(true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(parseVoicePresence(h.posts[2])).toMatchObject({ op: 'heartbeat', muted: false, publishing: true });
    await call.leave();
    expect(h.room.leave).toHaveBeenCalledTimes(1);
    expect(parseVoicePresence(h.posts[3])).toMatchObject({ op: 'left' });
    expect(call.currentState).toBe('left');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.posts).toHaveLength(4); // no heartbeat after leave
  });

  it('fails closed if join or the initial mute fails (never half-joined)', async () => {
    const joinFail = harness({ joinRejects: true });
    await expect(VoiceCall.join({ prepared: await prepared(), sdk: joinFail.sdk, roomSession: joinFail.roomSession })).rejects.toBeInstanceOf(VoiceCallError);
    const micFail = harness({ micRejects: true });
    await expect(VoiceCall.join({ prepared: await prepared(), sdk: micFail.sdk, roomSession: micFail.roomSession })).rejects.toMatchObject({ reason: 'join_failed' });
    expect(micFail.room.leave).toHaveBeenCalledTimes(1);
  });

  it('tears down on a mid-call encryption failure', async () => {
    const h = harness();
    const states: string[] = [];
    const call = await VoiceCall.join({ prepared: await prepared(), sdk: h.sdk, roomSession: h.roomSession, onState: (state) => states.push(state) });
    h.emitEncryptionError();
    await vi.waitFor(() => expect(call.currentState).toBe('failed'));
    await vi.waitFor(() => expect(h.room.leave).toHaveBeenCalledTimes(1));
    expect(parseVoicePresence(h.posts[h.posts.length - 1])).toMatchObject({ op: 'left' });
    expect(states).toEqual(['connected', 'failed']);
  });
});
