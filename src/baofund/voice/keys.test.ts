import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js';
import { CONCORD_LABEL, concordGroupKey } from '@/baofund/community/adapters/concordKeys.js';
import { ProtocolError } from '@/baofund/community/protocolError.js';
import {
  VOICE_CHANNEL_ID_LABEL,
  deriveSenderKey,
  deriveVoiceChannelId,
  deriveVoiceKeys,
  parseVoiceGeneration,
  serializeVoiceGeneration,
} from './keys';

const ROOT = new Uint8Array(32).fill(0x11);
const OTHER_ROOT = new Uint8Array(32).fill(0x22);
const ROOM_ID = '0011223344556677';
const IDENTITY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** Independent HKDF-SHA256 (RFC 5869) to pin the frozen info layout. */
function manualHkdf(ikm: Uint8Array, info: Uint8Array): Uint8Array {
  const prk = hmac(sha256, new Uint8Array(0), ikm);
  return hmac(sha256, prk, new Uint8Array([...info, 1]));
}

function epochBe(epoch: number): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(epoch), false);
  return out;
}

function infoBytes(label: string, id: Uint8Array, epoch?: number): Uint8Array {
  const parts = [utf8ToBytes(label), new Uint8Array([0]), id];
  if (epoch !== undefined) parts.push(epochBe(epoch));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const part of parts) {
    out.set(part, off);
    off += part.length;
  }
  return out;
}

describe('voice derivation byte layout (CORD-02 A shapes)', () => {
  it('channelId32 = HKDF(voiceRoot, "bao/voice-channel-id", sha256(roomId))', () => {
    const id = sha256(utf8ToBytes(ROOM_ID));
    expect(hex(deriveVoiceChannelId(ROOT, ROOM_ID))).toBe(hex(manualHkdf(ROOT, infoBytes(VOICE_CHANNEL_ID_LABEL, id))));
  });

  it('voiceMediaKey = HKDF(voiceRoot, "concord/voice-media", channelId, epoch)', () => {
    const channelId = deriveVoiceChannelId(ROOT, ROOM_ID);
    const expected = manualHkdf(ROOT, infoBytes(CONCORD_LABEL.voiceMedia, channelId, 3));
    expect(hex(deriveVoiceKeys({ voiceRoot: ROOT, roomId: ROOM_ID, voiceGeneration: 3 }).voiceMediaKey)).toBe(hex(expected));
  });

  it('senderKey = HKDF(voiceMediaKey, "concord/voice-sender", sha256(identity)) with no epoch', () => {
    const { voiceMediaKey } = deriveVoiceKeys({ voiceRoot: ROOT, roomId: ROOM_ID, voiceGeneration: 0 });
    const id = sha256(utf8ToBytes(IDENTITY));
    expect(hex(deriveSenderKey(voiceMediaKey, IDENTITY))).toBe(hex(manualHkdf(voiceMediaKey, infoBytes(CONCORD_LABEL.voiceSender, id))));
  });

  it('voiceRoom is the x-only pk of the group-key scalar and differs from the media key', () => {
    const keys = deriveVoiceKeys({ voiceRoot: ROOT, roomId: ROOM_ID, voiceGeneration: 7 });
    const expected = concordGroupKey({ label: CONCORD_LABEL.voiceSigner, secret: ROOT, id: keys.channelId, epoch: 7 });
    expect(keys.voiceRoom).toBe(expected.pk);
    expect(secp256k1.utils.isValidSecretKey(keys.voiceSignerSecret)).toBe(true);
    expect(hex(schnorr.getPublicKey(keys.voiceSignerSecret))).toBe(keys.voiceRoom);
    expect(keys.voiceRoom).toMatch(/^[a-f0-9]{64}$/);
    expect(hex(keys.voiceMediaKey)).not.toBe(hex(keys.voiceSignerSecret));
  });

  it('is domain-separated across room, root, generation and identity', () => {
    const base = deriveVoiceKeys({ voiceRoot: ROOT, roomId: ROOM_ID, voiceGeneration: 0 });
    const gen1 = deriveVoiceKeys({ voiceRoot: ROOT, roomId: ROOM_ID, voiceGeneration: 1 });
    const otherRoom = deriveVoiceKeys({ voiceRoot: ROOT, roomId: '8899aabbccddeeff', voiceGeneration: 0 });
    const otherRoot = deriveVoiceKeys({ voiceRoot: OTHER_ROOT, roomId: ROOM_ID, voiceGeneration: 0 });
    expect(gen1.voiceRoom).not.toBe(base.voiceRoom);
    expect(otherRoom.voiceRoom).not.toBe(base.voiceRoom);
    expect(otherRoot.voiceRoom).not.toBe(base.voiceRoom);
    const senderA = deriveSenderKey(base.voiceMediaKey, IDENTITY);
    const senderB = deriveSenderKey(base.voiceMediaKey, 'ff'.repeat(16));
    expect(hex(senderA)).not.toBe(hex(senderB));
    expect(deriveSenderKey(base.voiceMediaKey, IDENTITY)).toEqual(senderA);
  });
});

