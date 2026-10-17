/**
 * Blind voice broker — route/grant/JWT/replay/CORS/rate tests
 * (ADR-voice-invisible-rooms v10.2 §3).
 */
import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import { createVoiceBroker, verifyVoiceGrant, clientIpFor, rateBucketKey, type BrokerRequest, type VoiceBrokerConfig } from './broker';

const NOW_MS = 1_700_000_000_000;
const ORIGIN = 'https://voice.example';
const APP_ORIGIN = 'https://app.bao.network';

function config(overrides: Partial<VoiceBrokerConfig> = {}): VoiceBrokerConfig {
  return {
    livekitUrl: 'wss://av.example',
    apiKey: 'APIkey123',
    apiSecret: 's3cret',
    origin: ORIGIN,
    allowedOrigins: [APP_ORIGIN],
    tokenTtlSec: 300,
    freshnessSec: 60,
    replayWindowSec: 240,
    maxMintsPerMinutePerIp: 30,
    now: () => NOW_MS,
    ...overrides,
  };
}

let nonce = 0;

function grant(sk: Uint8Array, opts: { url: string; method?: string; createdAt?: number }): string {
  const event = finalizeEvent(
    {
      kind: 27235,
      created_at: opts.createdAt ?? Math.floor(NOW_MS / 1000),
      tags: [['u', opts.url], ['method', opts.method ?? 'GET']],
      content: `n${nonce++}`,
    },
    sk as never,
  );
  return `Concord ${Buffer.from(JSON.stringify(event)).toString('base64')}`;
}

function request(voiceRoom: string, authorization: string | undefined, extra: Partial<BrokerRequest> = {}): BrokerRequest {
  return {
    method: 'GET',
    url: `/.well-known/concord/av/${voiceRoom}`,
    headers: { authorization, origin: APP_ORIGIN },
    remoteIp: '203.0.113.7',
    ...extra,
  };
}

