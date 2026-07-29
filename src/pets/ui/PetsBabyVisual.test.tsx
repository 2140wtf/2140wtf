import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

import { PetsBabyVisual } from './PetsBabyVisual';
import type { Pets } from '@/pets/core/types/pets';

// The eye hooks run RAF loops and query SVG DOM — irrelevant to these branch
// tests, so stub them out.
vi.mock('./lib/usePetsEyes', () => ({ usePetsEyes: () => undefined }));
vi.mock('./lib/useExternalEyeOffset', () => ({ useExternalEyeOffset: () => undefined }));

function makeBabyPets(overrides: Partial<Pets> = {}): Pets {
  return {
    id: 'pet-1',
    name: 'Test Pet',
    lifeStage: 'baby',
    state: 'active',
    breedCategory: 'buzz',
    breedAsset: 'fizz',
    baseColor: '#f7931a',
    stats: { hunger: 100, happiness: 100, health: 100, hygiene: 100, energy: 100 },
    createdAt: 1,
    ...overrides,
  } as Pets;
}

describe('PetsBabyVisual — baby resembles the mature form', () => {
  it('Buzz babies render the static first frame of their adult character', () => {
    const { container } = render(<PetsBabyVisual pets={makeBabyPets()} />);

    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe('/pets/buzz/fizz.png');
    // No SVG droplet alongside it.
    expect(container.querySelector('svg')).toBeNull();
  });

  it('non-Buzz babies keep the SVG pipeline', () => {
    const { container } = render(
      <PetsBabyVisual pets={makeBabyPets({ breedCategory: 'ditto-blobbi', breedAsset: undefined })} />,
    );

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('₿AO babies render the ₿AO creature SVG with their recipe palette', () => {
    const { container } = render(
      <PetsBabyVisual pets={makeBabyPets({ breedCategory: 'bao', breedAsset: 'bao-02' })} />,
    );

    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(container.innerHTML).toContain('bao-baby-art');
    // Recipe palette inlined by the sanitizer — not black var() stubs.
    expect(container.innerHTML).toContain('#3f1806');
    expect(container.innerHTML).not.toContain('var(--');
  });
});
