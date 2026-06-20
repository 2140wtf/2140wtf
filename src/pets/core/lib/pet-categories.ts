/**
 * Pet breed categories
 *
 * Groups the available pet breeds/adult forms into three user-facing
 * categories. Used by:
 *  - the new-account category picker
 *  - the Species tab tabs
 *  - category-constrained egg generation
 */

import type { AdultForm } from '@/pets/adult-pets/types/adult.types';

export type PetsBreedCategory = '2140-pets' | 'ditto-blobbi' | 'bao';

export interface BreedCategoryMeta {
  id: PetsBreedCategory;
  label: string;
  description: string;
}

export interface AdultFormMember {
  kind: 'adult-form';
  form: AdultForm;
  label: string;
}

export interface BaoCardMember {
  kind: 'bao-card';
  id: string;
  label: string;
}

export type CategoryMember = AdultFormMember | BaoCardMember;

export const BREED_CATEGORIES: readonly BreedCategoryMeta[] = [
  {
    id: '2140-pets',
    label: '2140 Pets',
    description: 'Rare digital life-forms discovered beyond the chain, including the ₿AO market-born line.',
  },
  {
    id: 'ditto-blobbi',
    label: 'Ditto Blobbi',
    description: 'Playful nature spirits that grow with every interaction.',
  },
  {
    id: 'bao',
    label: '₿AO Pets',
    description: 'Animated market-born companions unlocked through ₿AO trading energy.',
  },
] as const;

const BAO_MEMBERS: BaoCardMember[] = Array.from({ length: 21 }, (_, i) => {
  const n = String(i + 1).padStart(2, '0');
  return {
    kind: 'bao-card' as const,
    id: `bao-${n}`,
    label: `₿AO #${i + 1}`,
  };
});

export const CATEGORY_MEMBERS: Record<PetsBreedCategory, CategoryMember[]> = {
  '2140-pets': [
    {
      kind: 'adult-form',
      form: 'glitchfox',
      label: 'Glitch Fox',
    },
    {
      kind: 'adult-form',
      form: 'biomechmoth',
      label: 'Bio-Mech Moth',
    },
    {
      kind: 'adult-form',
      form: 'liquidblob',
      label: 'Liquid Blob',
    },
    ...BAO_MEMBERS,
  ],
  'ditto-blobbi': [
    { kind: 'adult-form', form: 'bloomi', label: 'Bloomi' },
    { kind: 'adult-form', form: 'breezy', label: 'Breezy' },
    { kind: 'adult-form', form: 'cacti', label: 'Cacti' },
    { kind: 'adult-form', form: 'catti', label: 'Catti' },
    { kind: 'adult-form', form: 'cloudi', label: 'Cloudi' },
    { kind: 'adult-form', form: 'crysti', label: 'Crysti' },
    { kind: 'adult-form', form: 'droppi', label: 'Droppi' },
    { kind: 'adult-form', form: 'flammi', label: 'Flammi' },
    { kind: 'adult-form', form: 'froggi', label: 'Froggi' },
    { kind: 'adult-form', form: 'leafy', label: 'Leafy' },
    { kind: 'adult-form', form: 'mushie', label: 'Mushie' },
    { kind: 'adult-form', form: 'owli', label: 'Owli' },
    { kind: 'adult-form', form: 'pandi', label: 'Pandi' },
    { kind: 'adult-form', form: 'rocky', label: 'Rocky' },
    { kind: 'adult-form', form: 'rosey', label: 'Rosey' },
    { kind: 'adult-form', form: 'starri', label: 'Starri' },
  ],
  bao: [],
};

export function isAdultFormMember(member: CategoryMember): member is AdultFormMember {
  return member.kind === 'adult-form';
}

export function getCategoryMembers(category: PetsBreedCategory): CategoryMember[] {
  return CATEGORY_MEMBERS[category];
}

export function getRandomCategoryMember(category: PetsBreedCategory): CategoryMember {
  const members = getCategoryMembers(category);
  const index = crypto.getRandomValues(new Uint32Array(1))[0] % members.length;
  return members[index];
}

export function getCategoryMeta(category: PetsBreedCategory): BreedCategoryMeta {
  const meta = BREED_CATEGORIES.find((c) => c.id === category);
  if (!meta) {
    throw new Error(`Unknown breed category: ${category}`);
  }
  return meta;
}

export function getCategoryLabel(category: PetsBreedCategory): string {
  return getCategoryMeta(category).label;
}

export function getCategoryDescription(category: PetsBreedCategory): string {
  return getCategoryMeta(category).description;
}

