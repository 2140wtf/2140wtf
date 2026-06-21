export interface ZapPollOption {
  id: string;
  label: string;
}

function getTag(tags: string[][], name: string): string | undefined {
  return tags.find(([n]) => n === name)?.[1];
}

/** Parse NIP-69 poll_option tags into option shapes. */
export function getZapPollOptions(tags: string[][]): ZapPollOption[] {
  return tags
    .filter(([name]) => name === 'poll_option')
    .map(([, id, label]) => ({ id: id ?? '', label: label ?? '' }))
    .filter((opt) => opt.id && opt.label);
}

/** Parse a numeric constraint tag (value_minimum / value_maximum / closed_at). */
export function getZapPollConstraint(tags: string[][], name: string): number | undefined {
  const value = getTag(tags, name);
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Validate that a kind 6969 zap poll has the required NIP-69 constraints. */
export function validateZapPoll(tags: string[][]): { ok: true } | { ok: false; reason: string } {
  const options = getZapPollOptions(tags);
  if (options.length < 2) {
    return { ok: false, reason: 'A zap poll needs at least two options.' };
  }
  const min = getZapPollConstraint(tags, 'value_minimum');
  const max = getZapPollConstraint(tags, 'value_maximum');
  if (min === undefined && max === undefined) {
    return { ok: false, reason: 'Missing vote value constraints.' };
  }
  if (min !== undefined && max !== undefined && min > max) {
    return { ok: false, reason: 'Minimum vote value exceeds the maximum.' };
  }
  const closedAt = getTag(tags, 'closed_at');
  if (closedAt !== undefined && getZapPollConstraint(tags, 'closed_at') === undefined) {
    return { ok: false, reason: 'Invalid poll close time.' };
  }
  return { ok: true };
}
