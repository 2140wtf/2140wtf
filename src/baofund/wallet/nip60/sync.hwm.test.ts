// src/wallet/nip60/sync.hwm.test.ts
//
// Regression: the NIP-60 adoption high-water mark and adopted wallet key are
// PER IDENTITY. A single origin-wide key made one identity's adoption decide
// another identity's restore (and the same identity's later refresh). See
// audit finding
// src/wallet/nip60/sync.ts:restoreWalletForIdentity:device-global-config-hwm.

import { beforeEach, describe, expect, it } from 'vitest';
import { clearNip60IdentityState, __nip60StateForTests } from './sync';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

describe('NIP-60 per-identity adoption state', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('stores the HWM under an identity-scoped key (A never decides B)', () => {
    const { CONFIG_HWM_KEY, loadConfigHwm, persistConfigHwm } = __nip60StateForTests;
    expect(loadConfigHwm(A)).toBe(0);
    expect(loadConfigHwm(B)).toBe(0);

    persistConfigHwm(A, 200);
    expect(localStorage.getItem(`${CONFIG_HWM_KEY}:${A}`)).toBe('200');
    expect(loadConfigHwm(A)).toBe(200);
    // B is unaffected by A's adoption.
    expect(loadConfigHwm(B)).toBe(0);
    expect(localStorage.getItem(`${CONFIG_HWM_KEY}:${B}`)).toBeNull();
  });

  it('clearNip60IdentityState removes both per-identity keys without touching the other identity', () => {
    const { CONFIG_HWM_KEY, IDENTITY_WALLET_KEY, persistConfigHwm } = __nip60StateForTests;
    persistConfigHwm(A, 200);
    persistConfigHwm(B, 100);
    localStorage.setItem(`${IDENTITY_WALLET_KEY}:${A}`, '33'.repeat(32));
    localStorage.setItem(`${IDENTITY_WALLET_KEY}:${B}`, '44'.repeat(32));

    clearNip60IdentityState(A);

    expect(localStorage.getItem(`${CONFIG_HWM_KEY}:${A}`)).toBeNull();
    expect(localStorage.getItem(`${IDENTITY_WALLET_KEY}:${A}`)).toBeNull();
    expect(localStorage.getItem(`${CONFIG_HWM_KEY}:${B}`)).toBe('100');
    expect(localStorage.getItem(`${IDENTITY_WALLET_KEY}:${B}`)).toBe('44'.repeat(32));
  });
});
