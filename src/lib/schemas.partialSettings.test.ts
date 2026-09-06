import { describe, expect, it } from 'vitest';

import { EncryptedSettingsSchema, sanitizePartialSettings } from '@/lib/schemas';

describe('sanitizePartialSettings', () => {
  it('returns an empty object for non-object input', () => {
    expect(sanitizePartialSettings(null)).toEqual({});
    expect(sanitizePartialSettings('x')).toEqual({});
    expect(sanitizePartialSettings([1, 2])).toEqual({});
  });

  it('keeps fields that pass their schema', () => {
    const out = sanitizePartialSettings({
      useAppRelays: true,
      homePage: '/feed',
      defaultZapAmount: 1000,
    });
    expect(out).toEqual({ useAppRelays: true, homePage: '/feed', defaultZapAmount: 1000 });
  });

  it('drops fields that fail their schema — poison cannot bypass validation', () => {
    const out = sanitizePartialSettings({
      // Cleartext ws:// to a remote host violates the relay policy (round 15).
      marketplaceRelays: ['ws://attacker.example:8080'],
      // corsProxy/favicon/link-preview templates must be https.
      corsProxy: 'http://attacker.example/?url={url}',
      faviconUrl: 'http://attacker.example/{domain}',
      sentryDsn: 'not-a-dsn',
      defaultZapAmount: -5,
      useAppRelays: 'yes', // wrong type
    });
    expect(out).toEqual({});
  });

  it('keeps the valid fields of a mixed payload (no full wipe)', () => {
    const out = sanitizePartialSettings({
      homePage: '/wallet',
      corsProxy: 'https://proxy.example/?url={url}',
      marketplaceRelays: ['ws://attacker.example:8080'],
    });
    expect(out).toEqual({
      homePage: '/wallet',
      corsProxy: 'https://proxy.example/?url={url}',
    });
  });

  it('drops unknown keys and explicit-undefined values', () => {
    const out = sanitizePartialSettings({ __proto_pollution: 'x', theme: undefined });
    expect(out).toEqual({});
    expect(Object.keys(out)).toHaveLength(0);
  });

  it('agrees with the full schema on wholly-valid payloads', () => {
    const payload = {
      useAppRelays: false,
      homePage: '/market',
      publishPreferences: { zaps: true },
    };
    const full = EncryptedSettingsSchema.safeParse(payload);
    expect(full.success).toBe(true);
    expect(sanitizePartialSettings(payload)).toEqual(full.success ? full.data : {});
  });
});
