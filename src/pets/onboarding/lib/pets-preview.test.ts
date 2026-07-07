import { describe, it, expect } from 'vitest';

import {
  generateEggPreviewForCategory,
  previewToEventTags,
} from './pets-preview';

import {
  CATEGORY_MEMBERS,
  BREED_CATEGORIES,
  isAdultFormMember,
} from '@/pets/core/lib/pet-categories';

import { getTagValue } from '@/pets/core/lib/pets';
import { deriveAdultFormFromSeed } from '@/pets/adult-pets/types/adult.types';
import { resolveAdultForm } from '@/pets/adult-pets/types/adult.types';
import { getBaoRecipeById } from '@/pets/adult-pets/lib/bao-recipe';
import { createDefaultPets } from '@/pets/core/types/pets';

const OWNER_PUBKEY =
  '0000000000000000000000000000000000000000000000000000000000000001';

function getTag(tags: string[][], name: string): string | undefined {
  return getTagValue(tags, name);
}

describe('generateEggPreviewForCategory', () => {
  it('stores the selected category and asset on the preview', () => {
    const preview = generateEggPreviewForCategory(OWNER_PUBKEY, '2140-pets');
    expect(preview.breedCategory).toBe('2140-pets');
    expect(preview.breedAsset).toBeDefined();
  });

  it('constrains 2140-pets eggs to the four 2140 adult forms', () => {
    const allowed = new Set(
      CATEGORY_MEMBERS['2140-pets']
        .filter(isAdultFormMember)
        .map((m) => m.form),
    );
    for (let i = 0; i < 30; i++) {
      const preview = generateEggPreviewForCategory(OWNER_PUBKEY, '2140-pets');
      const form = deriveAdultFormFromSeed(preview.seed);
      expect(allowed.has(form)).toBe(true);
    }
  });

  it('constrains ditto-blobbi eggs to the blobbi adult forms', () => {
    const allowed = new Set(
      CATEGORY_MEMBERS['ditto-blobbi']
        .filter(isAdultFormMember)
        .map((m) => m.form),
    );
    for (let i = 0; i < 30; i++) {
      const preview = generateEggPreviewForCategory(
        OWNER_PUBKEY,
        'ditto-blobbi',
      );
      const form = deriveAdultFormFromSeed(preview.seed);
      expect(allowed.has(form)).toBe(true);
    }
  });

  it('constrains bao eggs to known bao recipes', () => {
    for (let i = 0; i < 30; i++) {
      const preview = generateEggPreviewForCategory(OWNER_PUBKEY, 'bao');
      expect(preview.breedCategory).toBe('bao');
      expect(preview.breedAsset).toBeDefined();
      const recipe = getBaoRecipeById(preview.breedAsset!);
      expect(recipe).toBeDefined();
    }
  });

  it('lets a user create multiple pets of different species', () => {
    const first = generateEggPreviewForCategory(OWNER_PUBKEY, '2140-pets');
    const second = generateEggPreviewForCategory(OWNER_PUBKEY, 'ditto-blobbi');
    const third = generateEggPreviewForCategory(OWNER_PUBKEY, 'bao');

    expect(first.d).not.toBe(second.d);
    expect(second.d).not.toBe(third.d);

    expect(first.breedCategory).toBe('2140-pets');
    expect(second.breedCategory).toBe('ditto-blobbi');
    expect(third.breedCategory).toBe('bao');
  });
});

describe('previewToEventTags', () => {
  it('emits breed tags and an adult_type lock for adult-form categories', () => {
    const preview = generateEggPreviewForCategory(OWNER_PUBKEY, '2140-pets');
    const tags = previewToEventTags(preview);

    expect(getTag(tags, 'breed_category')).toBe('2140-pets');
    expect(getTag(tags, 'breed_asset')).toBe(preview.breedAsset);
    expect(getTag(tags, 'adult_type')).toBe(
      deriveAdultFormFromSeed(preview.seed),
    );
    expect(getTag(tags, 'bao_rarity')).toBeUndefined();
  });

  it('emits breed and bao_rarity tags for bao category', () => {
    const preview = generateEggPreviewForCategory(OWNER_PUBKEY, 'bao');
    const tags = previewToEventTags(preview);

    expect(getTag(tags, 'breed_category')).toBe('bao');
    expect(getTag(tags, 'breed_asset')).toBe(preview.breedAsset);
    expect(getTag(tags, 'bao_rarity')).toBeDefined();
    expect(getTag(tags, 'adult_type')).toBeUndefined();
  });
});

describe('resolveAdultForm', () => {
  it('prefers breed_asset over a mismatched seed for adult-form categories', () => {
    // A seed whose slice [40..48] maps to index 0 (bloomi, a blobbi).
    const mismatchedSeed =
      '0000000000000000000000000000000000000000' +
      '00000000' +
      '00000000000000000000000000000000';

    const pets = createDefaultPets({
      lifeStage: 'adult',
      seed: mismatchedSeed,
      breedCategory: '2140-pets',
      breedAsset: 'glitchfox',
      adult: { evolutionForm: undefined },
    });

    expect(resolveAdultForm(pets)).toBe('glitchfox');
  });

  it('still derives from seed when no breed asset is present', () => {
    const pets = createDefaultPets({
      lifeStage: 'adult',
      seed:
        '0000000000000000000000000000000000000000000000000000000000000001',
    });

    expect(resolveAdultForm(pets)).toBe(
      deriveAdultFormFromSeed(pets.seed!),
    );
  });
});

describe('category metadata', () => {
  it('has a non-empty member pool for every registered category', () => {
    for (const cat of BREED_CATEGORIES) {
      if (cat.id === 'custom') {
        // Custom species are owner-defined and may be empty until the user creates one.
        continue;
      }
      expect(CATEGORY_MEMBERS[cat.id].length).toBeGreaterThan(0);
    }
  });
});
