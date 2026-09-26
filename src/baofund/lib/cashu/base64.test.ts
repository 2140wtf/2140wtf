import { describe, it, expect } from 'vitest';
import { bytesToBase64, base64ToBytes, bytesToBase64Url, base64UrlToBytes, stringToBase64, base64ToString } from './base64';

describe('bytesToBase64 / base64ToBytes round-trips', () => {
  it('round-trips empty input', () => {
    const empty = new Uint8Array(0);
    expect(base64ToBytes(bytesToBase64(empty))).toEqual(empty);
  });

  it('round-trips 1, 2, and 3 byte inputs (padding edge cases)', () => {
    for (const bytes of [new Uint8Array([0x00]), new Uint8Array([0xff, 0x00]), new Uint8Array([0xab, 0xcd, 0xef])]) {
      const encoded = bytesToBase64(bytes);
      expect(encoded).not.toContain(' ');
      expect(base64ToBytes(encoded)).toEqual(bytes);
    }
  });

  it('round-trips a large buffer (10KB)', () => {
    const data = new Uint8Array(10_000);
    for (let i = 0; i < data.length; i++) data[i] = i & 0xff;
    expect(base64ToBytes(bytesToBase64(data))).toEqual(data);
  });

  it('produces standard padded base64', () => {
    // 'Hello' → 5 bytes → SGVsbG8= (with padding)
    expect(bytesToBase64(new TextEncoder().encode('Hello'))).toBe('SGVsbG8=');
  });
});

describe('bytesToBase64Url / base64UrlToBytes', () => {
  it('produces no padding and no + or / characters', () => {
    // Bytes that would produce + and / in standard base64
    const data = new Uint8Array([0xfb, 0xff, 0xbf]);
    const urlSafe = bytesToBase64Url(data);
    expect(urlSafe).not.toMatch(/[+/=]/);
  });

  it('round-trips through URL-safe encoding', () => {
    const data = new Uint8Array([0xfb, 0xff, 0xbf, 0xde, 0x00, 0xff]);
    const urlSafe = bytesToBase64Url(data);
    const decoded = base64UrlToBytes(urlSafe);
    expect(decoded).toEqual(data);
  });
});

describe('stringToBase64 / base64ToString', () => {
  it('round-trips ASCII strings', () => {
    const str = 'hello world 123';
    expect(base64ToString(stringToBase64(str))).toBe(str);
  });

  it('round-trips Unicode strings with emoji', () => {
    const str = 'héllo wörld 🎉 ₿AO';
    expect(base64ToString(stringToBase64(str))).toBe(str);
  });
});
