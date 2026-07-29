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
import { BUZZ_PETS } from '@/pets/core/lib/buzz-pets';

export type PetsBreedCategory = '2140-pets' | 'ditto-blobbi' | 'bao' | 'buzz' | 'custom';

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
  /** Original BAO recipe id used to render the card SVG / rarity. */
  recipeId?: string;
}

export interface BuzzMember {
  kind: 'buzz';
  /** Buzz pet id ('bumble' | 'fizz' | 'honey'); also the breed_asset tag value. */
  id: string;
  label: string;
}

export type CategoryMember = AdultFormMember | BaoCardMember | BuzzMember;

export const BREED_CATEGORIES: readonly BreedCategoryMeta[] = [
  {
    id: '2140-pets',
    label: '2140 Pets',
    description: 'Rare digital life-forms discovered beyond the chain.',
  },
  {
    id: 'ditto-blobbi',
    label: 'Blobbi',
    description: 'Playful nature spirits that grow with every interaction.',
  },
  {
    id: 'bao',
    label: '₿AO Pets',
    description: 'Animated market-born companions unlocked through ₿AO trading energy.',
  },
  {
    id: 'buzz',
    label: 'Buzz',
    description: 'Animated clay companions from the Buzz universe.',
  },
  {
    id: 'custom',
    label: 'Custom',
    description: 'Species you design and host yourself: your own GLB, SVG, and world.',
  },
] as const;

/**
 * Curated ₿AO market-born forms shown under the 2140 Pets species category.
 *
 * The full set has 21 near-duplicate trading-card variations; we surface only
 * the most visually distinct ones and label them with their canonical names.
 */
/**
 * Curated ₿AO market-born forms shown under the 2140 Pets species category.
 *
 * The full set has 21 near-duplicate trading-card variations; we surface only
 * the most visually distinct ones and give them stylised names that match
 * their colour/accessory theme.
 */
const BAO_MEMBERS: BaoCardMember[] = [
  { kind: 'bao-card' as const, id: 'root-pup', label: 'Root Pup', recipeId: 'bao-01' },
  { kind: 'bao-card' as const, id: 'jolt-hound', label: 'Jolt Hound', recipeId: 'bao-06' },
  { kind: 'bao-card' as const, id: 'matrix-lynx', label: 'Matrix Lynx', recipeId: 'bao-09' },
  { kind: 'bao-card' as const, id: 'skyjack-hawk', label: 'Skyjack Hawk', recipeId: 'bao-12' },
  { kind: 'bao-card' as const, id: 'thorn-drake', label: 'Thorn Drake', recipeId: 'bao-13' },
  { kind: 'bao-card' as const, id: 'crown-hydra', label: 'Crown Hydra', recipeId: 'bao-14' },
  { kind: 'bao-card' as const, id: 'ember-manticore', label: 'Ember Manticore', recipeId: 'bao-15' },
  { kind: 'bao-card' as const, id: 'azure-dragon', label: 'Azure Dragon', recipeId: 'bao-17' },
  { kind: 'bao-card' as const, id: 'oracle-bull', label: 'Oracle Bull', recipeId: 'bao-18' },
  { kind: 'bao-card' as const, id: 'apex-hound', label: 'Apex Hound', recipeId: 'bao-21' },
];

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
    {
      kind: 'adult-form',
      form: 'honey-badger',
      label: 'Honey Badger',
    },
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
  bao: BAO_MEMBERS,
  buzz: BUZZ_PETS.map((p) => ({ kind: 'buzz' as const, id: p.id, label: p.label })),
  custom: [],
};

export function isAdultFormMember(member: CategoryMember): member is AdultFormMember {
  return member.kind === 'adult-form';
}

/** The `breed_asset` tag value for a category member. */
export function getMemberAssetId(member: CategoryMember): string {
  if (isAdultFormMember(member)) return member.form;
  return member.kind === 'bao-card' ? member.recipeId ?? member.id : member.id;
}

export function getCategoryMembers(category: PetsBreedCategory): CategoryMember[] {
  return CATEGORY_MEMBERS[category];
}

/** Build dynamic members for the custom category from the owner's custom species. */
export function getCustomCategoryMembers(
  forms: ReadonlyArray<{ id: string; label: string }>,
): AdultFormMember[] {
  return forms.map((form) => ({
    kind: 'adult-form' as const,
    form: form.id as AdultForm,
    label: form.label,
  }));
}

export function getRandomCategoryMember(category: PetsBreedCategory): CategoryMember {
  const members = getCategoryMembers(category);
  if (members.length === 0) {
    throw new Error(`Breed category "${category}" has no members.`);
  }
  const index = crypto.getRandomValues(new Uint32Array(1))[0] % members.length;
  return members[index];
}

export function isCustomCategory(category: PetsBreedCategory): boolean {
  return category === 'custom';
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

