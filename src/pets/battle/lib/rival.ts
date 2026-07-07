import {
  derivePetsSeedV1,
  deriveSeedIdentity,
  type PetsCompanion,
  type PetsStage,
  type PetsState,
  type PetsProgressionState,
} from '@/pets/core/lib/pets';
import { deriveAdultFormFromSeed } from '@/pets/adult-pets/types/adult.types';

function basePlaceholder(
  d: string,
  name: string,
  stage: PetsStage,
  seed: string,
): PetsCompanion {
  const visualTraits = deriveSeedIdentity(seed);
  const adultType =
    stage === 'adult' ? deriveAdultFormFromSeed(seed) : undefined;

  return {
    event: {
      kind: 31124,
      pubkey: '',
      created_at: 0,
      content: '',
      tags: [],
      id: '',
      sig: '',
    },
    d,
    name,
    stage,
    state: 'active' as PetsState,
    progressionState: 'none' as PetsProgressionState,
    seed,
    visualTraits,
    isLegacy: false,
    needsSeedIdentitySync: false,
    lastInteraction: 0,
    lastDecayAt: 0,
    stats: {
      hunger: 100,
      happiness: 100,
      health: 100,
      hygiene: 100,
      energy: 100,
    },
    generation: 1,
    breedingReady: false,
    socialOpen: false,
    careStreak: 0,
    careStreakLastAt: 0,
    careStreakLastDay: undefined,
    incubationTime: 0,
    startIncubation: 0,
    adultType,
    customFormId: undefined,
    fiatBalance: 2_140,
    eggScale: 1,
    stateStartedAt: 0,
    progressionStartedAt: 0,
    tasks: [],
    tasksCompleted: [],
    evolution: [],
    allTags: [],
  } as PetsCompanion;
}

export function createPlaceholderCompanion(): PetsCompanion {
  return basePlaceholder(
    'placeholder',
    'Waiting...',
    'adult',
    '0000000000000000000000000000000000000000000000000000000000000000',
  );
}

export function createRivalCompanion(
  ownerPubkey: string,
  index: number,
): PetsCompanion {
  const seed = derivePetsSeedV1(
    ownerPubkey,
    `2140pets-rival-${index}`,
    1,
  );
  return basePlaceholder(seed.slice(0, 16), 'Rival Blob', 'adult', seed);
}

export function isPlaceholderCompanion(
  companion: PetsCompanion,
): boolean {
  return companion.d === 'placeholder';
}
