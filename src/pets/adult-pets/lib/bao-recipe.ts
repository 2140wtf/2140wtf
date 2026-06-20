/**
 * ₿AO Pets variation recipe.
 *
 * One core creature, 21 trading-card variations. Accessories, markings, horns,
 * and colorways are layered; rarity is readable instantly. Data is derived from
 * the Open Design deliverable for the pet redesign.
 */

export type BaoRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export interface BaoPalette {
  base: string;
  secondary: string;
  eye: string;
}

export interface BaoAccessories {
  horns: string;
  marking: string;
  back: string;
  aura: string;
}

export interface BaoRecipe {
  id: string;
  name: string;
  rarity: BaoRarity;
  /** Human-readable drop weight string (for reference). */
  weight: string;
  palette: BaoPalette;
  accessories: BaoAccessories;
}

export const BAO_RECIPE: readonly BaoRecipe[] = [
  { id: 'bao-01', name: 'Satoshi Pup', rarity: 'common', weight: '50%', palette: { base: '#451a03', secondary: '#f59e0b', eye: '#fbbf24' }, accessories: { horns: 'none', marking: 'none', back: 'none', aura: 'none' } },
  { id: 'bao-02', name: 'Hash Hound', rarity: 'common', weight: '50%', palette: { base: '#3f1806', secondary: '#d97706', eye: '#fcd34d' }, accessories: { horns: 'small', marking: 'stripe', back: 'none', aura: 'none' } },
  { id: 'bao-03', name: 'Block Blob', rarity: 'common', weight: '50%', palette: { base: '#4a1905', secondary: '#f97316', eye: '#fdba74' }, accessories: { horns: 'none', marking: 'spots', back: 'none', aura: 'none' } },
  { id: 'bao-04', name: 'Node Nibbler', rarity: 'common', weight: '50%', palette: { base: '#2d1b0b', secondary: '#ea580c', eye: '#fed7aa' }, accessories: { horns: 'small', marking: 'circuit', back: 'none', aura: 'none' } },
  { id: 'bao-05', name: 'Relay Rat', rarity: 'common', weight: '50%', palette: { base: '#281203', secondary: '#fb923c', eye: '#ffedd5' }, accessories: { horns: 'none', marking: 'stripe', back: 'tail-coin', aura: 'none' } },
  { id: 'bao-06', name: 'Zap Zapper', rarity: 'common', weight: '50%', palette: { base: '#421c0a', secondary: '#fbbf24', eye: '#fef08a' }, accessories: { horns: 'lightning', marking: 'none', back: 'none', aura: 'none' } },
  { id: 'bao-07', name: 'Miner Mole', rarity: 'common', weight: '50%', palette: { base: '#1f1105', secondary: '#a16207', eye: '#fde047' }, accessories: { horns: 'none', marking: 'spots', back: 'none', aura: 'none' } },
  { id: 'bao-08', name: 'Key Keeper', rarity: 'common', weight: '50%', palette: { base: '#371307', secondary: '#ca8a04', eye: '#fef9c3' }, accessories: { horns: 'small', marking: 'rune-circle', back: 'none', aura: 'none' } },
  { id: 'bao-09', name: 'Ledger Lynx', rarity: 'uncommon', weight: '28%', palette: { base: '#0f172a', secondary: '#06b6d4', eye: '#67e8f9' }, accessories: { horns: 'ram', marking: 'chart-line', back: 'none', aura: 'none' } },
  { id: 'bao-10', name: 'Fiat Fiend', rarity: 'uncommon', weight: '28%', palette: { base: '#172554', secondary: '#3b82f6', eye: '#93c5fd' }, accessories: { horns: 'small', marking: 'stripe', back: 'tail-coin', aura: 'none' } },
  { id: 'bao-11', name: 'Vault Viper', rarity: 'uncommon', weight: '28%', palette: { base: '#1e1b4b', secondary: '#6366f1', eye: '#a5b4fc' }, accessories: { horns: 'rune-etched', marking: 'rune-circle', back: 'none', aura: 'none' } },
  { id: 'bao-12', name: 'Hashrate Hawk', rarity: 'uncommon', weight: '28%', palette: { base: '#111827', secondary: '#10b981', eye: '#6ee7b7' }, accessories: { horns: 'lightning', marking: 'circuit', back: 'wings', aura: 'none' } },
  { id: 'bao-13', name: 'Difficulty Drake', rarity: 'uncommon', weight: '28%', palette: { base: '#064e3b', secondary: '#14b8a6', eye: '#99f6e4' }, accessories: { horns: 'ram', marking: 'chart-line', back: 'spikes', aura: 'none' } },
  { id: 'bao-14', name: 'Halving Hydra', rarity: 'rare', weight: '14%', palette: { base: '#2e1065', secondary: '#a855f7', eye: '#d8b4fe' }, accessories: { horns: 'crown', marking: 'rune-circle', back: 'wings', aura: 'rare' } },
  { id: 'bao-15', name: 'Mempool Manticore', rarity: 'rare', weight: '14%', palette: { base: '#4c0519', secondary: '#e11d48', eye: '#fda4af' }, accessories: { horns: 'rune-etched', marking: 'circuit', back: 'tail-coin', aura: 'rare' } },
  { id: 'bao-16', name: 'Consensus Chimera', rarity: 'rare', weight: '14%', palette: { base: '#1a2e05', secondary: '#84cc16', eye: '#d9f99d' }, accessories: { horns: 'ram', marking: 'spots', back: 'spikes', aura: 'rare' } },
  { id: 'bao-17', name: 'Difficulty Dragon', rarity: 'rare', weight: '14%', palette: { base: '#0c2e4e', secondary: '#0ea5e9', eye: '#7dd3fc' }, accessories: { horns: 'lightning', marking: 'chart-line', back: 'wings', aura: 'rare' } },
  { id: 'bao-18', name: 'Oracle Ox', rarity: 'epic', weight: '6%', palette: { base: '#0a0a0a', secondary: '#f43f5e', eye: '#fb7185' }, accessories: { horns: 'crown', marking: 'rune-circle', back: 'halo', aura: 'epic' } },
  { id: 'bao-19', name: 'Whale Wyrm', rarity: 'epic', weight: '6%', palette: { base: '#020617', secondary: '#22d3ee', eye: '#a5f3fc' }, accessories: { horns: 'ram', marking: 'chart-line', back: 'wings', aura: 'epic' } },
  { id: 'bao-20', name: 'Nakamoto Naga', rarity: 'epic', weight: '6%', palette: { base: '#170404', secondary: '#f59e0b', eye: '#fde68a' }, accessories: { horns: 'rune-etched', marking: 'circuit', back: 'spikes', aura: 'epic' } },
  { id: 'bao-21', name: 'The Immutable', rarity: 'legendary', weight: '2%', palette: { base: '#000000', secondary: '#ffffff', eye: '#fbbf24' }, accessories: { horns: 'crown', marking: 'rune-circle', back: 'halo', aura: 'legendary' } },
] as const;