function decodeJwt(token: string, secret: string): { header: Record<string, unknown>; payload: Record<string, unknown> } {
  const [h, p, s] = token.split('.');
  expect(s).toBe(createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url'));
  return {
    header: JSON.parse(Buffer.from(h, 'base64url').toString('utf8')) as Record<string, unknown>,
    payload: JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as Record<string, unknown>,
  };
}

describe('voice broker routes', () => {
  it('serves the capability probe and hides unknown paths/rooms', async () => {
    const broker = createVoiceBroker(config());
    await expect(broker.handle({ method: 'GET', url: '/.well-known/concord/av', headers: { origin: APP_ORIGIN } })).resolves.toMatchObject({ status: 204 });
    await expect(broker.handle({ method: 'GET', url: '/other', headers: { origin: APP_ORIGIN } })).resolves.toMatchObject({ status: 404 });
    await expect(broker.handle({ method: 'GET', url: '/.well-known/concord/av/not-hex', headers: { origin: APP_ORIGIN } })).resolves.toMatchObject({ status: 404 });
    await expect(broker.handle({ method: 'POST', url: '/.well-known/concord/av', headers: { origin: APP_ORIGIN } })).resolves.toMatchObject({ status: 405 });
  });

  it('mints a minimal LiveKit grant for a valid kind-27235 grant', async () => {
    const voiceKey = generateSecretKey();
    const voiceRoom = getPublicKey(voiceKey as never);
    const broker = createVoiceBroker(config());
    const url = `/.well-known/concord/av/${voiceRoom}`;
    const res = await broker.handle(request(voiceRoom, grant(voiceKey, { url: `${ORIGIN}${url}` })));
    expect(res.status).toBe(200);
    const body = res.body as { token: string; url: string; identity: string };
    expect(body.url).toBe('wss://av.example');
    expect(body.identity).toMatch(/^[0-9a-f]{32}$/);
    const { header, payload } = decodeJwt(body.token, 's3cret');
    expect(header).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(payload.iss).toBe('APIkey123');
    expect(payload.sub).toBe(body.identity);
    expect((payload.exp as number) - (payload.iat as number)).toBe(300);
    expect(payload.video).toEqual({ room: voiceRoom, roomJoin: true, canPublish: true, canSubscribe: true });
    expect(JSON.stringify(payload)).not.toContain('npub');
  });

  it('mints a fresh identity per grant (no cross-mint linkability)', async () => {
    const voiceKey = generateSecretKey();
    const voiceRoom = getPublicKey(voiceKey as never);
    const url = `/.well-known/concord/av/${voiceRoom}`;
    const broker = createVoiceBroker(config({ maxMintsPerMinutePerIp: 10 }));
    const a = (await broker.handle(request(voiceRoom, grant(voiceKey, { url: `${ORIGIN}${url}` })))).body as { identity: string };
    const b = (await broker.handle(request(voiceRoom, grant(voiceKey, { url: `${ORIGIN}${url}` })))).body as { identity: string };
    expect(a.identity).not.toBe(b.identity);
  });
});

describe('voice broker auth failures (fail closed)', () => {
  it('rejects wrong signer, url, method, staleness, replay and malformed grants', async () => {
    const voiceKey = generateSecretKey();
    const otherKey = generateSecretKey();
    const voiceRoom = getPublicKey(voiceKey as never);
    const url = `/.well-known/concord/av/${voiceRoom}`;
    const good = grant(voiceKey, { url: `${ORIGIN}${url}` });
    const broker = createVoiceBroker(config());

    expect((await broker.handle(request(voiceRoom, grant(otherKey, { url: `${ORIGIN}${url}` })))).status).toBe(401); // wrong signer
    expect((await broker.handle(request(voiceRoom, grant(voiceKey, { url: 'https://evil.example/x' })))).status).toBe(401); // url mismatch
    expect((await broker.handle(request(voiceRoom, grant(voiceKey, { url: `${ORIGIN}${url}`, method: 'POST' })))).status).toBe(401); // method mismatch
    expect((await broker.handle(request(voiceRoom, grant(voiceKey, { url: `${ORIGIN}${url}`, createdAt: Math.floor(NOW_MS / 1000) - 120 })))).status).toBe(401); // stale
    expect((await broker.handle(request(voiceRoom, undefined))).status).toBe(401);
    expect((await broker.handle(request(voiceRoom, 'Concord not-base64-json'))).status).toBe(401);

    const first = await broker.handle(request(voiceRoom, good));
    expect(first.status).toBe(200);
    const replay = await broker.handle(request(voiceRoom, good));
    expect(replay.status).toBe(401);
    expect((replay.body as { reason: string }).reason).toBe('replay');
  });

  it('does not consume rate budget for unauthorized requests but caps valid mints per IP', async () => {
    const voiceKey = generateSecretKey();
    const voiceRoom = getPublicKey(voiceKey as never);
    const url = `/.well-known/concord/av/${voiceRoom}`;
    const broker = createVoiceBroker(config({ maxMintsPerMinutePerIp: 2 }));
    expect((await broker.handle(request(voiceRoom, undefined))).status).toBe(401);
    expect((await broker.handle(request(voiceRoom, grant(voiceKey, { url: `${ORIGIN}${url}` })))).status).toBe(200);
    expect((await broker.handle(request(voiceRoom, grant(voiceKey, { url: `${ORIGIN}${url}` })))).status).toBe(200);
    const limited = await broker.handle(request(voiceRoom, grant(voiceKey, { url: `${ORIGIN}${url}` })));
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it('enforces the configured origin allowlist', async () => {
    const voiceKey = generateSecretKey();
    const voiceRoom = getPublicKey(voiceKey as never);
    const broker = createVoiceBroker(config());
    const denied = await broker.handle({ method: 'GET', url: `/.well-known/concord/av/${voiceRoom}`, headers: { origin: 'https://evil.example', authorization: grant(voiceKey, { url: `${ORIGIN}/x` }) } });
    expect(denied.status).toBe(403);
    const preflight = await broker.handle({ method: 'OPTIONS', url: `/.well-known/concord/av/${voiceRoom}`, headers: { origin: APP_ORIGIN } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe(APP_ORIGIN);
    expect(preflight.headers['access-control-allow-headers']).toBe('Authorization');
  });
});

describe('verifyVoiceGrant', () => {
  it('checks every binding in isolation', () => {
    const voiceKey = generateSecretKey();
    const voiceRoom = getPublicKey(voiceKey as never);
    const url = `/.well-known/concord/av/${voiceRoom}`;
    const authorization = grant(voiceKey, { url: `${ORIGIN}${url}` });
    const base = { authorization, voiceRoom, method: 'GET', expectedUrl: `${ORIGIN}${url}`, nowSec: Math.floor(NOW_MS / 1000), freshnessSec: 60 };
    expect(verifyVoiceGrant(base).ok).toBe(true);
    expect(verifyVoiceGrant({ ...base, voiceRoom: 'ff'.repeat(32) }).reason).toBe('wrong_signer');
    expect(verifyVoiceGrant({ ...base, expectedUrl: `${ORIGIN}/elsewhere` }).reason).toBe('url_mismatch');
    expect(verifyVoiceGrant({ ...base, nowSec: base.nowSec + 61 }).reason).toBe('stale_grant');
    expect(verifyVoiceGrant({ ...base, verify: () => false }).reason).toBe('bad_signature');
  });
});

describe('voice broker client-IP + caps', () => {
  it('unwraps IPv4-mapped IPv6 and aggregates IPv6 to /64', () => {
    expect(rateBucketKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(rateBucketKey('203.0.113.7')).toBe('203.0.113.7');
    expect(rateBucketKey('203.0.113.7:443')).toBe('203.0.113.7');
    expect(rateBucketKey('2001:0DB8:abcd:12::1')).toBe('2001:0db8:abcd:0012::/64');
    expect(rateBucketKey('2001:db8:abcd:12::99')).toBe('2001:0db8:abcd:0012::/64');
    expect(rateBucketKey('2001:db8:abcd:99::1')).not.toBe('2001:0db8:abcd:0012::/64');
  });

  it('trusts forwarding headers only from a loopback peer', () => {
    expect(clientIpFor({ remoteIp: '127.0.0.1', headers: { 'x-real-ip': '198.51.100.9' } }, true)).toBe('198.51.100.9');
    expect(clientIpFor({ remoteIp: '::1', headers: { 'x-forwarded-for': '198.51.100.9, 10.0.0.1' } }, true)).toBe('198.51.100.9');
    expect(clientIpFor({ remoteIp: '::ffff:127.0.0.1', headers: { 'x-real-ip': '198.51.100.9' } }, true)).toBe('198.51.100.9');
    expect(clientIpFor({ remoteIp: '203.0.113.7', headers: { 'x-real-ip': '198.51.100.9' } }, true)).toBe('203.0.113.7');
    expect(clientIpFor({ remoteIp: '127.0.0.1', headers: { 'x-real-ip': '198.51.100.9' } }, false)).toBe('127.0.0.1');
  });

  it('caps mints per ROOM across different client IPs', async () => {
    const voiceKey = generateSecretKey();
    const voiceRoom = getPublicKey(voiceKey as never);
    const url = `/.well-known/concord/av/${voiceRoom}`;
    const broker = createVoiceBroker(config({ maxMintsPerMinutePerRoom: 2 }));
    expect((await broker.handle(request(voiceRoom, grant(voiceKey, { url: `${ORIGIN}${url}` }), { remoteIp: '198.51.100.1' }))).status).toBe(200);
    expect((await broker.handle(request(voiceRoom, grant(voiceKey, { url: `${ORIGIN}${url}` }), { remoteIp: '198.51.100.2' }))).status).toBe(200);
    const limited = await broker.handle(request(voiceRoom, grant(voiceKey, { url: `${ORIGIN}${url}` }), { remoteIp: '198.51.100.3' }));
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it('caps mints per forwarded IP when the socket peer is nginx (loopback)', async () => {
    const voiceKey = generateSecretKey();
    const voiceRoom = getPublicKey(voiceKey as never);
    const url = `/.well-known/concord/av/${voiceRoom}`;
    const broker = createVoiceBroker(config({ maxMintsPerMinutePerIp: 1, maxMintsPerMinutePerRoom: 50 }));
    const via = (ip: string): BrokerRequest => ({
      method: 'GET',
      url,
      remoteIp: '127.0.0.1',
      headers: {
        authorization: grant(voiceKey, { url: `${ORIGIN}${url}` }),
        origin: APP_ORIGIN,
        'x-real-ip': ip,
      },
    });
    expect((await broker.handle(via('198.51.100.9'))).status).toBe(200);
    expect((await broker.handle(via('198.51.100.9'))).status).toBe(429);
    expect((await broker.handle(via('198.51.100.10'))).status).toBe(200);
  });

  it('aggregates IPv6 to /64 for the per-IP cap', async () => {
    const voiceKey = generateSecretKey();
    const voiceRoom = getPublicKey(voiceKey as never);
    const url = `/.well-known/concord/av/${voiceRoom}`;
    const broker = createVoiceBroker(config({ maxMintsPerMinutePerIp: 1, maxMintsPerMinutePerRoom: 50 }));
    expect((await broker.handle(request(voiceRoom, grant(voiceKey, { url: `${ORIGIN}${url}` }), { remoteIp: '2001:db8:abcd:12::1' }))).status).toBe(200);
    expect((await broker.handle(request(voiceRoom, grant(voiceKey, { url: `${ORIGIN}${url}` }), { remoteIp: '2001:db8:abcd:12::99' }))).status).toBe(429);
  });
});
