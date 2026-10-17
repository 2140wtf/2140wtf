/**
 * Voice broker client tests (ADR-voice-invisible-rooms v10.2 §3): the grant
 * must be exactly what the broker verifies, and the token response must be
 * validated fail-closed.
 */
import { describe, it, expect, vi } from 'vitest';
import { getPublicKey } from 'nostr-tools';
import { buildVoiceGrantEvent, requestVoiceToken, voiceBrokerPath, VoiceTokenError } from './token';
import { verifyVoiceGrant } from './broker';

const ROOM_ORIGIN = 'https://voice.example';
const voiceSignerSecret = new Uint8Array(32).fill(7);
const voiceRoom = getPublicKey(voiceSignerSecret);
const NOW_MS = 1_700_000_000_000;

function okFetch(body: unknown) {
  return vi.fn(async () => ({ ok: true, status: 200, json: async () => body }));
}

describe('voice broker client', () => {
  it('builds a kind-27235 grant that the broker verifier accepts', () => {
    const url = `${ROOM_ORIGIN}${voiceBrokerPath(voiceRoom)}`;
    const event = buildVoiceGrantEvent({ voiceSignerSecret, url, method: 'GET', createdAt: Math.floor(NOW_MS / 1000) });
    expect(event.kind).toBe(27235);
    expect(event.pubkey).toBe(voiceRoom);
    expect(event.tags).toEqual([['u', url], ['method', 'GET']]);
    expect(
      verifyVoiceGrant({
        authorization: `Concord ${Buffer.from(JSON.stringify(event)).toString('base64')}`,
        voiceRoom,
        method: 'GET',
        expectedUrl: url,
        nowSec: Math.floor(NOW_MS / 1000),
        freshnessSec: 60,
      }).ok,
    ).toBe(true);
  });

  it('requests a token with the exact URL and Authorization grant', async () => {
    const fetchMock = okFetch({ token: 'tok_' + 'x'.repeat(32), url: 'wss://av.example', identity: 'ab'.repeat(16) });
    const grant = await requestVoiceToken({
      brokerOrigin: ROOM_ORIGIN,
      voiceRoom,
      voiceSignerSecret,
      fetchImpl: fetchMock as unknown as typeof fetch,
      now: () => NOW_MS,
    });
    expect(grant).toEqual({ token: 'tok_' + 'x'.repeat(32), url: 'wss://av.example', identity: 'ab'.repeat(16) });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(url).toBe(`${ROOM_ORIGIN}${voiceBrokerPath(voiceRoom)}`);
    const event = JSON.parse(Buffer.from(init.headers.authorization.replace('Concord ', ''), 'base64').toString('utf8')) as { tags: string[][] };
    expect(event.tags[0]).toEqual(['u', url]);
    expect(event.tags[1]).toEqual(['method', 'GET']);
  });

  it('fails closed on bad status, unreachable broker and malformed responses', async () => {
    const base = { brokerOrigin: ROOM_ORIGIN, voiceRoom, voiceSignerSecret, now: () => NOW_MS };
    await expect(requestVoiceToken({ ...base, fetchImpl: (async () => ({ ok: false, status: 429 })) as unknown as typeof fetch })).rejects.toBeInstanceOf(VoiceTokenError);
    await expect(requestVoiceToken({ ...base, fetchImpl: (async () => { throw new Error('down'); }) as unknown as typeof fetch })).rejects.toMatchObject({ message: 'broker unreachable' });
    await expect(requestVoiceToken({ ...base, fetchImpl: (async () => ({ ok: true, status: 200, json: async () => { throw new Error('nope'); } })) as unknown as typeof fetch })).rejects.toMatchObject({ message: 'broker response is not JSON' });
    await expect(requestVoiceToken({ ...base, fetchImpl: okFetch({ url: 'wss://av.example', identity: 'ab'.repeat(16) }) as unknown as typeof fetch })).rejects.toMatchObject({ message: 'broker response missing token' });
    await expect(requestVoiceToken({ ...base, fetchImpl: okFetch({ token: 't'.repeat(32), url: 'http://insecure', identity: 'ab'.repeat(16) }) as unknown as typeof fetch })).rejects.toMatchObject({ message: 'broker response missing livekit url' });
    await expect(requestVoiceToken({ ...base, fetchImpl: okFetch({ token: 't'.repeat(32), url: 'wss://av.example', identity: 'NOPE' }) as unknown as typeof fetch })).rejects.toMatchObject({ message: 'broker response has an invalid identity' });
  });
});
