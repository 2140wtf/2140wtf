// src/lib/court/donorContribution.ts
//
// Donor-side contribution resolution, shared by the court GUI
// (`MilestoneCourtSection`) and the WS1 live drill.
//
// The public contribution payload carries no `milestone_id`, and the
// contribute response carries the campaign + milestones rather than the new
// contribution row. A donor with MORE THAN ONE escrowed cashu contribution on
// a campaign is therefore ambiguous: refuse (null) instead of refunding the
// wrong band. The caller must pass an explicit id in that case.

import { fetchContributions, type BaoContribution } from '../baoFundraising';

/**
 * Pick the donor's escrowed CASHU contribution from a public contribution
 * list. Exactly one match is required: cashu rail, donor pubkey, and an
 * escrowed/confirmed lifecycle (a row without a status is treated as live for
 * compatibility with older payloads).
 */
export function pickDonorEscrowContribution(
  list: BaoContribution[],
  donorPubkey: string,
): BaoContribution | null {
  const mine = list.filter((c) =>
    c.contributor_pubkey.toLowerCase() === donorPubkey.toLowerCase()
    && c.rail === 'cashu'
    && (!c.status || c.status === 'escrowed' || c.status === 'confirmed'));
  return mine.length === 1 ? mine[0] : null;
}

/**
 * Fetch the campaign's public contributions and resolve the donor's escrowed
 * cashu contribution id. Null when none or multiple match, and on any fetch
 * failure (the caller decides how to surface the ambiguity).
 */
export async function resolveDonorContributionId(
  frId: string,
  donorPubkey: string,
): Promise<string | null> {
  try {
    const row = pickDonorEscrowContribution(await fetchContributions(frId), donorPubkey);
    return row ? String(row.id) : null;
  } catch {
    return null;
  }
}