describe('voice generation encoding', () => {
  it('round-trips safe integers as 16-hex and rejects out-of-range values', () => {
    expect(parseVoiceGeneration(serializeVoiceGeneration(0))).toBe(0);
    expect(parseVoiceGeneration(serializeVoiceGeneration(2 ** 53 - 1))).toBe(2 ** 53 - 1);
    // 2^53 must be rejected: parseInt would silently round it.
    expect(() => parseVoiceGeneration('0020000000000000')).toThrowError(ProtocolError);
    expect(() => serializeVoiceGeneration(2 ** 53)).toThrowError(ProtocolError);
    expect(() => serializeVoiceGeneration(-1)).toThrowError(ProtocolError);
    expect(() => serializeVoiceGeneration(1.5)).toThrowError(ProtocolError);
    expect(() => parseVoiceGeneration('nope')).toThrowError(ProtocolError);
    expect(() => parseVoiceGeneration('ABCDEF0123456789')).toThrowError(ProtocolError);
  });
});

describe('input validation (fail closed)', () => {
  it('rejects malformed room ids, roots, generations and identities', () => {
    expect(() => deriveVoiceKeys({ voiceRoot: ROOT, roomId: 'xyz', voiceGeneration: 0 })).toThrowError(ProtocolError);
    expect(() => deriveVoiceKeys({ voiceRoot: ROOT.slice(1), roomId: ROOM_ID, voiceGeneration: 0 })).toThrowError(ProtocolError);
    expect(() => deriveVoiceKeys({ voiceRoot: ROOT, roomId: ROOM_ID, voiceGeneration: -1 })).toThrowError(ProtocolError);
    const { voiceMediaKey } = deriveVoiceKeys({ voiceRoot: ROOT, roomId: ROOM_ID, voiceGeneration: 0 });
    expect(() => deriveSenderKey(voiceMediaKey, IDENTITY.toUpperCase())).toThrowError(ProtocolError);
    expect(() => deriveSenderKey(voiceMediaKey, 'abcd')).toThrowError(ProtocolError);
    expect(() => deriveSenderKey(voiceMediaKey, 'abc')).toThrowError(ProtocolError);
    expect(() => deriveSenderKey(new Uint8Array(31), IDENTITY)).toThrowError(ProtocolError);
  });
});

describe('regression vectors (voice-keys.json)', () => {
  it('reproduces the committed vectors', () => {
    const vectors = JSON.parse(readFileSync('src/baofund/voice/voice-keys.json', 'utf8')) as {
      voiceRoot: string;
      roomId: string;
      cases: Array<{ voiceGeneration: string; voiceRoom: string; voiceMediaKey: string; channelId: string; identity: string; senderKey: string }>;
    };
    for (const c of vectors.cases) {
      const keys = deriveVoiceKeys({
        voiceRoot: Uint8Array.from(Buffer.from(vectors.voiceRoot, 'hex')),
        roomId: vectors.roomId,
        voiceGeneration: parseVoiceGeneration(c.voiceGeneration),
      });
      expect(keys.voiceRoom).toBe(c.voiceRoom);
      expect(hex(keys.voiceMediaKey)).toBe(c.voiceMediaKey);
      expect(hex(keys.channelId)).toBe(c.channelId);
      expect(hex(deriveSenderKey(keys.voiceMediaKey, c.identity))).toBe(c.senderKey);
    }
  });
});
