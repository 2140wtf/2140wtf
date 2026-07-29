import { describe, it, expect } from 'vitest';

import { resolveBabySvg } from './baby-svg-resolver';
import { customizeBabySvgFromPets } from './baby-svg-customizer';
import { BAO_RECIPE, getBaoRecipeById } from '@/pets/adult-pets/lib/bao-recipe';
import type { Pets } from '@/pets/core/types/pets';

function makeBabyPets(overrides: Partial<Pets> = {}): Pets {
  return {
    id: 'pet-1',
    name: 'Test Pet',
    lifeStage: 'baby',
    state: 'active',
    breedCategory: 'ditto-blobbi',
    baseColor: '#f7931a',
    stats: { hunger: 100, happiness: 100, health: 100, hygiene: 100, energy: 100 },
    createdAt: 1,
    ...overrides,
  } as Pets;
}

describe('resolveBabySvg — every baby resembles its mature form', () => {
  it('₿AO babies render the ₿AO creature with their recipe palette', () => {
    const recipe = BAO_RECIPE.find((r) => r.id === 'bao-02')!;
    const pets = makeBabyPets({ breedCategory: 'bao', breedAsset: recipe.id });

    const svg = resolveBabySvg(pets);

    // Same creature + palette as the adult trading-card variation.
    expect(svg).toContain('bao-baby-art');
    expect(svg).toContain(`data-bao-id="${recipe.id}"`);
    expect(svg).toContain(`--baseColor: ${recipe.palette.base}`);
    expect(svg).toContain(`--secondaryColor: ${recipe.palette.secondary}`);
    expect(svg).toContain(`--eyeColor: ${recipe.palette.eye}`);
    // Not the generic droplet.
    expect(svg).not.toContain('petsBodyGradient');
  });

  it('₿AO babies keep identity accessories but drop the rare back/aura flex', () => {
    // bao-14 (Halving Hydra): crown horns, rune-circle marking, wings back, rare aura.
    const svg = resolveBabySvg(makeBabyPets({ breedCategory: 'bao', breedAsset: 'bao-14' }));

    // Crown horns + rune-circle marking survive (identity).
    expect(svg).toContain('₿'); // rune-circle marking text
    expect(svg).toContain('<polygon points="60,55 75,40 90,55'); // crown
    // Wings (back) and aura circles do not.
    expect(svg).not.toContain('Q30 60 25 95'); // wings path
    expect(svg).not.toContain('r="82"'); // legendary/rare aura circles
  });

  it('₿AO babies opt out of seed-based recoloring (recipe palette is identity)', () => {
    const pets = makeBabyPets({ breedCategory: 'bao', breedAsset: 'bao-02' });
    const svg = resolveBabySvg(pets);

    expect(svg).toContain('data-pets-fixed-colors="true"');

    // The baby customizer must leave the palette untouched (only uniquify IDs).
    const customized = customizeBabySvgFromPets(svg, pets, false);
    const recipe = getBaoRecipeById('bao-02')!;
    expect(customized).toContain(`--baseColor: ${recipe.palette.base}`);
    expect(customized).not.toContain(pets.baseColor!);
  });

  it('unknown ₿AO assets fall back to the generic baby', () => {
    const svg = resolveBabySvg(makeBabyPets({ breedCategory: 'bao', breedAsset: 'bao-99' }));
    expect(svg).toContain('petsBodyGradient');
  });

  it('2140-pets keep the gangster baby design', () => {
    const svg = resolveBabySvg(makeBabyPets({ breedCategory: '2140-pets' }));
    expect(svg).toContain('data-pets-fixed-colors="true"');
    // The approved cap + spliff design, not the generic droplet or ₿AO art.
    expect(svg).toContain('<!-- Flat baseball cap -->');
    expect(svg).not.toContain('bao-art');
  });

  it('other categories (ditto-blobbi, buzz, custom) keep the generic droplet', () => {
    // Buzz babies resemble their adult via the static Buzz PNG in
    // PetsBabyVisual, not via this SVG resolver.
    for (const breedCategory of ['ditto-blobbi', 'buzz', 'custom'] as const) {
      const svg = resolveBabySvg(makeBabyPets({ breedCategory, breedAsset: 'fizz' }));
      expect(svg).toContain('petsBodyGradient');
    }
  });
});
