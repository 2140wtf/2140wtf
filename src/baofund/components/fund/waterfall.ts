/**
 * Waterfall preview - how one pledge fills a campaign's milestones.
 *
 * The backend escrow is a single pot that fills milestones in idx order
 * (`pgGetMilestoneEscrowAmount`): a milestone's escrow is the slice of total
 * escrowed sats between the sum of earlier milestones' amounts and its own
 * cumulative threshold. This pure helper mirrors that math for the UI so the
 * donor can see, before paying, which milestone(s) their sats reach.
 *
 * Pure: no Date.now, no I/O - safe to call during render.
 */

export interface WaterfallMilestone {
  id: string;
  title: string;
  amountSats: number;
}

export interface WaterfallRow {
  id: string;
  title: string;
  /** Milestone target (its own amount). */
  targetSats: number;
  /** Escrowed toward this milestone before the pledge. */
  beforeSats: number;
  /** Funded by this pledge. */
  addedSats: number;
  /** Escrowed toward this milestone after the pledge. */
  afterSats: number;
  /** Fully covered after the pledge (and it has a non-zero target). */
  complete: boolean;
  /**
   * Sats of a SPLIT pledge beyond every milestone target. The API's
   * `allocateWaterfallSplit` attaches the remainder to the LAST funded
   * milestone's escrow output (no sat is ever dropped), so the split
   * preview must show it there - the pre-fix preview clamped it away and
   * told the donor their overfunding went nowhere. Always 0 when
   * `overfundLastRow` is not set.
   */
  overfundSats: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function waterfallAllocation(
  milestones: WaterfallMilestone[],
  escrowedTotal: number,
  pledgeSats: number,
  opts?: { overfundLastRow?: boolean },
): WaterfallRow[] {
  const before = Number.isFinite(escrowedTotal) && escrowedTotal > 0 ? Math.floor(escrowedTotal) : 0;
  const pledge = Number.isFinite(pledgeSats) && pledgeSats > 0 ? Math.floor(pledgeSats) : 0;
  const after = before + pledge;
  let floor = 0;
  const rows = milestones.map((m) => {
    const target = Number.isFinite(m.amountSats) && m.amountSats > 0 ? Math.floor(m.amountSats) : 0;
    const priorFloor = floor;
    floor += target;
    const beforeSats = clamp(before - priorFloor, 0, target);
    const afterSats = clamp(after - priorFloor, 0, target);
    return {
      id: m.id,
      title: m.title,
      targetSats: target,
      beforeSats,
      addedSats: afterSats - beforeSats,
      afterSats,
      complete: target > 0 && afterSats >= target,
      overfundSats: 0,
    };
  });
  if (opts?.overfundLastRow && rows.length > 0 && pledge > 0) {
    const allocated = rows.reduce((sum, r) => sum + r.addedSats, 0);
    const remainder = pledge - allocated;
    if (remainder > 0) {
      // Mirror the API: the remainder rides the LAST row that received
      // sats, or the last milestone when the goal was already covered.
      const target = [...rows].reverse().find((r) => r.addedSats > 0) ?? rows[rows.length - 1];
      target.addedSats += remainder;
      target.afterSats += remainder;
      target.overfundSats = remainder;
    }
  }
  return rows;
}