const RARITY_ORDER: Record<BaoRarity, number> = {
  common: 1,
  uncommon: 2,
  rare: 3,
  epic: 4,
  legendary: 5,
};

/** Effective stat cap bonus per rarity tier. Common caps at the default 100. */
export const BAO_STAT_CAP_BONUS: Record<BaoRarity, number> = {
  common: 0,
  uncommon: 5,
  rare: 12,
  epic: 20,
  legendary: 30,
};

/** Flat BAO reward bonus (sats) added to daily BAO claims per rarity tier. */
export const BAO_REWARD_BONUS: Record<BaoRarity, number> = {
  common: 10 * 100,
  uncommon: 18 * 100,
  rare: 28 * 100,
  epic: 40 * 100,
  legendary: 50 * 100,
};

/** Human-readable stat cap for UI display, e.g. "100", "105", "130". */
export function getBaoStatCap(rarity: BaoRarity): number {
  return 100 + BAO_STAT_CAP_BONUS[rarity];
}

export function getBaoRecipeById(id: string): BaoRecipe | undefined {
  return BAO_RECIPE.find((r) => r.id === id);
}

export function getBaoRarityColor(rarity: BaoRarity): string {
  switch (rarity) {
    case 'common':
      return 'oklch(70% 0.04 250)';
    case 'uncommon':
      return 'oklch(65% 0.12 145)';
    case 'rare':
      return 'oklch(60% 0.16 230)';
    case 'epic':
      return 'oklch(55% 0.18 300)';
    case 'legendary':
      return 'oklch(60% 0.20 60)';
  }
}

export function compareBaoRarity(a: BaoRarity, b: BaoRarity): number {
  return RARITY_ORDER[a] - RARITY_ORDER[b];
}
