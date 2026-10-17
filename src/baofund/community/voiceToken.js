/**
 * voiceToken — broker client for the blind voice broker
 * (ADR-voice-invisible-rooms v10.2). Browser-safe: no Node built-ins.
 *
 * Builds the kind-27235 grant bound to the EXACT request URL and method,
 * signs it with the room's derived voice signer, and exchanges it for a
 * short-lived LiveKit token. Fail closed: malformed responses throw.
 */
import { finalizeEvent } from 'nostr-tools';
export class VoiceTokenError extends Error {
    constructor(message, status) {
        super(message);
        this.status = status;
        this.name = 'VoiceTokenError';
    }
}
const IDENTITY_RE = /^(?:[0-9a-f]{2}){16,}$/;
export function voiceBrokerPath(voiceRoom) {
    if (!/^[0-9a-f]{64}$/.test(voiceRoom))
        throw new VoiceTokenError('voiceRoom must be 64 lowercase hex chars');
    return `/.well-known/concord/av/${voiceRoom}`;
}
/** The binding grant event (exported for tests / broker parity checks). */
export function buildVoiceGrantEvent(input) {
    if (typeof input.url !== 'string' || !/^https?:\/\//.test(input.url)) {
        throw new VoiceTokenError('broker url must be http(s)');
    }
    if (!Number.isSafeInteger(input.createdAt) || input.createdAt < 0) {
        throw new VoiceTokenError('createdAt must be unix seconds');
    }
    return finalizeEvent({
        kind: 27235,
        created_at: input.createdAt,
        tags: [['u', input.url], ['method', input.method]],
        content: '',
    }, input.voiceSignerSecret);
}
function base64Utf8(value) {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    for (const byte of bytes)
        binary += String.fromCharCode(byte);
    return btoa(binary);
}
export async function requestVoiceToken(options) {
    const now = options.now ?? Date.now;
    const origin = options.brokerOrigin.replace(/\/+$/, '');
    if (!/^https?:\/\//.test(origin))
        throw new VoiceTokenError('brokerOrigin must be http(s)');
    const url = `${origin}${voiceBrokerPath(options.voiceRoom)}`;
    const event = buildVoiceGrantEvent({
        voiceSignerSecret: options.voiceSignerSecret,
        url,
        method: 'GET',
        createdAt: Math.floor(now() / 1000),
    });
    const authorization = `Concord ${base64Utf8(JSON.stringify(event))}`;
    const fetchImpl = options.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 5000);
    let res;
    try {
        res = await fetchImpl(url, { method: 'GET', headers: { authorization }, signal: controller.signal });
    }
    catch {
        throw new VoiceTokenError('broker unreachable');
    }
    finally {
        clearTimeout(timer);
    }
    if (!res.ok)
        throw new VoiceTokenError(`broker request failed (${res.status})`, res.status);
    let body;
    try {
        body = await res.json();
    }
    catch {
        throw new VoiceTokenError('broker response is not JSON');
    }
    const data = (body ?? {});
    if (typeof data.token !== 'string' || data.token.length < 16)
        throw new VoiceTokenError('broker response missing token');
    if (typeof data.url !== 'string' || !/^(wss|https):\/\//.test(data.url))
        throw new VoiceTokenError('broker response missing livekit url');
    if (typeof data.identity !== 'string' || !IDENTITY_RE.test(data.identity))
        throw new VoiceTokenError('broker response has an invalid identity');
    return { token: data.token, url: data.url, identity: data.identity };
}
