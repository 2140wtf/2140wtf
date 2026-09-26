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
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function waterfallAllocation(
  milestones: WaterfallMilestone[],
  escrowedTotal: number,
  pledgeSats: number,
): WaterfallRow[] {
  const before = Number.isFinite(escrowedTotal) && escrowedTotal > 0 ? Math.floor(escrowedTotal) : 0;
  const pledge = Number.isFinite(pledgeSats) && pledgeSats > 0 ? Math.floor(pledgeSats) : 0;
  const after = before + pledge;
  let floor = 0;
  return milestones.map((m) => {
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
    };
  });
}
