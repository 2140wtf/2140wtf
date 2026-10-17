// dmCallMedia: the phase-4 SFU join. Verifies the broker grant is minted for
// the DERIVED call room (so verifyVoiceGrant's pubkey==room check holds), the
// E2EE media key rides the join, the call joins muted, watchdog listeners
// wire through, and every failure path is fail-closed.

import { describe, expect, it, vi } from 'vitest';
import { deriveDmCallSecrets, newDmCallEphemeral } from '@/baofund/community/dmCallKeys.js';
import { DM_CALL_MEDIA_MAX_DURATION_SEC, DM_CALL_MEDIA_MAX_PARTICIPANTS, joinDmCallMedia } from './dmCallMedia';
import type { VoiceParticipant, VoiceSdk, VoiceSdkJoinOptions, VoiceSdkRoom } from '../voice/call';

const BROKER = 'https://fund.bao.example';
const NONCE = 'cd'.repeat(16);

function secrets() {
  const a = newDmCallEphemeral();
  const b = newDmCallEphemeral();
  return deriveDmCallSecrets({ secret: a.secret, peerPubHex: b.pubHex, callNonceHex: NONCE });
}

class FakeRoom implements VoiceSdkRoom {
  micEnabled = true;
  left = false;
  readonly participantListeners = new Set<() => void>();
  readonly encryptionListeners = new Set<() => void>();
  private count = 1;

  participants(): VoiceParticipant[] {
    return Array.from({ length: this.count }, (_, i) => ({ identity: `id${i}`, speaking: false, muted: true }));
  }

  async setMicrophoneEnabled(enabled: boolean): Promise<void> {
    this.micEnabled = enabled;
  }

  async leave(): Promise<void> {
    this.left = true;
  }

  onParticipantsChanged(listener: () => void): () => void {
    this.participantListeners.add(listener);
    return () => this.participantListeners.delete(listener);
  }

  onEncryptionError(listener: () => void): () => void {
    this.encryptionListeners.add(listener);
    return () => this.encryptionListeners.delete(listener);
  }

  setParticipantCount(count: number): void {
    this.count = count;
    for (const listener of this.participantListeners) listener();
  }

  failEncryption(): void {
    for (const listener of this.encryptionListeners) listener();
  }
}

class FakeSdk implements VoiceSdk {
  joined: VoiceSdkJoinOptions | null = null;
  readonly room = new FakeRoom();
  async join(options: VoiceSdkJoinOptions): Promise<VoiceSdkRoom> {
    this.joined = options;
    return this.room;
  }
}

function brokerFetch(body: unknown = { token: 'tok-0123456789abcdef', url: 'wss://lk.example', identity: 'ab'.repeat(16) }, ok = true, status = 200): typeof fetch {
  return (async () => ({ ok, status, json: async () => body })) as unknown as typeof fetch;
}

describe('dmCallMedia', () => {
  it('pins the ADR watchdog numbers', () => {
    expect(DM_CALL_MEDIA_MAX_PARTICIPANTS).toBe(2);
    expect(DM_CALL_MEDIA_MAX_DURATION_SEC).toBe(4 * 3600);
  });

  it('mints the broker grant for the derived room and joins E2EE muted with the derived media key', async () => {
    const s = secrets();
    const fetchMock = vi.fn(brokerFetch());
    const sdk = new FakeSdk();
    const media = await joinDmCallMedia({ secrets: s, peer: '11'.repeat(32) }, { brokerOrigin: BROKER, sdk, fetchImpl: fetchMock, now: () => 1_700_000_000_000 });

    // The broker call is bound to the DERIVED room name (the signer pubkey).
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: { authorization: string } }];
    expect(url).toBe(`${BROKER}/.well-known/concord/av/${s.roomName}`);
    expect(init.headers.authorization.startsWith('Concord ')).toBe(true);

    // The SFU join carries the mandatory E2EE + the derived media key.
    expect(sdk.joined).toMatchObject({ url: 'wss://lk.example', token: 'tok-0123456789abcdef', e2ee: true, identity: 'ab'.repeat(16) });
    expect(Array.from(sdk.joined!.voiceMediaKey)).toEqual(Array.from(s.mediaKey));
    // Joins muted (same privacy convention as room voice).
    expect(sdk.room.micEnabled).toBe(false);
    expect(media.isMuted()).toBe(true);

    // Mute toggle reaches the room.
    await media.setMuted(false);
    expect(sdk.room.micEnabled).toBe(true);
    expect(media.isMuted()).toBe(false);

    // Participant + encryption listeners wire through with the total count.
    const counts: number[] = [];
    const onError = vi.fn();
    media.onParticipants((count) => counts.push(count));
    media.onEncryptionError(onError);
    expect(media.participantCount()).toBe(1);
    sdk.room.setParticipantCount(3);
    expect(counts).toEqual([3]);
    sdk.room.failEncryption();
    expect(onError).toHaveBeenCalledTimes(1);

    // Leave is idempotent.
    await media.leave();
    await media.leave();
    expect(sdk.room.left).toBe(true);
  });

  it('fails closed without a broker origin and on broker/join failures', async () => {
    const s = secrets();
    await expect(joinDmCallMedia({ secrets: s, peer: '11'.repeat(32) }, { brokerOrigin: null, sdk: new FakeSdk() }))
      .rejects.toThrow(/not configured/);

    await expect(joinDmCallMedia({ secrets: s, peer: '11'.repeat(32) }, { brokerOrigin: BROKER, sdk: new FakeSdk(), fetchImpl: brokerFetch({}, false, 401) }))
      .rejects.toThrow(/401/);
    await expect(joinDmCallMedia({ secrets: s, peer: '11'.repeat(32) }, { brokerOrigin: BROKER, sdk: new FakeSdk(), fetchImpl: brokerFetch({ token: 'tok-0123456789abcdef', url: 'wss://lk.example', identity: 'junk' }) }))
      .rejects.toThrow(/identity/);

    const badRoom = new FakeRoom();
    const failingSdk = {
      join: vi.fn(async () => {
        throw new Error('sfu down');
      }),
    } as unknown as VoiceSdk;
    await expect(joinDmCallMedia({ secrets: s, peer: '11'.repeat(32) }, { brokerOrigin: BROKER, sdk: failingSdk, fetchImpl: brokerFetch() }))
      .rejects.toThrow(/sfu down/);
    void badRoom;
  });
});
