import { describe, expect, it } from 'vitest';
import type { Proof } from 'cashu-ts3';
import {
  API_ORACLE_MIN_LOCKTIME_SECONDS,
  ESCROW_DEPOSIT_LOCKTIME_SECONDS,
  donorMintRefundReady,
  escrowLocktimeFromProofs,
} from './escrowDrill';

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);
const KEY_C = 'c'.repeat(64);

/** The exact P2PK secret shape cashu-ts builds for the drill's escrow outputs. */
function escrowSecret(locktime?: number): string {
  return JSON.stringify([
    'P2PK',
    {
      data: `02${KEY_A}`,
      tags: [
        ['pubkeys', `02${KEY_B}`, `02${KEY_C}`],
        ['n_sigs', '2'],
        ['refund', `02${KEY_A}`],
        ['n_sigs_refund', '1'],
        ...(locktime === undefined ? [] : [['locktime', String(locktime)]]),
        ['sigflag', 'SIG_ALL'],
      ],
    },
  ]);
}

const proof = (secret: string): Proof => ({
  id: '00aa',
  amount: 1,
  secret,
  C: `02${'d'.repeat(64)}`,
}) as Proof;

describe('escrowDrill timing helpers', () => {
  it('builds the deposit beyond the deployed API minimum (24h), not the stale 1h', () => {
    expect(API_ORACLE_MIN_LOCKTIME_SECONDS).toBe(24 * 60 * 60);
    expect(ESCROW_DEPOSIT_LOCKTIME_SECONDS).toBeGreaterThan(API_ORACLE_MIN_LOCKTIME_SECONDS);
  });

  it('reads the SOONEST locktime across escrow proofs', () => {
    const now = 1_800_000_000;
    expect(escrowLocktimeFromProofs([proof(escrowSecret(now + 90_000)), proof(escrowSecret(now + 80_000))]))
      .toBe(now + 80_000);
    expect(escrowLocktimeFromProofs([proof(escrowSecret(now + 80_000))])).toBe(now + 80_000);
  });

  it('returns null when a proof is not a lock or carries no locktime', () => {
    expect(escrowLocktimeFromProofs([proof('not-a-p2pk-secret')])).toBeNull();
    expect(escrowLocktimeFromProofs([proof(escrowSecret())])).toBeNull();
    expect(escrowLocktimeFromProofs([proof(escrowSecret(1)), proof(escrowSecret())])).toBeNull();
  });

  it('opens the donor mint refund exactly at the CLTV boundary, never before', () => {
    const now = 1_800_000_000;
    expect(donorMintRefundReady({ locktime: now + 1, nowSeconds: now })).toBe(false);
    expect(donorMintRefundReady({ locktime: now, nowSeconds: now })).toBe(true);
    expect(donorMintRefundReady({ locktime: now - 1, nowSeconds: now })).toBe(true);
    expect(donorMintRefundReady({ locktime: null, nowSeconds: now })).toBe(false);
  });
});
