// Copyright © 2026 baocommunity - licenced under AGPL-3.0 (see LICENSE.txt).

/**
 * CLIENT-LOCAL coverage (not an upstream file) for bao-court v0.17.2's value
 * floor.
 *
 * Upstream ships this behaviour in `bondCheckGate.ts` and covers it in
 * `__tests__/bondGateHostile.test.ts`, which spawns the ceremony's
 * `scripts/court/bondCheckRunner.mjs` - and `scripts/` is NOT part of the
 * court-core vendored set (it is Node-only harness code and must never be
 * reachable from the client bundle). Without this file the floor would arrive
 * here untested, so a later sync could drop it silently.
 *
 * The rule (bao-court `BOND_GATE_THREAT_MODEL.md`): `--bond-sats` is the amount
 * the ceremony REQUIRES, and the checker is untrusted. A verdict may therefore
 * carry `valueSats`, and a stated value below the requirement is the gate's own
 * DECISION (`BOND_VALUE_BELOW_REQUIRED`) - never a retry. Residual R1: a checker
 * that OMITS the value is admitted on its word; the gate cannot see a chain.
 */

import { describe, expect, it } from 'vitest';

import { parseBondCheckOutput } from '../bondCheckGate';

const PROOF = '0f1186fabb1fbeb1862f67edadedb291f0a41a0bc0ca5936c3f1028577465d2a:0';
const EXPECTED = { rail: 'liquid' as const, network: 'testnet' as const, proofRef: PROOF };

function answer(valueSats?: number | string) {
  return JSON.stringify(
    valueSats === undefined
      ? { ok: true, proofRef: PROOF, sources: ['esplora'] }
      : { ok: true, proofRef: PROOF, sources: ['esplora'], valueSats },
  );
}

describe('bond gate - the value floor (bao-court v0.17.2)', () => {
  it('puts the stated value on the verdict', () => {
    expect(parseBondCheckOutput(answer(100_000), { ...EXPECTED, bondSats: 100_000 })).toMatchObject({
      ok: true,
      valueSats: 100_000,
    });
  });

  it('refuses a checker that understates its own bond (a DECISION, not a retry)', () => {
    expect(parseBondCheckOutput(answer(1_000), { ...EXPECTED, bondSats: 100_000 })).toMatchObject({
      ok: false,
      code: 'BOND_VALUE_BELOW_REQUIRED',
      valueSats: 1_000,
    });
  });

  it('enforces no floor when the caller names none', () => {
    expect(parseBondCheckOutput(answer(1_000), EXPECTED).ok).toBe(true);
  });

  it('is malformed - never a pass - on a negative or non-integer value', () => {
    expect(parseBondCheckOutput(answer(-1)).code).toBe('BOND_CHECK_MALFORMED');
    expect(parseBondCheckOutput(answer(1.5)).code).toBe('BOND_CHECK_MALFORMED');
  });

  it('records "did not say" as null and admits it (residual R1, pinned not hidden)', () => {
    expect(parseBondCheckOutput(answer(), { ...EXPECTED, bondSats: 100_000 })).toMatchObject({
      ok: true,
      valueSats: null,
    });
  });
});
