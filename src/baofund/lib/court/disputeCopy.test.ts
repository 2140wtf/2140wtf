import { describe, expect, it } from 'vitest';
import {
  appealWindowCopy,
  campaignTitleFor,
  disputeLabel,
  disputeTransitionCopy,
  isTestDispute,
  milestoneLabel,
  parseEscrowRef,
} from './disputeCopy';

describe('parseEscrowRef', () => {
  it('splits the escrow prefix and milestone suffix', () => {
    expect(parseEscrowRef('escrow:fr_abc::m2')).toEqual({ base: 'fr_abc', milestone: 2 });
    expect(parseEscrowRef('fr_abc::m10')).toEqual({ base: 'fr_abc', milestone: 10 });
  });
  it('tolerates bare refs and junk without throwing', () => {
    expect(parseEscrowRef('fr_abc')).toEqual({ base: 'fr_abc', milestone: null });
    expect(parseEscrowRef('escrow:fr_abc::m')).toEqual({ base: 'fr_abc', milestone: null });
    expect(parseEscrowRef(null)).toEqual({ base: '', milestone: null });
    expect(parseEscrowRef(undefined)).toEqual({ base: '', milestone: null });
  });
});

describe('isTestDispute', () => {
  it('flags e2e and playground escrows', () => {
    expect(isTestDispute('escrow:fr_court_e2e_1789868727588::m1')).toBe(true);
    expect(isTestDispute('escrow:fr_e2e_123::m1')).toBe(true);
    expect(isTestDispute('escrow:fr_playground_123::m1')).toBe(true);
  });
  it('does not flag real campaigns', () => {
    expect(isTestDispute('escrow:fr_2a3b4c5d6e7f::m1')).toBe(false);
    expect(isTestDispute('')).toBe(false);
    expect(isTestDispute(null)).toBe(false);
  });
});

describe('disputeTransitionCopy', () => {
  it('translates the refund/release verbs', () => {
    expect(disputeTransitionCopy('refund', 'released')).toBe('Refund requested - Release proposed');
    expect(disputeTransitionCopy('released', 'refund')).toBe('Release proposed - Refund requested');
  });
  it('degrades to a single verb or null', () => {
    expect(disputeTransitionCopy('refund', null)).toBe('Refund requested');
    expect(disputeTransitionCopy(null, null)).toBeNull();
    expect(disputeTransitionCopy('mystery', 'refund')).toBe('Refund requested');
  });
});

describe('appealWindowCopy', () => {
  it('reads as a human countdown', () => {
    expect(appealWindowCopy(1_000 + 45 * 60, 1_000)).toBe('appeal window closes in 45m');
    expect(appealWindowCopy(1_000 + 23 * 3600, 1_000)).toBe('appeal window closes in 23h');
    expect(appealWindowCopy(1_000 + 2 * 86400, 1_000)).toBe('appeal window closes in 2d');
    expect(appealWindowCopy(900, 1_000)).toBe('appeal window closed');
    expect(appealWindowCopy(null, 1_000)).toBeNull();
  });
});

describe('campaign naming', () => {
  const campaigns = [
    { id: 'draft-1', frId: 'fr_abc', title: 'Solar Microgrid' },
    { id: 'draft-2', title: 'No API id' },
  ];
  it('resolves by frId or draft id', () => {
    expect(campaignTitleFor('fr_abc', campaigns)).toBe('Solar Microgrid');
    expect(campaignTitleFor('draft-2', campaigns)).toBe('No API id');
    expect(campaignTitleFor('fr_missing', campaigns)).toBeNull();
  });
  it('builds the one-line dispute label', () => {
    expect(disputeLabel('escrow:fr_abc::m3', campaigns)).toBe('Solar Microgrid - milestone 3');
    expect(disputeLabel('escrow:fr_missing::m1', campaigns)).toBe('Unknown campaign - milestone 1');
    expect(disputeLabel('escrow:fr_abc', campaigns)).toBe('Solar Microgrid - milestone');
  });
});

describe('milestoneLabel', () => {
  it('uses words, not raw refs', () => {
    expect(milestoneLabel(1)).toBe('milestone 1');
    expect(milestoneLabel(null)).toBe('milestone');
  });
});
