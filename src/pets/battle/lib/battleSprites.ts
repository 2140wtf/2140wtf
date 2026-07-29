// src/pets/battle/lib/battleSprites.ts
//
// Battle sprite skins — Open Design–generated animated WebP frames that skin
// the procedural battle engine. Fully optional: when no manifest or no skin
// exists for a pet, the SVG renderer + canvas effects carry the fight.
//
// Asset contract (public/pets/battle/):
//   manifest.json — { version: 1, skins: { "<key>": { frames: {...}, proceduralSword?: bool } } }
//   frames        — animated WebP per pose: idle, walk, dash, jump, block,
//                   hit, ko, and one per move id (slash, slash-2, slash-3,
//                   uppercut, sweep, dash-slash, spin-slash, hammer-smash,
//                   air-slash, air-swirl, salto, dive-kick, flip-over,
//                   fireball, massive-fireball, fireball-upper, air-fireball,
//                   dash-fireball). Paths are relative to /pets/battle/.
//   keys          — a pet's breed_asset (e.g. "glitchfox"); "default" is the
//                   fallback skin used when a pet has no dedicated one.
//
// Missing frames inside a skin fall back to its idle frame; a missing skin
// falls back to the procedural renderer for that fighter.

import type { PetsCompanion } from '@/pets/core/lib/pets';
import type { BattleFighter } from '../types/battle.types';

export const BATTLE_SPRITES_BASE = '/pets/battle/';
export const BATTLE_SPRITES_MANIFEST_URL = `${BATTLE_SPRITES_BASE}manifest.json`;

export interface BattleSkin {
  frames: Record<string, string>;
  /** When false, the canvas stops drawing the procedural sword for this fighter. */
  proceduralSword: boolean;
}

export interface BattleSpriteManifest {
  version: number;
  skins: Record<
    string,
    {
      frames?: Record<string, string>;
      proceduralSword?: boolean;
    }
  >;
}

export function parseBattleSpriteManifest(raw: unknown): BattleSpriteManifest | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<BattleSpriteManifest>;
  if (candidate.version !== 1 || !candidate.skins || typeof candidate.skins !== 'object') {
    return null;
  }
  const skins: BattleSpriteManifest['skins'] = {};
  for (const [key, entry] of Object.entries(candidate.skins)) {
    if (!entry || typeof entry !== 'object') continue;
    const frames: Record<string, string> = {};
    for (const [pose, path] of Object.entries(entry.frames ?? {})) {
      if (typeof path === 'string' && path.length > 0 && !path.startsWith('/') && !path.includes('..')) {
        frames[pose] = path;
      }
    }
    if (Object.keys(frames).length === 0) continue;
    skins[key] = { frames, proceduralSword: entry.proceduralSword !== false };
  }
  return Object.keys(skins).length > 0 ? { version: 1, skins } : null;
}

let manifestPromise: Promise<BattleSpriteManifest | null> | null = null;

/** Fetch and cache the battle-sprite manifest; null when none is deployed. */
export function loadBattleSpriteManifest(): Promise<BattleSpriteManifest | null> {
  manifestPromise ??= fetch(BATTLE_SPRITES_MANIFEST_URL)
    .then((res) => (res.ok ? res.json() : null))
    .then(parseBattleSpriteManifest)
    .catch(() => null);
  return manifestPromise;
}

/** Test hook: drop the cached manifest promise. */
export function resetBattleSpriteManifestCache(): void {
  manifestPromise = null;
}

/** Resolve the skin for a fighter's pet: its breed_asset, else "default". */
export function resolveBattleSkin(
  manifest: BattleSpriteManifest | null,
  pet: PetsCompanion,
): BattleSkin | null {
  if (!manifest) return null;
  const entry =
    (pet.breedAsset ? manifest.skins[pet.breedAsset] : undefined) ?? manifest.skins.default;
  if (!entry || !entry.frames) return null;
  return { frames: entry.frames, proceduralSword: entry.proceduralSword !== false };
}

/** Pose the fighter should show right now (move id, or a base state). */
export function selectBattlePose(fighter: BattleFighter, now: number): string {
  if (fighter.health <= 0) return 'ko';
  if (fighter.activeMove) return fighter.activeMove.id;
  if (fighter.isHit) return 'hit';
  if (fighter.isBlocking) return 'block';
  if (fighter.y > 0) return 'jump';
  if (now < fighter.dashUntil) return 'dash';
  if (Math.abs(fighter.vx) > 1) return 'walk';
  return 'idle';
}

/** Frame URL for a pose, falling back to the skin's idle frame. */
export function battleSkinFrameUrl(skin: BattleSkin, pose: string): string | null {
  const path = skin.frames[pose] ?? skin.frames.idle;
  return path ? `${BATTLE_SPRITES_BASE}${path}` : null;
}
