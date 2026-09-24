import { describe, expect, it } from 'vitest';
import { gateBadgeLine, gateStripCodes, releaseGateView, tierFromRail } from './releaseGateBridge';
import type { LedgerSummary } from '../relay/ledgerFeed';

const T0 = 1_700_000_000;
const NOW = T0 + 1000;

function summary(over: Partial<LedgerSummary> = {}): LedgerSummary {
  return { raisedSats: 50_000, entriesCount: 5, headHash: 'aa'.repeat(32), closed: false, ...over };
}

describe('tierFromRail', () => {
  it('maps rails to tiers; unknown rail → none (longest window, fail-closed)', () => {
    expect(tierFromRail('cashu-human-court')).toBe('human-court');
    expect(tierFromRail('agent-verified-testnet4')).toBe('agent-verified');
    expect(tierFromRail('cashu')).toBe('none');
    expect(tierFromRail(undefined)).toBe('none');
    expect(tierFromRail('')).toBe('none');
  });
});

describe('releaseGateView - honesty rules', () => {
  it('no ledger fold → null (never project gates for unverifiable money)', () => {
    expect(releaseGateView({ campaign: 'c', summary: undefined, rail: 'cashu', nowSeconds: NOW })).toBeNull();
  });

  it('verified fold with raised sats → view exists; unknown diversity fails closed (no fabricated pass)', () => {
    const v = releaseGateView({ campaign: 'c', summary: summary(), rail: 'cashu', nowSeconds: NOW });
    expect(v).not.toBeNull();
    expect(v!.releaseEligible).toBe(false);
    // window is unknown → milestoneCompletedAt=now → window gate blocks
    expect(v!.blockedBy).toContain('dispute_window');
    // sealed split unknown → diversity gate blocks on the none-tier
    expect(v!.blockedBy).toContain('diversity_gate');
  });

  it('a folded zero-balance campaign blocks on escrow_balance with the ledger fact', () => {
    const v = releaseGateView({ campaign: 'c', summary: summary({ raisedSats: 0 }), rail: 'cashu', nowSeconds: NOW });
    expect(v!.blockedBy).toEqual(['dispute_window', 'diversity_gate', 'escrow_balance']);
  });

  it('human-court tier skips the diversity gate even with unknown split', () => {
    const v = releaseGateView({ campaign: 'c', summary: summary(), rail: 'cashu-human-court', nowSeconds: NOW });
    expect(v!.blockedBy).not.toContain('diversity_gate');
  });

  it('closed fold after release still reports gates honestly (balance = 0)', () => {
    const v = releaseGateView({ campaign: 'c', summary: summary({ raisedSats: 0, closed: true, entriesCount: 9 }), rail: 'cashu', nowSeconds: NOW });
    expect(v!.blockedBy).toContain('escrow_balance');
  });

  it('registrar silence beyond 72h → registrar_dead + refund escape opensAt exposed', () => {
    const lastSeen = T0 - 80 * 3600;
    const v = releaseGateView({ campaign: 'c', summary: summary(), rail: 'cashu', nowSeconds: NOW, registrarLastSeen: lastSeen });
    expect(v!.phase).toBe('registrar_dead');
    expect(v!.refundEscape.available).toBe(true);
    expect(v!.refundEscape.opensAt).toBe(lastSeen + 72 * 3600 + 7 * 86400);
    expect(v!.blockedBy).toContain('registrar_liveness');
  });

  it('registrar recently seen → liveness passes by default (unknown lastSeen = now)', () => {
    const v = releaseGateView({ campaign: 'c', summary: summary(), rail: 'cashu', nowSeconds: NOW });
    expect(v!.blockedBy).not.toContain('registrar_liveness');
  });
});

describe('card copy helpers', () => {
  it('gateBadgeLine: eligible → fixed line; blocked → first failing reason', () => {
    const ok = releaseGateView({ campaign: 'c', summary: summary(), rail: 'cashu', nowSeconds: NOW });
    expect(gateBadgeLine(ok!)).toMatch(/window/); // first blocker is the window gate

    const empty = releaseGateView({ campaign: 'c', summary: summary({ raisedSats: 0 }), rail: 'cashu', nowSeconds: NOW });
    // First blocker in evaluation order is the window gate; escrow_balance is in blockedBy too.
    expect(gateBadgeLine(empty!)).toMatch(/window/);
    expect(empty!.blockedBy).toContain('escrow_balance');
  });

  it('gateStripCodes: max 3 codes + overflow count', () => {
    const v = releaseGateView({ campaign: 'c', summary: summary({ raisedSats: 0 }), rail: 'cashu', nowSeconds: NOW });
    const strip = gateStripCodes(v!);
    expect(strip.codes.length).toBeLessThanOrEqual(3);
    expect(strip.overflow).toBe(v!.blockedBy.length - strip.codes.length);
  });
});
