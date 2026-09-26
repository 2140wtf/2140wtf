/**
 * disputeCopy - human-readable presentation for the Court surfaces.
 *
 * Protocol values are raw on the wire and in the folds: escrow refs look
 * like `escrow:fr_abc::m1`, dispute events carry `original`/`proposed`
 * verbs, ids are 64-hex. Users should never have to read those. Everything
 * here is presentation only - parsing is defensive and never throws; the
 * caller keeps the raw values for tooltips, test ids and protocol calls.
 */

export interface EscrowRefParts {
  /** Escrow/campaign ref without the `escrow:` prefix or milestone suffix. */
  base: string;
  /** 1-based milestone number parsed from `::m<N>`; null when absent. */
  milestone: number | null;
}

/** Split `escrow:fr_x::m2` into `{ base: 'fr_x', milestone: 2 }`. */
export function parseEscrowRef(raw: string | null | undefined): EscrowRefParts {
  const value = (raw ?? '').trim();
  const withoutPrefix = value.startsWith('escrow:') ? value.slice('escrow:'.length) : value;
  const [base = '', suffix = ''] = withoutPrefix.split('::');
  const match = /^m(\d+)$/.exec(suffix);
  return { base, milestone: match ? Number(match[1]) : null };
}

/** e2e/probe disputes (the testing phase) - hidden from users by default. */
export function isTestDispute(raw: string | null | undefined): boolean {
  return /(?:court[_-]?e2e|(?:^|[_-])e2e(?:[_-]|$)|playground)/i.test(raw ?? '');
}

export function milestoneLabel(milestone: number | null): string {
  return milestone === null ? 'milestone' : `milestone ${milestone}`;
}

const OUTCOME_WORDS: Record<string, string> = {
  refund: 'Refund requested',
  refunded: 'Refund requested',
  released: 'Release proposed',
  release: 'Release proposed',
  release_funds: 'Release proposed',
};

/** `original`/`proposed` verbs → a plain-language one-liner. */
export function disputeTransitionCopy(original?: string | null, proposed?: string | null): string | null {
  const from = original ? OUTCOME_WORDS[original.toLowerCase()] ?? null : null;
  const to = proposed ? OUTCOME_WORDS[proposed.toLowerCase()] ?? null : null;
  if (from && to) return `${from} - ${to}`;
  if (from) return from;
  if (to) return to;
  return null;
}

/** Countdown to the appeal deadline, e.g. "appeal window closes in 23h". */
export function appealWindowCopy(deadline: number | null | undefined, now: number): string | null {
  if (!Number.isFinite(deadline) || !deadline) return null;
  const secs = Math.floor(deadline - now);
  if (secs <= 0) return 'appeal window closed';
  if (secs < 3600) return `appeal window closes in ${Math.max(1, Math.round(secs / 60))}m`;
  if (secs < 86400) return `appeal window closes in ${Math.round(secs / 3600)}h`;
  return `appeal window closes in ${Math.round(secs / 86400)}d`;
}

export interface CampaignNameSource {
  frId?: string;
  id: string;
  title: string;
}

/** Campaign title for an escrow ref; null when the feed does not know it. */
export function campaignTitleFor(
  base: string,
  campaigns: ReadonlyArray<CampaignNameSource>,
): string | null {
  const hit = campaigns.find((c) => c.frId === base || c.id === base);
  return hit?.title?.trim() ? hit.title : null;
}

/** One-line human label for a dispute: "<campaign> - milestone N". */
export function disputeLabel(
  escrowRef: string | null | undefined,
  campaigns: ReadonlyArray<CampaignNameSource>,
): string {
  const { base, milestone } = parseEscrowRef(escrowRef);
  const title = campaignTitleFor(base, campaigns) ?? 'Unknown campaign';
  return `${title} - ${milestoneLabel(milestone)}`;
}
