/**
 * ₿AO Fund campaign categories — shared by the /fund filter chips and the
 * Create Campaign dialog so the two never drift. The API stores the `id`
 * string verbatim on the fundraiser row.
 *
 * Legacy rows may carry `daos` (pre-rename) — normalize via baoCategoryId().
 */
export const BAO_CATEGORIES = [
  { id: 'infra', label: 'Infra' },
  { id: 'tools', label: 'Tools' },
  { id: 'baos', label: '₿AOs' },
  { id: 'nostr', label: 'Nostr' },
  { id: 'payments', label: 'Payments' },
  { id: 'wallets', label: 'Wallets' },
  { id: 'agents', label: 'Agents' },
  { id: 'compute', label: 'Compute' },
  { id: 'lightning', label: 'Lightning' },
  { id: 'ecash', label: 'Ecash' },
  { id: 'mining', label: 'Mining' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'security', label: 'Security' },
  { id: 'identity', label: 'Identity' },
  { id: 'social', label: 'Social' },
  { id: 'media', label: 'Media' },
  { id: 'games', label: 'Games' },
  { id: 'pets', label: 'Pets' },
  { id: 'markets', label: 'Markets' },
  { id: 'data', label: 'Data & Oracles' },
  { id: 'education', label: 'Education' },
  { id: 'other', label: 'Other' },
] as const;

export type BaoCategoryId = (typeof BAO_CATEGORIES)[number]['id'];

/** Normalize legacy/unknown category strings to a current id. */
export function baoCategoryId(category: string | null | undefined): BaoCategoryId {
  const normalized = category === 'daos' ? 'baos' : (category ?? 'tools');
  return (BAO_CATEGORIES.some((c) => c.id === normalized) ? normalized : 'other') as BaoCategoryId;
}

/** Display label for a raw category string (handles legacy `daos`). */
export function baoCategoryLabel(category: string | null | undefined): string {
  const id = baoCategoryId(category);
  return BAO_CATEGORIES.find((c) => c.id === id)?.label ?? 'Other';
}
