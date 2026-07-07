import { describe, expect, it } from 'vitest';

import { resolvePets3DAsset } from '@/pets/three-d/lib/asset-resolver';
import type { PetsCompanion } from '@/pets/core/lib/pets';

const VALID_URL = 'https://blossom.example.com/1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b';
const VALID_HASH = '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b';

const baseCompanion: PetsCompanion = {
  event: {} as PetsCompanion['event'],
  d: '2140pets-test0000000000-test000000',
  name: 'Test',
  stage: 'adult',
  state: 'active',
  progressionState: 'none',
  seed: VALID_HASH,
  visualTraits: {
    baseColor: '#F59E0B',
    secondaryColor: '#FCD34D',
    eyeColor: '#1F2937',
    pattern: 'solid',
    specialMark: 'none',
    size: 'medium',
    archetype: 'ghost',
    specialAbility: 'glitch-step',
  },
  isLegacy: false,
  needsSeedIdentitySync: false,
  lastInteraction: 0,
  lastDecayAt: undefined,
  stats: {},
  generation: 1,
  breedingReady: false,
  socialOpen: false,
  careStreak: 1,
  careStreakLastAt: undefined,
  careStreakLastDay: undefined,
  incubationTime: undefined,
  startIncubation: undefined,
  adultType: 'catti',
  customFormId: undefined,
  fiatBalance: 2_140,
  eggScale: 1,
  breedCategory: '2140-pets',
  breedAsset: 'catti',
  stateStartedAt: undefined,
  progressionStartedAt: undefined,
  tasks: [],
  tasksCompleted: [],
  evolution: [],
  allTags: [],
};

describe('resolvePets3DAsset', () => {
  it('returns undefined for non-adult pets', () => {
    expect(resolvePets3DAsset({ ...baseCompanion, stage: 'baby' }, undefined)).toBeUndefined();
    expect(resolvePets3DAsset({ ...baseCompanion, stage: 'egg' }, undefined)).toBeUndefined();
  });

  it('prefers the pet-level asset_3d tag', () => {
    const asset = { url: VALID_URL, sha256: VALID_HASH };
    const resolved = resolvePets3DAsset({ ...baseCompanion, asset3d: asset }, undefined);
    expect(resolved).toEqual(asset);
  });

  it('falls back to profile-level default pet asset', () => {
    const profile = JSON.stringify({
      assets_3d: { v: 1, pet: { url: VALID_URL, sha256: VALID_HASH } },
    });
    const resolved = resolvePets3DAsset(baseCompanion, profile);
    expect(resolved?.url).toBe(VALID_URL);
  });

  it('prefers a per-form override when adultType matches', () => {
    const profile = JSON.stringify({
      assets_3d: {
        v: 1,
        pet: { url: 'https://blossom.example.com/default', sha256: VALID_HASH },
        by_form: {
          catti: { url: VALID_URL, sha256: VALID_HASH },
        },
      },
    });
    const resolved = resolvePets3DAsset(baseCompanion, profile);
    expect(resolved?.url).toBe(VALID_URL);
  });

  it('ignores per-form overrides for a different adultType', () => {
    const profile = JSON.stringify({
      assets_3d: {
        v: 1,
        pet: { url: 'https://blossom.example.com/default', sha256: VALID_HASH },
        by_form: {
          rocky: { url: VALID_URL, sha256: VALID_HASH },
        },
      },
    });
    const resolved = resolvePets3DAsset(baseCompanion, profile);
    expect(resolved?.url).toBe('https://blossom.example.com/default');
  });

  it('returns undefined when no asset is available', () => {
    expect(resolvePets3DAsset(baseCompanion, undefined)).toBeUndefined();
    expect(resolvePets3DAsset(baseCompanion, JSON.stringify({}))).toBeUndefined();
  });
});
