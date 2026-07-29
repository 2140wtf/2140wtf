// src/pets/battle/lib/battleSprites.test.ts

import { describe, expect, it } from 'vitest';
import {
  battleSkinFrameUrl,
  parseBattleSpriteManifest,
  resolveBattleSkin,
  selectBattlePose,
} from './battleSprites';
import { createFighter } from './physics';
import { createPlaceholderCompanion } from './rival';

const MANIFEST = {
  version: 1,
  skins: {
    glitchfox: {
      frames: {
        idle: 'glitchfox/idle.webp',
        slash: 'glitchfox/slash.webp',
      },
      proceduralSword: false,
    },
    default: {
      frames: { idle: 'default/idle.webp' },
    },
  },
};

describe('parseBattleSpriteManifest', () => {
  it('accepts a well-formed manifest', () => {
    const parsed = parseBattleSpriteManifest(MANIFEST);
    expect(parsed?.skins.glitchfox?.frames?.slash).toBe('glitchfox/slash.webp');
    expect(parsed?.skins.glitchfox?.proceduralSword).toBe(false);
    expect(parsed?.skins.default?.proceduralSword).toBe(true);
  });

  it('rejects junk, wrong versions, and path escapes', () => {
    expect(parseBattleSpriteManifest(null)).toBeNull();
    expect(parseBattleSpriteManifest({ version: 2, skins: {} })).toBeNull();
    expect(
      parseBattleSpriteManifest({
        version: 1,
        skins: { evil: { frames: { idle: '/etc/passwd' } }, ok: { frames: {} } },
      }),
    ).toBeNull();
    const traversal = parseBattleSpriteManifest({
      version: 1,
      skins: { x: { frames: { idle: '../secret.webp', walk: 'x/walk.webp' } } },
    });
    expect(traversal?.skins.x?.frames?.idle).toBeUndefined();
    expect(traversal?.skins.x?.frames?.walk).toBe('x/walk.webp');
  });
});

describe('resolveBattleSkin', () => {
  const manifest = parseBattleSpriteManifest(MANIFEST)!;

  it('prefers the breed_asset skin, falls back to default, then to null', () => {
    const fox = { ...createPlaceholderCompanion(), breedAsset: 'glitchfox' };
    expect(resolveBattleSkin(manifest, fox)?.frames.slash).toBe('glitchfox/slash.webp');

    const other = { ...createPlaceholderCompanion(), breedAsset: 'biomechmoth' };
    expect(resolveBattleSkin(manifest, other)?.frames.idle).toBe('default/idle.webp');

    expect(resolveBattleSkin({ version: 1, skins: {} }, fox)).toBeNull();
    expect(resolveBattleSkin(null, fox)).toBeNull();
  });
});

describe('selectBattlePose + battleSkinFrameUrl', () => {
  it('prioritizes ko > move > hit > block > jump > dash > walk > idle', () => {
    const base = createFighter(createPlaceholderCompanion(), 200, 1);
    expect(selectBattlePose(base, 1000)).toBe('idle');

    expect(selectBattlePose({ ...base, vx: 100 }, 1000)).toBe('walk');
    expect(selectBattlePose({ ...base, vx: 100, dashUntil: 2000 }, 1000)).toBe('dash');
    expect(selectBattlePose({ ...base, y: 50 }, 1000)).toBe('jump');
    expect(selectBattlePose({ ...base, isBlocking: true }, 1000)).toBe('block');
    expect(selectBattlePose({ ...base, isHit: true, isBlocking: true }, 1000)).toBe('hit');
    expect(
      selectBattlePose({ ...base, isHit: true, activeMove: { id: 'slash', startedAt: 900 } }, 1000),
    ).toBe('slash');
    expect(
      selectBattlePose({ ...base, health: 0, activeMove: { id: 'slash', startedAt: 900 } }, 1000),
    ).toBe('ko');
  });

  it('falls back to the idle frame for missing poses', () => {
    const skin = { frames: { idle: 'x/idle.webp', slash: 'x/slash.webp' }, proceduralSword: true };
    expect(battleSkinFrameUrl(skin, 'slash')).toBe('/pets/battle/x/slash.webp');
    expect(battleSkinFrameUrl(skin, 'hammer-smash')).toBe('/pets/battle/x/idle.webp');
    expect(battleSkinFrameUrl({ frames: {}, proceduralSword: true }, 'idle')).toBeNull();
  });
});
