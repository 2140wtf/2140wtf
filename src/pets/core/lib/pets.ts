import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { NostrEvent } from '@nostrify/nostrify';

import { ADULT_FORMS, type AdultForm, deriveAdultFormFromSeed } from '@/pets/adult-pets/types/adult.types';

import { validateAndRepairPetsTags } from './pets-tag-schema';
import { applyColorGuardrails, hexToHsl, hslToHex } from './color-guardrails';
import type { Asset3DEntry } from '@/pets/three-d/lib/three-d-schema';
import { parseAsset3DTag } from '@/pets/three-d/lib/three-d-schema';
import type { Mission } from './missions';
import { parseEvolutionContent } from './missions';
import { BREED_CATEGORIES, type PetsBreedCategory } from './pet-categories';
import type { BaoRarity } from '@/pets/adult-pets/lib/bao-recipe';
import { getBaoRecipeById } from '@/pets/adult-pets/lib/bao-recipe';

// ─── Constants ────────────────────────────────────────────────────────────────

export const PETS_ECOSYSTEM_NAMESPACE = 'pets:ecosystem:v1';

export const KIND_PETS_STATE = 31124;
export const KIND_NOSTR_PET_PROFILE = 11125;

/** @deprecated Legacy kind for Nostr pet profiles. Use KIND_NOSTR_PET_PROFILE (11125) instead. */
export const KIND_NOSTR_PET_PROFILE_LEGACY = 31125;

/** All Nostr pet profile kinds to query (for migration support) */
export const NOSTR_PET_PROFILE_KINDS = [KIND_NOSTR_PET_PROFILE, KIND_NOSTR_PET_PROFILE_LEGACY] as const;

// ─── Stat Bounds ──────────────────────────────────────────────────────────────

/**
 * Minimum stat value - stats can never go below this.
 * The minimum of 1 (instead of 0) ensures:
 * - Pets is never in an unrecoverable state
 * - Visual feedback shows critical state without being "dead"
 * - Recovery is always possible with any healing item
 */
export const STAT_MIN = 1;

/**
 * Maximum stat value - stats can never exceed this.
 */
export const STAT_MAX = 100;

// Default stats for a new egg
export const DEFAULT_EGG_STATS = {
  hunger: 100,
  happiness: 100,
  health: 100,
  hygiene: 100,
  energy: 100,
};

/**
 * @deprecated No longer used. Task system uses progression_started_at instead.
 * Kept for backwards compatibility with older code that may reference it.
 */
export const DEFAULT_INCUBATION_TIME = 345600;

// ─── Onboarding Constants ─────────────────────────────────────────────────────

/** Initial demo sats given to new Nostr pets (~one meal + a battle entry). */
export const INITIAL_NOSTR_PET_SATS = 2_140;

/** Cost in demo sats to reroll/generate another egg preview during onboarding */
export const PETS_PREVIEW_REROLL_SATS = 100;

/** Cost in demo sats to adopt a NOSTR PET from the preview (first pet is free) */
export const PETS_ADOPTION_SATS = 0;

/** Sats auto-claimed from the BAO faucet for every new NOSTR PET egg. */
export const BAO_PET_STARTER_GRANT_SATS = 2_140;

// ─── Date/Time Utilities ──────────────────────────────────────────────────────

/**
 * Get the current local day as a YYYY-MM-DD string.
 * Uses the user's local timezone for day boundary calculation.
 */
export function getLocalDayString(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parse a YYYY-MM-DD string into a Date object (at midnight local time).
 */
export function parseLocalDayString(dayString: string): Date {
  const [year, month, day] = dayString.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Get the number of days between two local day strings.
 * Returns 0 if same day, 1 if consecutive days, etc.
 */
export function getDaysDifference(dayA: string, dayB: string): number {
  const dateA = parseLocalDayString(dayA);
  const dateB = parseLocalDayString(dayB);
  const diffMs = Math.abs(dateB.getTime() - dateA.getTime());
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type PetsStage = 'egg' | 'baby' | 'adult';
export type PetsState = 'active' | 'sleeping' | 'hibernating';

/**
 * Progression process state — orthogonal to PetsState.
 * 
 * 'none'       — no progression process active
 * 'incubating' — egg is being incubated (hatch tasks)
 * 'evolving'   — baby is being evolved (evolve tasks)
 */
export type PetsProgressionState = 'none' | 'incubating' | 'evolving';

export interface PetsStats {
  hunger: number;
  happiness: number;
  health: number;
  hygiene: number;
  energy: number;
}

// ─── Visual Traits Types ──────────────────────────────────────────────────────

/**
 * Visual traits for a Pets, derived from seed or legacy tags.
 * 
 * This interface is designed to be directly consumable by the EggGraphic module.
 * All color values are canonical CSS hex colors.
 * All categorical values match the EggGraphic vocabulary.
 */
export interface PetsVisualTraits {
  /** Primary/base color - hex value (e.g., "#F59E0B") */
  baseColor: string;
  /** Secondary/accent color - hex value */
  secondaryColor: string;
  /** Eye color - hex value */
  eyeColor: string;
  /** Pattern type: 'solid' | 'spotted' | 'striped' | 'gradient' */
  pattern: PetsPattern;
  /** Special marking: 'none' | 'star' | 'heart' | 'sparkle' | 'blush' */
  specialMark: PetsSpecialMark;
  /** Size category: 'small' | 'medium' | 'large' */
  size: PetsSize;
  /** Cypherpunk 2140 archetype class */
  archetype: PetsArchetype;
  /** Cypherpunk 2140 special ability */
  specialAbility: PetsSpecialAbility;
}

/** Pattern types supported by EggGraphic */
export type PetsPattern = 'solid' | 'spotted' | 'striped' | 'gradient';

/** Special marks supported by EggGraphic */
export type PetsSpecialMark = 'none' | 'star' | 'heart' | 'sparkle' | 'blush';

/** Size categories supported by EggGraphic */
export type PetsSize = 'small' | 'medium' | 'large';

/** Cypherpunk 2140 archetype classes */
export type PetsArchetype = 'ghost' | 'runner' | 'netrunner' | 'drone' | 'construct' | 'cipher';

/** Cypherpunk 2140 special abilities */
export type PetsSpecialAbility = 'glitch-step' | 'overclock' | 'firewall' | 'synesthesia' | 'recursion' | 'mirror-self';

/** ₿AO rarity tier, persisted on kind 31124 for BAO pets. */
export type PetsBaoRarity = BaoRarity;

/**
 * @deprecated Legacy palette — no longer used for seed-based generation.
 * Colors are now derived as arbitrary HSL values from the seed, then passed
 * through applyColorGuardrails(). Kept only as a historical reference of
 * colors that existing events may have stored in explicit tags.
 */
export const PETS_BASE_COLORS: readonly string[] = [
  '#F59E0B', // Amber/Gold
  '#55C4A2', // Teal
  '#60A5FA', // Sky Blue
  '#F472B6', // Pink
  '#A78BFA', // Purple
  '#F87171', // Coral Red
  '#34D399', // Emerald
  '#FBBF24', // Yellow
  '#818CF8', // Indigo
  '#FB923C', // Orange
] as const;

/** @deprecated See PETS_BASE_COLORS. */
export const PETS_SECONDARY_COLORS: readonly string[] = [
  '#FCD34D', // Light Gold
  '#6EE7B7', // Light Teal
  '#93C5FD', // Light Blue
  '#F9A8D4', // Light Pink
  '#C4B5FD', // Light Purple
  '#FCA5A5', // Light Coral
  '#A7F3D0', // Light Emerald
  '#FDE68A', // Light Yellow
  '#A5B4FC', // Light Indigo
  '#FDBA74', // Light Orange
] as const;

/** @deprecated See PETS_BASE_COLORS. */
export const PETS_EYE_COLORS: readonly string[] = [
  '#1F2937', // Dark Gray (default)
  '#7C3AED', // Violet
  '#059669', // Emerald
  '#DC2626', // Red
  '#2563EB', // Blue
  '#D97706', // Amber
  '#DB2777', // Pink
  '#4F46E5', // Indigo
] as const;

/** Available patterns - EggGraphic compatible */
export const PETS_PATTERNS: readonly PetsPattern[] = [
  'solid',
  'spotted',
  'striped',
  'gradient',
] as const;

/** Available special marks - EggGraphic compatible */
export const PETS_SPECIAL_MARKS: readonly PetsSpecialMark[] = [
  'none',
  'star',
  'heart',
  'sparkle',
  'blush',
] as const;

/** Available sizes - EggGraphic compatible */
export const PETS_SIZES: readonly PetsSize[] = [
  'small',
  'medium',
  'large',
] as const;

/** Cypherpunk 2140 archetype classes */
export const PETS_ARCHETYPES: readonly PetsArchetype[] = [
  'ghost',
  'runner',
  'netrunner',
  'drone',
  'construct',
  'cipher',
] as const;

/** Cypherpunk 2140 special abilities */
export const PETS_SPECIAL_ABILITIES: readonly PetsSpecialAbility[] = [
  'glitch-step',
  'overclock',
  'firewall',
  'synesthesia',
  'recursion',
  'mirror-self',
] as const;

/** Default visual traits when seed is missing */
export const DEFAULT_VISUAL_TRAITS: PetsVisualTraits = {
  baseColor: '#F59E0B',
  secondaryColor: '#FCD34D',
  eyeColor: '#1F2937',
  pattern: 'solid',
  specialMark: 'none',
  size: 'medium',
  archetype: 'runner',
  specialAbility: 'glitch-step',
} as const;

/**
 * Parsed task progress stored in Pets event tags.
 * Format: ["task", "name:value"]
 */
export interface PetsTaskProgress {
  name: string;
  value: number;
}

/**
 * Parsed representation of a Kind 31124 Pets Current State event.
 */
export interface PetsCompanion {
  /** Original event for republishing */
  event: NostrEvent;
  /** The d tag value */
  d: string;
  /** Display name */
  name: string;
  /** Lifecycle stage */
  stage: PetsStage;
  /** Activity state (active, sleeping, hibernating — never progression) */
  state: PetsState;
  /** Progression process state (none, incubating, evolving — orthogonal to state) */
  progressionState: PetsProgressionState;
  /** Deterministic identity seed (64-char hex) */
  seed: string | undefined;
  /** Visual traits (derived from seed or legacy tags) */
  visualTraits: PetsVisualTraits;
  /** Whether this is a legacy event that needs migration */
  isLegacy: boolean;
  /** Whether stored mirror tags differ from seed-derived identity and need republishing */
  needsSeedIdentitySync: boolean;
  /** Timestamp of last user interaction (unix seconds) */
  lastInteraction: number;
  /** Timestamp used for stat decay checkpoint (unix seconds) */
  lastDecayAt: number | undefined;
  /** Stats (0-100) */
  stats: Partial<PetsStats>;
  /** Generation number */
  generation: number | undefined;
  /** Breeding eligibility */
  breedingReady: boolean;
  /** Whether external users can interact with this Pets (social tag = "open") */
  socialOpen: boolean;
  /** Consecutive care days */
  careStreak: number | undefined;
  /** Unix timestamp (seconds) of last streak update */
  careStreakLastAt: number | undefined;
  /** Local day string (YYYY-MM-DD) of last streak update */
  careStreakLastDay: string | undefined;
  /** 
   * @deprecated Incubation time in seconds - no longer used.
   * Task system uses progression_started_at instead.
   */
  incubationTime: number | undefined;
  /** 
   * @deprecated When incubation began - no longer used.
   * Replaced by progression_started_at for all process timing.
   */
  startIncubation: number | undefined;
  /** Adult evolution form type (adult only) */
  adultType: string | undefined;
  /** Breed category selected when the pet was minted. */
  breedCategory?: PetsBreedCategory;
  /** Category-specific asset identifier (adult form name or bao card id). */
  breedAsset?: string;
  /** ₿AO rarity tier (BAO pets only). */
  baoRarity?: PetsBaoRarity;
  /** Parent A d-tag when this pet was produced via breeding. */
  parentA?: string;
  /** Parent B d-tag when this pet was produced via breeding. */
  parentB?: string;
  /** Unix timestamp (seconds) when this pet can breed again. */
  breedingCooldown?: number;
  /** 
   * @deprecated Use progressionStartedAt instead.
   * Timestamp when current state (incubating/evolving) started (unix seconds).
   * Kept for migration compatibility.
   */
  stateStartedAt: number | undefined;
  /** Timestamp when current progression (incubating/evolving) started (unix seconds) */
  progressionStartedAt: number | undefined;
  /** Task progress cache (source of truth is computed from Nostr events) */
  tasks: PetsTaskProgress[];
  /** Completed task names */
  tasksCompleted: string[];
  /** Evolution missions parsed from 31124 content JSON (per-Pets progression) */
  evolution: Mission[];
  /** Optional Blossom-hosted 3D asset override for this adult pet. */
  asset3d?: Asset3DEntry;
  /** Custom species id when the pet belongs to a user-created custom form. */
  customFormId?: string;
  /** Pet-bound fiat balance (sats). Eggs start with 2140. */
  fiatBalance: number;
  /** Egg visual scale multiplier (DEV editor). */
  eggScale: number;
  /** All tags preserved for republishing */
  allTags: string[][];
}

/**
 * Stored item in user's profile (from purchases)
 */
export interface StorageItem {
  itemId: string;   // Must match a ShopItem.id
  quantity: number; // Must be >= 1
}

/**
 * Parsed representation of a Nostr Pet Profile event (Kind 11125).
 * Also supports legacy Kind 31125 profiles.
 */
export interface NostrPetProfile {
  /** Original event for republishing */
  event: NostrEvent;
  /** The d tag value */
  d: string;
  /** Currently selected companion Pets d-tag */
  currentCompanion: string | undefined;
  /** Whether onboarding/tutorial is complete */
  onboardingDone: boolean;
  /** Display name for the Nostr pet */
  name: string | undefined;
  /** List of owned Pets d-tags */
  has: string[];
  /** In-game currency balance */
  coins: number;
  /** Petting level (interaction counter) */
  pettingLevel: number;
  /** Date (YYYY-MM-DD) when daily mission rewards were last claimed */
  dailyRewardsClaimedAt: string | undefined;
  /** Date (YYYY-MM-DD) of the last daily login bonus */
  dailyLoginLastDay: string | undefined;
  /** Current consecutive daily login streak */
  dailyLoginStreak: number;
  /** Lifetime BAO coins earned from BAO trading activity */
  baoLifetimeVolume: number;
  /** Current BAO trader tier (derived from bao_lifetime_volume) */
  baoTier: number;
  /** Date (YYYY-MM-DD) when BAO trading rewards were last claimed */
  baoRewardsClaimedAt: string | undefined;
  /** Consecutive days with BAO trading activity. */
  baoTradeStreak: number;
  /** Local day string (YYYY-MM-DD) of last BAO trade streak update. */
  baoTradeStreakLastDay: string | undefined;
  /** Demo-sats / BTC-sats balance (all breed categories share this wallet). */
  sats: number;
  /** Current room the player is in (persisted for cross-session continuity) */
  room: string | undefined;
  /** Wallet mode for NOSTR Pets: 'bao' uses the BAO signet/demo wallet, 'cashu' uses real sats via the Cashu/NIP-60 wallet. */
  walletMode: 'bao' | 'cashu';
  /** Selected Cashu mint URL when wallet_mode is 'cashu'. */
  cashuMintUrl: string | undefined;
  /** Purchased items storage */
  storage: StorageItem[];
  /** Raw content string for missions JSON */
  content: string;
  /** All tags preserved for republishing */
  allTags: string[][];
}

// ─── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Normalize a raw breed_asset value into a ₿AO rarity tier.
 * Returns undefined if the asset is not a known BAO card id.
 */
export function getBaoRarityFromAsset(asset: string | undefined): BaoRarity | undefined {
  if (!asset || !asset.startsWith('bao-')) return undefined;
  const recipe = getBaoRecipeById(asset);
  return recipe?.rarity;
}

/**
 * Get the first 12 lowercase hex characters from a pubkey.
 */
export function getPubkeyPrefix12(pubkey: string): string {
  return pubkey.slice(0, 12).toLowerCase();
}

/**
 * Generate a random 10-character lowercase hex petId.
 */
export function generatePetId10(): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Derive a deterministic 10-character lowercase hex petId for legacy migration.
 *
 * The same (pubkey, legacyD) pair always produces the same petId, which means
 * the resulting canonical d-tag is stable across devices and sessions. This
 * makes the entire migration chain deterministic: petId → canonicalD → seed →
 * visual traits.
 *
 * Formula: sha256("pets:migration:v1|" + pubkey + ":" + legacyD).slice(0, 10)
 *
 * Only used during legacy → canonical migration. New egg creation still uses
 * the random generatePetId10().
 */
export function deriveMigrationPetId(pubkey: string, legacyD: string): string {
  const input = `pets:migration:v1|${pubkey}:${legacyD}`;
  const hashBytes = sha256(new TextEncoder().encode(input));
  return bytesToHex(hashBytes).slice(0, 10);
}

/**
 * Get the canonical d-tag for a Pets (Kind 31124).
 * Format: 2140pets-{ownerPubkeyPrefix12}-{petId10}
 */
export function getCanonicalPetsD(pubkey: string, petId: string): string {
  return `2140pets-${getPubkeyPrefix12(pubkey)}-${petId}`;
}

/**
 * Get the canonical d-tag for a Nostr Pet Profile (Kind 11125).
 * Format: blobbonaut-{pubkeyPrefix12}
 */
export function getCanonicalNostrPetProfileD(pubkey: string): string {
  return `blobbonaut-${getPubkeyPrefix12(pubkey)}`;
}

/**
 * Derive the Pets seed using sha256.
 * seed = sha256("pets:v1|" + pubkey + ":" + d + ":" + createdAt)
 * 
 * This is the raw derivation function. Use getOrDeriveSeed() when working with events
 * to ensure existing seeds are never recomputed.
 */
export function derivePetsSeedV1(pubkey: string, d: string, createdAt: number): string {
  const input = `pets:v1|${pubkey}:${d}:${createdAt}`;
  const hashBytes = sha256(new TextEncoder().encode(input));
  return bytesToHex(hashBytes);
}

/**
 * Get the seed from an existing event, or derive it if not present.
 * Per spec: Clients MUST NOT recompute the seed if a seed tag already exists.
 * 
 * @param event - The Pets event to get/derive seed from
 * @returns The existing seed or a newly derived one
 */
export function getOrDeriveSeed(event: NostrEvent): string {
  const existingSeed = getTagValue(event.tags, 'seed');
  if (existingSeed && existingSeed.length === 64) {
    return existingSeed;
  }
  
  const d = getTagValue(event.tags, 'd');
  if (!d) {
    throw new Error('Cannot derive seed: event missing d tag');
  }
  
  return derivePetsSeedV1(event.pubkey, d, event.created_at);
}

// ─── Tag Parsing Utilities ────────────────────────────────────────────────────

/**
 * Get the first value for a given tag name.
 * Does NOT assume tag order.
 */
export function getTagValue(tags: string[][], name: string): string | undefined {
  const tag = tags.find(([n]) => n === name);
  return tag?.[1];
}

/**
 * Get all values for a given tag name (for repeated tags like "has").
 */
export function getTagValues(tags: string[][], name: string): string[] {
  return tags.filter(([n]) => n === name).map(t => t[1]).filter(Boolean);
}

/**
 * Parse a numeric tag value, returning undefined if invalid.
 */
function parseNumericTag(tags: string[][], name: string): number | undefined {
  const value = getTagValue(tags, name);
  if (value === undefined) return undefined;
  const num = parseInt(value, 10);
  return isNaN(num) ? undefined : num;
}

/**
 * Parse a boolean tag value (string "true" or "false").
 */
function parseBooleanTag(tags: string[][], name: string, defaultValue = false): boolean {
  const value = getTagValue(tags, name);
  if (value === 'true') return true;
  if (value === 'false') return false;
  return defaultValue;
}

/**
 * Parse storage tags from a Nostr Pet Profile event (Kind 11125).
 * Storage tags format: ['storage', 'itemId:quantity']
 * 
 * @param tags - Event tags array
 * @returns Array of storage items with itemId and quantity
 */
export function parseStorageTags(tags: string[][]): StorageItem[] {
  return tags
    .filter(tag => tag[0] === 'storage')
    .map(tag => {
      const [itemId, quantityStr] = tag[1].split(':');
      return {
        itemId,
        quantity: parseInt(quantityStr, 10),
      };
    })
    .filter(item => item.itemId && !isNaN(item.quantity) && item.quantity > 0);
}

/**
 * Create storage tags from storage items array.
 * Each item becomes: ['storage', 'itemId:quantity']
 * 
 * @param storage - Array of storage items
 * @returns Array of storage tags
 */
export function createStorageTags(storage: StorageItem[]): string[][] {
  return storage
    .filter(item => item.itemId && item.quantity > 0)
    .map(item => ['storage', `${item.itemId}:${item.quantity}`]);
}

// ─── Legacy Detection ─────────────────────────────────────────────────────────

/**
 * Check if a Nostr pet d-tag is in canonical format.
 * Canonical: blobbonaut-{12 lowercase hex}
 */
export function isCanonicalNostrPetProfileD(d: string): boolean {
  return /^blobbonaut-[0-9a-f]{12}$/.test(d);
}

/**
 * Check if a Nostr pet d-tag is a legacy format.
 * Legacy formats:
 * - Blobbonaut-{8-12 hex} (capitalized)
 * - blobbonaut-profile
 * - blobbonaut-{8-11 hex}
 */
export function isLegacyNostrPetProfileD(d: string): boolean {
  // Capitalized version
  if (/^Blobbonaut-[0-9a-fA-F]{8,12}$/.test(d)) return true;
  // Generic profile id
  if (d === 'blobbonaut-profile') return true;
  // Short prefix (8-11 chars instead of 12)
  if (/^blobbonaut-[0-9a-f]{8,11}$/.test(d)) return true;
  return false;
}

/**
 * Check if a Pets d-tag is in canonical format.
 * Canonical: 2140pets-{12 lowercase hex}-{10 lowercase hex}
 * Per spec: petId MUST be 10 lowercase hex characters
 */
export function isCanonicalPetsD(d: string): boolean {
  return /^2140pets-[0-9a-f]{12}-[0-9a-f]{10}$/.test(d);
}

/**
 * Check if a Pets d-tag is a legacy format (e.g., pets-puck, pets-fluffy).
 */
export function isLegacyPetsD(d: string): boolean {
  // Legacy: pets-{name} where name is NOT the canonical format
  if (!d.startsWith('pets-')) return false;
  if (isCanonicalPetsD(d)) return false;
  return true;
}

// ─── Visual Trait Derivation ──────────────────────────────────────────────────

/**
 * Seed offset layout (per spec):
 * - [0..8]   base_color   (H/S/L split from 32-bit value)
 * - [8..16]  secondary_color hue shift / lightness offset from base
 * - [12..20] eye_color    (H/S/L split from 32-bit value; overlaps secondary)
 * - [16..24] pattern
 * - [24..32] special_mark
 * - [32..40] size
 * - [40..48] adult_type
 * - [48..56] archetype
 * - [56..64] special_ability
 */

/**
 * Read 8 hex chars from `seed` at `offset` and return the raw unsigned
 * 32-bit integer (0 .. 0xFFFFFFFF).
 *
 * Returns 0 for empty/unparseable slices so callers never see NaN.
 */
function readSeedUint32(seed: string, offset: number): number {
  const slice = seed.slice(offset, offset + 8);
  const value = parseInt(slice, 16);
  return Number.isNaN(value) ? 0 : value;
}

/**
 * Derive a bounded index from a seed at a specific offset.
 * Uses 4 bytes (8 hex chars) starting at offset, then maps to [0, max).
 *
 * Use this for selecting from small arrays (patterns, marks, sizes, forms).
 * For raw 32-bit entropy that will be decomposed further (e.g. into H/S/L
 * components via successive division), use readSeedUint32() directly.
 */
function deriveIndexFromSeed(seed: string, offset: number, max: number): number {
  return readSeedUint32(seed, offset) % max;
}

/**
 * Derive base color (hex) from seed using arbitrary HSL generation.
 *
 * Extracts a single 32-bit value from seed[0..8] and splits it into
 * three components via successive division:
 * - Hue:        0..359  (full color wheel)
 * - Saturation: 30..100 (vibrant, never dull gray)
 * - Lightness:  30..75  (safe range for the SVG gradient pipeline)
 *
 * The result is passed through clampBaseColor() via applyColorGuardrails()
 * at the call site, but the ranges here are already chosen to land within
 * the guardrail thresholds, so clamping is a safety net rather than a
 * regular adjustment.
 */
export function deriveBaseColorFromSeed(seed: string): string {
  const value = readSeedUint32(seed, 0);
  const h = value % 360;
  const rem1 = Math.floor(value / 360);
  const s = (rem1 % 71) + 30;  // 30..100
  const rem2 = Math.floor(rem1 / 71);
  const l = (rem2 % 46) + 30;  // 30..75
  return hslToHex(h, s, l);
}

/**
 * Derive secondary color (hex) from seed, harmonized with a base color.
 *
 * Instead of picking independently from a palette, the secondary is derived
 * as a lighter variant of the base with a small hue shift:
 * - Hue shift:       ±20° from base (subtle tonal variation)
 * - Lightness offset: +12..+25 above base (guaranteed visible gradient)
 *
 * This ensures the base/secondary pair always produces a good 3D body
 * gradient regardless of the base color.
 *
 * @param seed - The Pets seed (64-char hex)
 * @param baseHex - The already-resolved base color (after guardrails)
 */
export function deriveSecondaryColorFromSeed(seed: string, baseHex?: string): string {
  const seedValue = readSeedUint32(seed, 8);

  // Without a base color, fall back to independent HSL derivation
  // (same approach as base, but with a lighter range)
  if (!baseHex) {
    const h = seedValue % 360;
    const rem1 = Math.floor(seedValue / 360);
    const s = (rem1 % 71) + 30;
    const rem2 = Math.floor(rem1 / 71);
    const l = (rem2 % 31) + 60; // 60..90 (lighter range)
    return hslToHex(h, s, l);
  }

  // Harmonized derivation: shift from base
  const baseHsl = hexToHsl(baseHex);
  const hueShift = (seedValue % 41) - 20;  // -20..+20 degrees
  const rem1 = Math.floor(seedValue / 41);
  const lOffset = (rem1 % 14) + 12;        // +12..+25 lightness

  const secH = (baseHsl.h + hueShift + 360) % 360;
  const secS = baseHsl.s; // preserve base saturation for cohesion
  const secL = Math.min(baseHsl.l + lOffset, 90); // cap to avoid near-white

  return hslToHex(secH, secS, secL);
}

/**
 * Derive eye color (hex) from seed using arbitrary HSL generation.
 *
 * Eyes are generated in a darker, more saturated range than base colors
 * to ensure visibility against white sclera circles:
 * - Hue:        0..359  (full color wheel, independent of base)
 * - Saturation: 40..100 (vivid enough to read at small sizes)
 * - Lightness:  10..55  (always darker than typical bases)
 *
 * The result is further validated by ensureEyeVisibility() via
 * applyColorGuardrails() at the call site.
 */
export function deriveEyeColorFromSeed(seed: string): string {
  const value = readSeedUint32(seed, 12);
  const h = value % 360;
  const rem1 = Math.floor(value / 360);
  const s = (rem1 % 61) + 40;  // 40..100
  const rem2 = Math.floor(rem1 / 61);
  const l = (rem2 % 46) + 10;  // 10..55
  return hslToHex(h, s, l);
}

/**
 * Derive pattern from seed.
 */
export function derivePatternFromSeed(seed: string): PetsPattern {
  const index = deriveIndexFromSeed(seed, 16, PETS_PATTERNS.length);
  return PETS_PATTERNS[index];
}

/**
 * Derive special mark from seed.
 */
export function deriveSpecialMarkFromSeed(seed: string): PetsSpecialMark {
  const index = deriveIndexFromSeed(seed, 24, PETS_SPECIAL_MARKS.length);
  return PETS_SPECIAL_MARKS[index];
}

/**
 * Derive size from seed.
 */
export function deriveSizeFromSeed(seed: string): PetsSize {
  const index = deriveIndexFromSeed(seed, 32, PETS_SIZES.length);
  return PETS_SIZES[index];
}

/**
 * Derive Cypherpunk 2140 archetype from seed.
 */
export function deriveArchetypeFromSeed(seed: string): PetsArchetype {
  const index = deriveIndexFromSeed(seed, 48, PETS_ARCHETYPES.length);
  return PETS_ARCHETYPES[index];
}

/**
 * Derive Cypherpunk 2140 special ability from seed.
 */
export function deriveSpecialAbilityFromSeed(seed: string): PetsSpecialAbility {
  const index = deriveIndexFromSeed(seed, 56, PETS_SPECIAL_ABILITIES.length);
  return PETS_SPECIAL_ABILITIES[index];
}

// ─── Temporary Adult-Type Compatibility ───────────────────────────────────────
//
// TEMPORARY: Seed adjustment for existing adult Petses whose stored adult_type
// does not match the seed-derived adult_type. During the compatibility window,
// we mutate the seed so it produces the stored adult_type, then recompute the
// full visual identity from the adjusted seed.
//
// After the cutoff date this code becomes a no-op and can be removed entirely.
//
// Cutoff: 2026-05-01 00:00:00 UTC
//

/** UTC timestamp when the compatibility window closes. */
const ADULT_TYPE_COMPAT_CUTOFF = Date.UTC(2026, 4, 1) / 1000; // 2026-05-01 00:00:00 UTC

/**
 * Check whether the temporary adult-type compatibility window is still active.
 */
export function isAdultTypeCompatActive(): boolean {
  return Math.floor(Date.now() / 1000) < ADULT_TYPE_COMPAT_CUTOFF;
}

/**
 * Adjust a seed so that deriveAdultFormFromSeed(adjusted) === targetForm.
 *
 * Directly computes the seed bytes at offset [40..48] (the adult_type
 * region) that produce the target form index. All other seed regions
 * are left untouched, so colors [0..20] are preserved and non-color
 * traits are re-derived from the adjusted seed via deriveSeedIdentity().
 *
 * Returns the original seed unchanged if it already produces targetForm.
 */
export function adjustSeedForAdultType(seed: string, targetForm: AdultForm): string {
  // Fast path: already matches
  if (deriveAdultFormFromSeed(seed) === targetForm) return seed;

  const targetIndex = ADULT_FORMS.indexOf(targetForm);
  if (targetIndex < 0) return seed; // unknown form — leave seed unchanged

  const prefix = seed.slice(0, 40);
  const suffix = seed.slice(48);

  // Direct computation: deriveAdultFormFromSeed reads seed[40..48] as a
  // hex integer and takes `% ADULT_FORMS.length`. So any 8-hex-char value
  // whose parseInt % length === targetIndex works. The simplest is the
  // target index itself (always < ADULT_FORMS.length).
  const candidate = targetIndex.toString(16).padStart(8, '0');
  return prefix + candidate + suffix;
}

/**
 * Validate and normalize a pattern value from a tag.
 * Returns undefined if invalid, allowing fallback to seed derivation.
 */
function normalizePatternTag(value: string | undefined): PetsPattern | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase() as PetsPattern;
  return PETS_PATTERNS.includes(normalized) ? normalized : undefined;
}

/**
 * Validate and normalize a special mark value from a tag.
 * Returns undefined if invalid, allowing fallback to seed derivation.
 */
function normalizeSpecialMarkTag(value: string | undefined): PetsSpecialMark | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase() as PetsSpecialMark;
  return PETS_SPECIAL_MARKS.includes(normalized) ? normalized : undefined;
}

/**
 * Validate and normalize a size value from a tag.
 * Returns undefined if invalid, allowing fallback to seed derivation.
 */
function normalizeSizeTag(value: string | undefined): PetsSize | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase() as PetsSize;
  return PETS_SIZES.includes(normalized) ? normalized : undefined;
}

/**
 * Validate and normalize an archetype value from a tag.
 * Returns undefined if invalid, allowing fallback to seed derivation.
 */
function normalizeArchetypeTag(value: string | undefined): PetsArchetype | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase() as PetsArchetype;
  return PETS_ARCHETYPES.includes(normalized) ? normalized : undefined;
}

/**
 * Validate and normalize a special ability value from a tag.
 * Returns undefined if invalid, allowing fallback to seed derivation.
 */
function normalizeSpecialAbilityTag(value: string | undefined): PetsSpecialAbility | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase() as PetsSpecialAbility;
  return PETS_SPECIAL_ABILITIES.includes(normalized) ? normalized : undefined;
}

/**
 * Validate a hex color value.
 * Returns the value if valid hex, undefined otherwise.
 */
function normalizeHexColor(value: string | undefined): string | undefined {
  if (!value) return undefined;
  // Accept both #RGB and #RRGGBB formats
  if (/^#[0-9A-Fa-f]{3}$/.test(value) || /^#[0-9A-Fa-f]{6}$/.test(value)) {
    return value.toUpperCase();
  }
  return undefined;
}

/**
 * Derive all visual traits from seed, with legacy tag fallbacks.
 * 
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │ VISUAL TRAIT POLICY                                                         │
 * │                                                                              │
 * │ Color resolution priority:                                                  │
 * │ 1. Seed present → colors ALWAYS come from seed + guardrails                 │
 * │    (explicit color tags are ignored; they are mirrors, not overrides)        │
 * │ 2. No seed → explicit color tags used as-is (legacy fallback)               │
 * │ 3. Neither → safe defaults                                                  │
 * │                                                                              │
 * │ Non-color traits (pattern, special_mark, size):                             │
 * │ 1. Explicit valid tags take precedence                                      │
 * │ 2. Derive from seed if no tag present                                       │
 * │ 3. Safe defaults as final fallback                                          │
 * │                                                                              │
 * │ IMPORTANT: Legacy events may have explicit tags WITHOUT a seed.             │
 * │ These tags must be respected - do NOT discard them in favor of defaults.    │
 * └─────────────────────────────────────────────────────────────────────────────┘
 * 
 * This function is the SINGLE SOURCE OF TRUTH for visual trait resolution.
 * The UI should consume the output directly without additional logic.
 */
export function deriveVisualTraits(
  tags: string[][],
  seed: string | undefined
): PetsVisualTraits {
  const hasSeed = seed && seed.length === 64;
  
  // Seed is the canonical source of truth for the entire visual identity.
  // When present, all visual trait tags are mirrors — not consulted for rendering.
  if (hasSeed) {
    return deriveSeedIdentity(seed);
  }
  
  // No seed (legacy): use explicit tags with defaults as final fallback.
  const tagBaseColor = normalizeHexColor(getTagValue(tags, 'base_color'));
  const tagSecondaryColor = normalizeHexColor(getTagValue(tags, 'secondary_color'));
  const tagEyeColor = normalizeHexColor(getTagValue(tags, 'eye_color'));
  const tagPattern = normalizePatternTag(getTagValue(tags, 'pattern'));
  const tagSpecialMark = normalizeSpecialMarkTag(getTagValue(tags, 'special_mark'));
  const tagSize = normalizeSizeTag(getTagValue(tags, 'size'));
  const tagArchetype = normalizeArchetypeTag(getTagValue(tags, 'archetype'));
  const tagSpecialAbility = normalizeSpecialAbilityTag(getTagValue(tags, 'special_ability'));
  const resolvedBaseColor = tagBaseColor ?? DEFAULT_VISUAL_TRAITS.baseColor;
  return {
    baseColor: resolvedBaseColor,
    secondaryColor: tagSecondaryColor ?? resolvedBaseColor,
    eyeColor: tagEyeColor ?? DEFAULT_VISUAL_TRAITS.eyeColor,
    pattern: tagPattern ?? DEFAULT_VISUAL_TRAITS.pattern,
    specialMark: tagSpecialMark ?? DEFAULT_VISUAL_TRAITS.specialMark,
    size: tagSize ?? DEFAULT_VISUAL_TRAITS.size,
    archetype: tagArchetype ?? DEFAULT_VISUAL_TRAITS.archetype,
    specialAbility: tagSpecialAbility ?? DEFAULT_VISUAL_TRAITS.specialAbility,
  };
}

/**
 * Derive the full seed-determined visual identity.
 *
 * This is the single function that turns a 64-char hex seed into the
 * authoritative set of visual traits (colors + pattern + mark + size)
 * with color guardrails applied. All call sites that need seed-derived
 * visual traits should use this to guarantee consistency.
 */
export function deriveSeedIdentity(seed: string): PetsVisualTraits {
  const rawBase = deriveBaseColorFromSeed(seed);
  const rawEye = deriveEyeColorFromSeed(seed);
  const colors = applyColorGuardrails({
    baseColor: rawBase,
    secondaryColor: deriveSecondaryColorFromSeed(seed, rawBase),
    eyeColor: rawEye,
  });
  return {
    ...colors,
    pattern: derivePatternFromSeed(seed),
    specialMark: deriveSpecialMarkFromSeed(seed),
    size: deriveSizeFromSeed(seed),
    archetype: deriveArchetypeFromSeed(seed),
    specialAbility: deriveSpecialAbilityFromSeed(seed),
  };
}

// ─── Legacy Event Detection ───────────────────────────────────────────────────

/**
 * Check if a Pets event is a legacy event that needs migration.
 * 
 * A Pets is considered legacy if ANY of the following is true:
 * - the d tag is not in canonical format
 * - the seed tag is missing
 * - the name tag is missing and must be derived from d
 * - visual traits exist but seed does not
 * 
 * Canonical Pets events must always contain:
 * - canonical d
 * - seed
 * - name
 * - stage
 * - state
 * - stats
 * - ecosystem tag
 */
export function isLegacyPetsEvent(event: NostrEvent): boolean {
  const tags = event.tags;
  const d = getTagValue(tags, 'd');
  
  if (!d) return true;
  
  // Check if d-tag is not canonical
  if (!isCanonicalPetsD(d)) {
    return true;
  }
  
  // Check if seed is missing
  const seed = getTagValue(tags, 'seed');
  if (!seed || seed.length !== 64) {
    return true;
  }
  
  // Check if name tag is missing
  const name = getTagValue(tags, 'name');
  if (!name) {
    return true;
  }
  
  // Check if visual traits exist but seed does not
  // (This case is already covered by seed check above, but being explicit)
  const hasVisualTags = getTagValue(tags, 'base_color') !== undefined ||
                        getTagValue(tags, 'pattern') !== undefined ||
                        getTagValue(tags, 'special_mark') !== undefined ||
                        getTagValue(tags, 'size') !== undefined;
  
  if (hasVisualTags && !seed) {
    return true;
  }
  
  return false;
}

/**
 * Check if a parsed PetsCompanion needs migration.
 * This is a convenience wrapper around isLegacyPetsEvent.
 */
export function companionNeedsMigration(companion: PetsCompanion): boolean {
  return companion.isLegacy;
}

/**
 * Check whether an event's stored color tags differ from its seed-derived colors.
 *
 * Returns true when the event has a seed but its base_color, secondary_color,
 * or eye_color tags do not match the canonical seed-derived values. This means
 * the event should be republished so the persisted tags mirror the seed.
 *
 * Checks all seed-derived mirror tags: base_color, secondary_color,
 * eye_color, pattern, special_mark, size, and adult_type (for adults).
 *
 * Returns false when:
 * - no seed exists (legacy event; tags are authoritative)
 * - all mirror tags already match the seed-derived values
 */
export function eventNeedsSeedIdentitySync(tags: string[][]): boolean {
  const seed = getTagValue(tags, 'seed');
  if (!seed || seed.length !== 64) return false;

  const canonical = deriveSeedIdentity(seed);

  // Check color tags
  const storedBase = normalizeHexColor(getTagValue(tags, 'base_color'));
  const storedSec = normalizeHexColor(getTagValue(tags, 'secondary_color'));
  const storedEye = normalizeHexColor(getTagValue(tags, 'eye_color'));
  if (!storedBase || !storedSec || !storedEye) return true;
  if (storedBase !== canonical.baseColor ||
      storedSec !== canonical.secondaryColor ||
      storedEye !== canonical.eyeColor) return true;

  // Check non-color visual traits
  const storedPattern = getTagValue(tags, 'pattern');
  const storedMark = getTagValue(tags, 'special_mark');
  const storedSize = getTagValue(tags, 'size');
  if (storedPattern !== canonical.pattern ||
      storedMark !== canonical.specialMark ||
      storedSize !== canonical.size) return true;

  // Check adult_type (only for adult stage)
  const stage = getTagValue(tags, 'stage');
  if (stage === 'adult') {
    const storedAdultType = getTagValue(tags, 'adult_type');
    const canonicalAdultType = deriveAdultFormFromSeed(seed);
    if (storedAdultType !== canonicalAdultType) return true;
  }

  return false;
}

// ─── Event Validation ─────────────────────────────────────────────────────────

/**
 * Validate that an event has the required tags for a valid Pets state (Kind 31124).
 * Required: d, b (pets:ecosystem:v1), stage, state, last_interaction
 */
export function isValidPetsEvent(event: NostrEvent): boolean {
  if (event.kind !== KIND_PETS_STATE) return false;
  
  const d = getTagValue(event.tags, 'd');
  const b = getTagValue(event.tags, 'b');
  const stage = getTagValue(event.tags, 'stage');
  const state = getTagValue(event.tags, 'state');
  const lastInteraction = getTagValue(event.tags, 'last_interaction');
  
  if (!d) return false;
  if (b !== PETS_ECOSYSTEM_NAMESPACE) return false;
  if (!stage || !['egg', 'baby', 'adult'].includes(stage)) return false;
  // Accept both new states (active/sleeping/hibernating) and legacy states (incubating/evolving)
  // for backwards compatibility during migration
  if (!state || !['active', 'sleeping', 'hibernating', 'incubating', 'evolving'].includes(state)) return false;
  if (!lastInteraction) return false;
  
  return true;
}

/**
 * Validate that an event has the required tags for a valid Nostr pet profile.
 * Accepts both current kind (11125) and legacy kind (31125) for migration support.
 * Required: d, b (pets:ecosystem:v1)
 */
export function isValidNostrPetProfileEvent(event: NostrEvent): boolean {
  // Accept both current and legacy kinds
  if (event.kind !== KIND_NOSTR_PET_PROFILE && event.kind !== KIND_NOSTR_PET_PROFILE_LEGACY) {
    return false;
  }
  
  const d = getTagValue(event.tags, 'd');
  const b = getTagValue(event.tags, 'b');
  
  if (!d) return false;
  if (b !== PETS_ECOSYSTEM_NAMESPACE) return false;
  
  return true;
}

/**
 * Check if a Nostr pet profile event is using the legacy kind (31125).
 * Used to determine if migration is needed.
 */
export function isLegacyNostrPetProfileKind(event: NostrEvent): boolean {
  return event.kind === KIND_NOSTR_PET_PROFILE_LEGACY;
}

// ─── Event Parsing ────────────────────────────────────────────────────────────

/**
 * Derive a display name from a legacy d-tag.
 * Legacy format: pets-{name} (e.g., "pets-puck" → "Puck")
 * 
 * @param d - The d-tag value
 * @returns The derived name with first letter capitalized, or "Unnamed NOSTR PET" if not derivable
 */
/**
 * Capitalize each word in a string.
 * @example "mr cool" -> "Mr Cool"
 */
function capitalizeWords(str: string): string {
  return str
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Derive a display name from a legacy d-tag.
 * 
 * Transformation rules:
 * 1. Remove "pets-" prefix
 * 2. Replace "-" and "_" with spaces
 * 3. Trim whitespace
 * 4. Capitalize words in a human-friendly way
 * 5. Fallback to "Unnamed NOSTR PET" if result is empty
 * 
 * @example "pets-puck" -> "Puck"
 * @example "pets-mr-cool" -> "Mr Cool"
 * @example "pets_blue" -> "Blue"
 * @example "pets-" -> "Unnamed NOSTR PET"
 */
export function deriveNameFromLegacyD(d: string): string {
  if (!d.startsWith('pets-')) {
    return 'Unnamed NOSTR PET';
  }
  
  // Remove prefix and normalize separators
  const rawName = d
    .replace('pets-', '')
    .replace(/[-_]/g, ' ')
    .trim();
  
  // If nothing meaningful remains, return fallback
  if (!rawName || rawName.length === 0) {
    return 'Unnamed NOSTR PET';
  }
  
  // Capitalize words for human-friendly display
  return capitalizeWords(rawName);
}

/**
 * Parse a Kind 31124 Pets Current State event into a structured object.
 * Returns undefined if the event is invalid.
 * 
 * This function is the SINGLE SOURCE OF TRUTH for resolving:
 * - name (from tag or legacy d-tag derivation)
 * - seed
 * - visualTraits (derived from seed, with legacy tag fallbacks)
 * - isLegacy flag
 * 
 * The UI should NOT need to guess names or traits - everything is resolved here.
 * 
 * Name resolution priority:
 * 1. Use `name` tag if present
 * 2. Derive from legacy d-tag format (pets-{name})
 * 3. Fall back to "Unnamed NOSTR PET"
 * 
 * Visual trait priority:
 * 1. Use explicit visual tags if valid (legacy compatibility)
 * 2. Derive deterministically from seed
 * 3. Use safe defaults if seed is missing
 */
export function parsePetsEvent(event: NostrEvent): PetsCompanion | undefined {
  if (!isValidPetsEvent(event)) return undefined;
  
  const tags = event.tags;
  const d = getTagValue(tags, 'd')!;
  const nameTag = getTagValue(tags, 'name');
  const stage = getTagValue(tags, 'stage') as PetsStage;
  const rawState = getTagValue(tags, 'state')!;
  const seed = getTagValue(tags, 'seed');
  
  // ─── Progression state resolution (migration-aware) ───
  // New model: progression lives in progression_state tag.
  // Old model: progression lived in the state tag ('incubating', 'evolving').
  // On read we normalise both into the new model.
  const progressionStateTag = getTagValue(tags, 'progression_state') as PetsProgressionState | undefined;
  
  let state: PetsState;
  let progressionState: PetsProgressionState;
  
  if (progressionStateTag) {
    // New-format event: progression_state tag is authoritative
    state = rawState as PetsState;
    progressionState = progressionStateTag;
  } else if (rawState === 'incubating' || rawState === 'evolving') {
    // Legacy event: progression was stored in state tag.
    // Normalise: move it to progressionState, set activity state to 'active'.
    state = 'active';
    progressionState = rawState as PetsProgressionState;
  } else {
    // No progression
    state = rawState as PetsState;
    progressionState = 'none';
  }
  
  // Resolve name: tag > legacy d-tag derivation > fallback
  const name = nameTag ?? deriveNameFromLegacyD(d);
  
  // ─── TEMPORARY: Adult-type compatibility seed adjustment ───
  // During the compatibility window, if an existing adult has an explicit
  // adult_type tag that doesn't match the seed-derived form, adjust the
  // seed so it produces that form. This prevents existing adults from
  // suddenly changing form. After the cutoff this block is a no-op.
  let effectiveSeed = seed;
  if (
    seed && seed.length === 64 &&
    stage === 'adult' &&
    isAdultTypeCompatActive()
  ) {
    const storedAdultType = getTagValue(tags, 'adult_type');
    if (storedAdultType && ADULT_FORMS.includes(storedAdultType as AdultForm)) {
      const seedDerivedForm = deriveAdultFormFromSeed(seed);
      if (storedAdultType !== seedDerivedForm) {
        effectiveSeed = adjustSeedForAdultType(seed, storedAdultType as AdultForm);
      }
    }
  }
  
  // Derive visual traits (single source of truth)
  const visualTraits = deriveVisualTraits(tags, effectiveSeed);
  
  // Check if this is a legacy event that needs migration
  const isLegacy = isLegacyPetsEvent(event);
  
  // Check if stored mirror tags need syncing with seed-derived values
  // Uses the effective seed (which may be adjusted during compat window)
  const needsSeedIdentitySync = eventNeedsSeedIdentitySync(
    effectiveSeed !== seed
      ? tags.map((t) => t[0] === 'seed' ? ['seed', effectiveSeed!] : t)
      : tags,
  );
  
  if (import.meta.env.DEV) {
    console.log('[Pets]', {
      d: d.length > 30 ? `${d.slice(0, 20)}...` : d,
      name,
      isLegacy,
      needsSeedIdentitySync,
      hasSeed: !!seed,
      traits: `${visualTraits.baseColor} ${visualTraits.pattern} ${visualTraits.size}`,
    });
  }
  
  // Parse task progress tags: ["task", "name:value"]
  const tasks: PetsTaskProgress[] = [];
  for (const tag of tags) {
    if (tag[0] === 'task' && tag[1]) {
      const [taskName, taskValue] = tag[1].split(':');
      if (taskName && taskValue) {
        tasks.push({ name: taskName, value: parseInt(taskValue, 10) || 0 });
      }
    }
  }
  
  // Parse completed task tags: ["task_completed", "name"]
  const tasksCompleted: string[] = [];
  for (const tag of tags) {
    if (tag[0] === 'task_completed' && tag[1]) {
      tasksCompleted.push(tag[1]);
    }
  }
  
  // Parse evolution missions from 31124 content JSON (per-Pets)
  const evolution = parseEvolutionContent(event.content);

  return {
    event,
    d,
    name,
    stage,
    state,
    progressionState,
    seed: effectiveSeed,
    visualTraits,
    isLegacy,
    needsSeedIdentitySync,
    lastInteraction: parseNumericTag(tags, 'last_interaction')!,
    lastDecayAt: parseNumericTag(tags, 'last_decay_at'),
    stats: {
      hunger: parseNumericTag(tags, 'hunger'),
      happiness: parseNumericTag(tags, 'happiness'),
      health: parseNumericTag(tags, 'health'),
      hygiene: parseNumericTag(tags, 'hygiene'),
      energy: parseNumericTag(tags, 'energy'),
    },
    generation: parseNumericTag(tags, 'generation'),
    breedingReady: parseBooleanTag(tags, 'breeding_ready', false),
    socialOpen: getTagValue(tags, 'social') === 'open',
    careStreak: parseNumericTag(tags, 'care_streak'),
    careStreakLastAt: parseNumericTag(tags, 'care_streak_last_at'),
    careStreakLastDay: getTagValue(tags, 'care_streak_last_day'),
    incubationTime: parseNumericTag(tags, 'incubation_time'),
    startIncubation: parseNumericTag(tags, 'start_incubation'),
    adultType: stage === 'adult' && effectiveSeed && effectiveSeed.length === 64
      ? deriveAdultFormFromSeed(effectiveSeed)
      : getTagValue(tags, 'adult_type'),
    breedCategory: (() => {
      const raw = getTagValue(tags, 'breed_category');
      return BREED_CATEGORIES.some((c) => c.id === raw)
        ? (raw as PetsBreedCategory)
        : undefined;
    })(),
    breedAsset: getTagValue(tags, 'breed_asset') ?? undefined,
    baoRarity: (() => {
      const raw = getTagValue(tags, 'bao_rarity');
      if (raw && ['common', 'uncommon', 'rare', 'epic', 'legendary'].includes(raw)) {
        return raw as BaoRarity;
      }
      const asset = getTagValue(tags, 'breed_asset');
      return getBaoRarityFromAsset(asset);
    })(),
    parentA: getTagValue(tags, 'parent_a') ?? undefined,
    parentB: getTagValue(tags, 'parent_b') ?? undefined,
    breedingCooldown: parseNumericTag(tags, 'breeding_cooldown'),
    stateStartedAt: parseNumericTag(tags, 'state_started_at'),
    progressionStartedAt: parseNumericTag(tags, 'progression_started_at') ?? parseNumericTag(tags, 'state_started_at'),
    tasks,
    tasksCompleted,
    evolution,
    asset3d: stage === 'adult' ? parseAsset3DTag(tags) ?? undefined : undefined,
    customFormId: (() => {
      const explicit = getTagValue(tags, 'custom_form');
      if (explicit) return explicit;
      const category = getTagValue(tags, 'breed_category');
      const asset = getTagValue(tags, 'breed_asset');
      if (category === 'custom' && asset) return asset;
      return undefined;
    })(),
    fiatBalance: parseNumericTag(tags, 'fiat_balance') ?? (stage === 'egg' ? 2_140 : 0),
    eggScale: parseNumericTag(tags, 'egg_scale') ?? 1,
    allTags: tags,
  };
}

/**
 * Parse a Kind 11125 Nostr Pet Profile event into a structured object.
 * Also supports legacy kind 31125 profiles for migration purposes.
 * Returns undefined if the event is invalid.
 * 
 * Note: pettingLevel is parsed from both 'pettingLevel' and 'petting_level' tags
 * for backwards compatibility with legacy profiles.
 */
export function parseNostrPetProfileEvent(event: NostrEvent): NostrPetProfile | undefined {
  if (!isValidNostrPetProfileEvent(event)) return undefined;

  const tags = event.tags;
  const d = getTagValue(tags, 'd')!;

  // Parse pettingLevel from either camelCase or snake_case tag
  const pettingLevelValue = parseNumericTag(tags, 'pettingLevel')
    ?? parseNumericTag(tags, 'petting_level')
    ?? 0;

  return {
    event,
    d,
    currentCompanion: getTagValue(tags, 'current_companion'),
    onboardingDone: parseBooleanTag(tags, 'pets_onboarding_done', false)
      || parseBooleanTag(tags, 'onboarding_done', false),
    name: getTagValue(tags, 'name'),
    has: getTagValues(tags, 'has'),
    coins: parseNumericTag(tags, 'coins') ?? 0,
    pettingLevel: pettingLevelValue,
    dailyRewardsClaimedAt: getTagValue(tags, 'daily_rewards_claimed_at') ?? undefined,
    dailyLoginLastDay: getTagValue(tags, 'daily_login_last_day') ?? undefined,
    dailyLoginStreak: parseNumericTag(tags, 'daily_login_streak') ?? 0,
    baoLifetimeVolume: parseNumericTag(tags, 'bao_lifetime_volume') ?? 0,
    baoTier: parseNumericTag(tags, 'bao_tier') ?? 0,
    baoRewardsClaimedAt: getTagValue(tags, 'bao_rewards_claimed_at') ?? undefined,
    baoTradeStreak: parseNumericTag(tags, 'bao_trade_streak') ?? 0,
    baoTradeStreakLastDay: getTagValue(tags, 'bao_trade_streak_last_day') ?? undefined,
    sats: parseNumericTag(tags, 'sats') ?? 0,
    room: getTagValue(tags, 'room') ?? undefined,
    walletMode: parseWalletModeTag(tags),
    cashuMintUrl: getTagValue(tags, 'cashu_mint_url') ?? undefined,
    storage: parseStorageTags(tags),
    content: event.content,
    allTags: tags,
  };
}

// ─── Tag Building Utilities ───────────────────────────────────────────────────

/**
 * Build tags for a new Nostr Pet Profile (Kind 11125).
 * Includes pettingLevel: 0 by default.
 */

export function parseWalletModeTag(tags: string[][]): 'bao' | 'cashu' {
  const value = getTagValue(tags, 'wallet_mode');
  // 'cashu' selects the real-sats Cashu/NIP-60 wallet. Legacy 'btc-sats' and
  // gated 'real' values also map to the real wallet.
  if (value === 'cashu' || value === 'btc-sats' || value === 'real') {
    return 'cashu';
  }
  // 'bao', legacy 'demo-sats', and missing tags all select the BAO signet/demo
  // wallet, so demo play never touches real money.
  return 'bao';
}

export function buildNostrPetProfileTags(pubkey: string): string[][] {
  return [
    ['d', getCanonicalNostrPetProfileD(pubkey)],
    ['b', PETS_ECOSYSTEM_NAMESPACE],
    ['pets_onboarding_done', 'false'],
    ['pettingLevel', '0'],
    // New Nostr pets start with 2,140 fiat coins for mini-games.
    ['coins', '2140'],
    // New profiles default to the BAO signet/demo Cashu rail so the pet
    // economy shares the same wallet as bao.markets.
    ['wallet_mode', 'bao'],
    // Starter inventory so new owners can feed their pet immediately.
    ['storage', 'food_apple:1'],
  ];
}

/**
 * Build tags for a new Pets egg (Kind 31124).
 * Includes required and recommended tags for a new egg.
 * 
 * Visual traits are derived from the seed and explicitly stored
 * to ensure consistent rendering across clients.
 */
export function buildEggTags(
  pubkey: string,
  petId: string,
  createdAt: number,
  name = 'Egg',
  options?: {
    breedCategory?: PetsBreedCategory;
    breedAsset?: string;
  },
): string[][] {
  const d = getCanonicalPetsD(pubkey, petId);
  const seed = derivePetsSeedV1(pubkey, d, createdAt);
  const now = createdAt.toString();

  // Derive visual traits from seed for explicit storage (tags mirror the seed).
  const { baseColor, secondaryColor, eyeColor, pattern, specialMark, size, archetype, specialAbility } = deriveSeedIdentity(seed);

  const tags: string[][] = [
    ['d', d],
    ['b', PETS_ECOSYSTEM_NAMESPACE],
    ['name', name],
    ['stage', 'egg'],
    ['state', 'active'],
    ['progression_state', 'none'],
    ['seed', seed],
    ['generation', '1'],
    ['breeding_ready', 'false'],
    ['care_streak', '1'],
    ['care_streak_last_at', now],
    ['care_streak_last_day', getLocalDayString()],
    ['hunger', DEFAULT_EGG_STATS.hunger.toString()],
    ['happiness', DEFAULT_EGG_STATS.happiness.toString()],
    ['health', DEFAULT_EGG_STATS.health.toString()],
    ['hygiene', DEFAULT_EGG_STATS.hygiene.toString()],
    ['energy', DEFAULT_EGG_STATS.energy.toString()],
    ['last_interaction', now],
    ['last_decay_at', now],
    // Pet-bound fiat balance: every egg starts with 2140 sats of in-game money.
    ['fiat_balance', '2140'],
    // Egg visual scale multiplier (DEV editor)
    ['egg_scale', '1'],
    // Visual traits (derived from seed, explicitly stored for consistency)
    ['base_color', baseColor],
    ['secondary_color', secondaryColor],
    ['eye_color', eyeColor],
    ['pattern', pattern],
    ['special_mark', specialMark],
    ['size', size],
    ['archetype', archetype],
    ['special_ability', specialAbility],
  ];

  if (options?.breedCategory) {
    tags.push(['breed_category', options.breedCategory]);
  }
  if (options?.breedAsset) {
    tags.push(['breed_asset', options.breedAsset]);
  }

  return tags;
}

// ─── Managed Tag Sets (Separated by Kind) ─────────────────────────────────────

/**
 * Tags managed by the client for Kind 31124 (Pets State).
 * These tags are controlled by the application and may be overwritten.
 * 
 * @see pets-tag-schema.ts for the complete canonical schema documentation
 */
export const MANAGED_PETS_STATE_TAG_NAMES = new Set([
  // System / metadata tags
  'd', 'b',
  // Core identity tags
  'name', 'seed', 'generation',
  // Lifecycle state tags
  'stage', 'state', 'last_interaction', 'last_decay_at',
  // Stat tags
  'hunger', 'happiness', 'health', 'hygiene', 'energy',
  // Visual trait tags (derived from seed, stored for fast rendering)
  'base_color', 'secondary_color', 'eye_color', 'pattern', 'special_mark', 'size',
  // Identity/personality tags (MUST persist across stage transitions)
  'personality', 'trait', 'favorite_food', 'voice_type', 'mood',
  // Care-streak tags
  'care_streak', 'care_streak_last_at', 'care_streak_last_day',
  // Social/flag tags
  'social', 'breeding_ready',
  // Progression tags (orthogonal to activity state)
  'progression_state', 'progression_started_at',
  // Task system tags (removed after stage transitions)
  'state_started_at', 'task', 'task_completed',
  // Evolution tags (adult only)
  'adult_type',
  // Extension tags (for themes/crossovers)
  'theme', 'crossover_app', 'asset_3d',
  // Cypherpunk 2140 theme extension tags
  'archetype', 'special_ability',
  // Phase B: breed category + breeding tags
  'breed_category', 'breed_asset', 'bao_rarity',
  'parent_a', 'parent_b', 'breeding_cooldown',
  // Phase C: custom species + pet-bound economy
  'custom_form', 'fiat_balance', 'egg_scale',
]);

/**
 * Visual trait tags that are part of the canonical Pets format.
 * These tags ensure deterministic visual rendering across clients.
 * 
 * Note: While seed is the ultimate source of truth for visual generation,
 * these tags are explicitly stored for compatibility and faster rendering.
 */
export const VISUAL_TRAIT_TAG_NAMES = [
  'base_color',
  'secondary_color',
  'eye_color',
  'pattern',
  'special_mark',
  'size',
  'archetype',
  'special_ability',
] as const;

/**
 * Deprecated tags that should be removed when republishing events.
 * These tags were part of earlier designs but are no longer used.
 * 
 * - t: Topic tag (pets) - no longer needed, the app adds the client tag automatically
 * - client: Client tag - no longer needed, the app adds this automatically via useNostrPublish
 * - shell_integrity: Eggs now use the standard health stat instead
 * - egg_temperature: Eggs now rely on warmth prop fallback; not part of active stat model
 * - incubation_progress: Obsolete task progress field
 * - egg_status: Obsolete status field
 * - fees: Obsolete fee tracking field
 * - incubation_time: Obsolete; task system uses progression_started_at instead
 * - start_incubation: Obsolete; replaced by progression_started_at
 * - interact_6_progress: Legacy interaction tracking; replaced by ["task", "interactions:N"]
 * - experience: Deprecated; old per-Pets XP, no longer awarded
 */
export const DEPRECATED_PETS_TAG_NAMES = new Set([
  't',
  'client',
  'shell_integrity',
  'egg_temperature',
  'incubation_progress',
  'egg_status',
  'fees',
  'incubation_time',
  'start_incubation',
  'interact_6_progress',
  'experience',
]);

/**
 * Tags managed by the client for Kind 11125 (Nostr Pet Profile).
 * These tags are controlled by the application and may be overwritten.
 */
export const MANAGED_NOSTR_PET_PROFILE_TAG_NAMES = new Set([
  'd', 'b', 'name', 'current_companion', 'pets_onboarding_done', 'onboarding_done', 'has', 'storage', 'sats',
  // Daily reward tags
  'daily_rewards_claimed_at', 'daily_login_last_day', 'daily_login_streak',
  // BAO trading reward tags
  'bao_lifetime_volume', 'bao_tier', 'bao_rewards_claimed_at',
  // Room persistence
  'room',
  // Cashu wallet mode
  'wallet_mode', 'cashu_mint_url',
  // Battle reward daily cap
  'battle_rewards_claimed_at',
  // Legacy player progress tags (preserved for compatibility)
  'coins', 'petting_level', 'pettingLevel', 'lifetime_petss', 'lifetimePetss',
  'starter_pets', 'starterPets', 'favorite_pets', 'favoritePets',
]);

/**
 * Deprecated tags for Kind 11125 (Nostr Pet Profile).
 * These are stripped when republishing so old profiles migrate cleanly.
 */
export const DEPRECATED_NOSTR_PET_TAG_NAMES = new Set([
  'xp', // Old player lifetime XP; economy is sats-only now
  'level', // Derived from old xp; no longer used
]);

/**
 * Combined set for backwards compatibility.
 * @deprecated Use kind-specific sets instead
 */
const MANAGED_TAG_NAMES = new Set([
  ...MANAGED_PETS_STATE_TAG_NAMES,
  ...MANAGED_NOSTR_PET_PROFILE_TAG_NAMES,
]);

/**
 * Merge tags for republishing, preserving unknown tags from the original event.
 * @param existingTags - Tags from the original event
 * @param newTags - New tags to apply (will override existing by tag name)
 * @returns Merged tags array
 */
export function mergeTagsForRepublish(
  existingTags: string[][],
  newTags: string[][]
): string[][] {
  // Create a map of new tags by their first element (tag name)
  const newTagsMap = new Map<string, string[][]>();
  for (const tag of newTags) {
    const name = tag[0];
    if (!newTagsMap.has(name)) {
      newTagsMap.set(name, []);
    }
    newTagsMap.get(name)!.push(tag);
  }
  
  // Start with existing unknown tags (tags we don't manage and that aren't deprecated)
  const unknownTags = existingTags.filter(tag => 
    !MANAGED_TAG_NAMES.has(tag[0]) && !DEPRECATED_PETS_TAG_NAMES.has(tag[0])
  );
  
  // Collect all new tags in order
  const result: string[][] = [];
  
  // Add new tags first
  for (const tags of newTagsMap.values()) {
    result.push(...tags);
  }
  
  // Preserve unknown tags
  result.push(...unknownTags);
  
  return result;
}

/**
 * Overwrite mirror tags so they match the seed-derived canonical identity.
 *
 * When a seed tag is present, replaces all seed-derived mirror tags with
 * the canonical values from deriveSeedIdentity(). For adult-stage events,
 * also syncs adult_type. If no seed is found the tags are returned unchanged.
 *
 * This is called inside mergePetsStateTagsForRepublish so that every
 * republish automatically backfills correct mirror tags.
 */
function syncMirrorTagsToSeed(tags: string[][]): string[][] {
  const seed = getTagValue(tags, 'seed');
  if (!seed || seed.length !== 64) return tags;

  const canonical = deriveSeedIdentity(seed);
  const MIRROR_TAG_NAMES = new Set([
    'base_color', 'secondary_color', 'eye_color',
    'pattern', 'special_mark', 'size',
    'archetype', 'special_ability',
  ]);

  const stage = getTagValue(tags, 'stage');
  if (stage === 'adult') {
    MIRROR_TAG_NAMES.add('adult_type');
  }

  // Remove existing mirror tags
  const filtered = tags.filter((t) => !MIRROR_TAG_NAMES.has(t[0]));

  // Append canonical values
  filtered.push(
    ['base_color', canonical.baseColor],
    ['secondary_color', canonical.secondaryColor],
    ['eye_color', canonical.eyeColor],
    ['pattern', canonical.pattern],
    ['special_mark', canonical.specialMark],
    ['size', canonical.size],
    ['archetype', canonical.archetype],
    ['special_ability', canonical.specialAbility],
  );

  if (stage === 'adult') {
    filtered.push(['adult_type', deriveAdultFormFromSeed(seed)]);
  }

  return filtered;
}

/**
 * Build the stat + timestamp tag updates for a Pets state publish.
 * Serializes all 5 stats to strings and sets both decay/interaction timestamps.
 */
export function statsToTagUpdates(stats: PetsStats, now: number): Record<string, string> {
  const nowStr = now.toString();
  return {
    hunger: stats.hunger.toString(),
    happiness: stats.happiness.toString(),
    health: stats.health.toString(),
    hygiene: stats.hygiene.toString(),
    energy: stats.energy.toString(),
    last_decay_at: nowStr,
    last_interaction: nowStr,
  };
}

/**
 * Update specific tags in a Pets event while preserving unknown tags.
 * Uses MANAGED_PETS_STATE_TAG_NAMES for Kind 31124.
 */
export function updatePetsTags(
  existingTags: string[][],
  updates: Record<string, string | string[]>
): string[][] {
  return mergePetsStateTagsForRepublish(existingTags, updates);
}

/**
 * Merge tags for republishing a Kind 31124 Pets State event.
 * Preserves unknown tags, applies updates to managed tags, and validates the result.
 * 
 * This function automatically:
 * - Preserves existing managed tags that aren't being updated
 * - Applies updates
 * - Preserves unknown tags (for forward compatibility)
 * - Filters out deprecated tags
 * - Validates and repairs the final tag set
 * 
 * @param existingTags - Current tags from the event
 * @param updates - Tags to update (will override existing by tag name)
 * @param options - Optional configuration
 * @returns Validated and repaired tag array
 */
export function mergePetsStateTagsForRepublish(
  existingTags: string[][],
  updates: Record<string, string | string[]>,
  options?: {
    /** If true, skips validation (use with caution) */
    skipValidation?: boolean;
  }
): string[][] {
  const newTags: string[][] = [];
  const updateKeys = new Set(Object.keys(updates));
  
  // Preserve existing managed tags that aren't being updated
  for (const tag of existingTags) {
    const name = tag[0];
    if (MANAGED_PETS_STATE_TAG_NAMES.has(name) && !updateKeys.has(name)) {
      newTags.push(tag);
    }
  }
  
  // Add updates
  for (const [name, value] of Object.entries(updates)) {
    if (Array.isArray(value)) {
      for (const v of value) {
        newTags.push([name, v]);
      }
    } else {
      newTags.push([name, value]);
    }
  }
  
  // Preserve unknown tags (tags not managed by us), excluding deprecated tags
  const unknownTags = existingTags.filter(tag => 
    !MANAGED_PETS_STATE_TAG_NAMES.has(tag[0]) && 
    !DEPRECATED_PETS_TAG_NAMES.has(tag[0])
  );
  
  let mergedTags = [...newTags, ...unknownTags];
  
  // ─── Sync mirror tags to seed-derived values ───
  // When a seed exists, visual trait tags are mirrors of the seed. Overwrite
  // any stale values so persisted tags always match the canonical derivation.
  mergedTags = syncMirrorTagsToSeed(mergedTags);
  
  // Skip validation if requested (for internal use)
  if (options?.skipValidation) {
    return mergedTags;
  }
  
  // Validate and repair the final tag set
  // Use existingTags as the recovery source for missing required tags
  const result = validateAndRepairPetsTags(mergedTags, existingTags);
  
  // Log repairs in development
  if (import.meta.env.DEV && result.repaired) {
    console.log('[Pets] Tag repairs applied:', result.repairs);
  }
  
  // Log errors (these are non-fatal but should be monitored)
  if (result.errors.length > 0) {
    console.warn('[Pets] Tag validation errors:', result.errors);
  }
  
  return result.tags;
}

/**
 * Merge tags for republishing a Kind 11125 Nostr Pet Profile event.
 * Preserves unknown tags, applies updates, and deduplicates repeated tags like 'has'.
 */
export function mergeNostrPetProfileTagsForRepublish(
  existingTags: string[][],
  updates: Record<string, string | string[]>
): string[][] {
  const newTags: string[][] = [];
  const updateKeys = new Set(Object.keys(updates));
  
  // Preserve existing managed tags that aren't being updated
  for (const tag of existingTags) {
    const name = tag[0];
    if (MANAGED_NOSTR_PET_PROFILE_TAG_NAMES.has(name) && !updateKeys.has(name)) {
      newTags.push(tag);
    }
  }
  
  // Add updates
  for (const [name, value] of Object.entries(updates)) {
    if (Array.isArray(value)) {
      for (const v of value) {
        newTags.push([name, v]);
      }
    } else {
      newTags.push([name, value]);
    }
  }
  
  // Preserve unknown tags (tags not managed by us), excluding deprecated tags
  const unknownTags = existingTags.filter(
    tag => !MANAGED_NOSTR_PET_PROFILE_TAG_NAMES.has(tag[0]) && !DEPRECATED_NOSTR_PET_TAG_NAMES.has(tag[0])
  );
  
  // Deduplicate 'has' tags
  return deduplicateHasTags([...newTags, ...unknownTags]);
}

/**
 * Deduplicate 'has' tags in a tag array.
 * Ensures each pet reference appears only once.
 */
export function deduplicateHasTags(tags: string[][]): string[][] {
  const seenHas = new Set<string>();
  const result: string[][] = [];
  
  for (const tag of tags) {
    if (tag[0] === 'has') {
      const value = tag[1];
      if (value && !seenHas.has(value)) {
        seenHas.add(value);
        result.push(tag);
      }
    } else {
      result.push(tag);
    }
  }
  
  return result;
}

/**
 * Update Nostr pet profile tags with proper deduplication.
 * Use this when updating Kind 11125 events.
 */
export function updateNostrPetProfileTags(
  existingTags: string[][],
  updates: Record<string, string | string[]>
): string[][] {
  return mergeNostrPetProfileTagsForRepublish(existingTags, updates);
}

// ─── Profile Normalization ────────────────────────────────────────────────────

/**
 * Check if a Nostr pet profile is missing the pettingLevel tag.
 * This helps determine if normalization is needed.
 */
export function profileNeedsPettingLevelNormalization(profile: NostrPetProfile): boolean {
  // Check if either pettingLevel or petting_level tag exists in allTags
  const hasPettingLevelTag = profile.allTags.some(
    ([name]) => name === 'pettingLevel' || name === 'petting_level'
  );
  return !hasPettingLevelTag;
}

/**
 * Check if a profile uses the legacy `onboarding_done` tag instead of the
 * new `pets_onboarding_done` tag. Returns true if migration is needed.
 */
export function profileNeedsOnboardingTagMigration(profile: NostrPetProfile): boolean {
  const hasNewTag = profile.allTags.some(([name]) => name === 'pets_onboarding_done');
  const hasOldTag = profile.allTags.some(([name]) => name === 'onboarding_done');
  // Needs migration if: has old tag but not the new one
  return !hasNewTag && hasOldTag;
}

/**
 * Build updated tags for normalizing a profile.
 * Handles:
 * - Adding pettingLevel: 0 if missing
 * - Migrating onboarding_done → pets_onboarding_done
 *
 * Preserves all existing tags except the ones being migrated.
 */
export function buildNormalizedProfileTags(profile: NostrPetProfile): string[][] {
  let tags = profile.allTags;
  let changed = false;

  // Normalize pettingLevel
  if (profileNeedsPettingLevelNormalization(profile)) {
    tags = updateNostrPetProfileTags(tags, { pettingLevel: '0' });
    changed = true;
  }

  // Migrate onboarding_done → pets_onboarding_done
  if (profileNeedsOnboardingTagMigration(profile)) {
    const oldValue = tags.find(([name]) => name === 'onboarding_done')?.[1] ?? 'false';
    // Remove old tag, add new tag
    tags = tags.filter(([name]) => name !== 'onboarding_done');
    tags = updateNostrPetProfileTags(tags, { pets_onboarding_done: oldValue });
    changed = true;
  }

  return changed ? tags : profile.allTags;
}

// ─── Query Helpers ────────────────────────────────────────────────────────────

/**
 * Get all possible d-tag values to query for a Nostr pet profile.
 * Includes canonical and legacy formats for migration support.
 */
export function getNostrPetProfileQueryDValues(pubkey: string): string[] {
  const prefix12 = getPubkeyPrefix12(pubkey);
  const prefix8 = pubkey.slice(0, 8).toLowerCase();
  
  return [
    // Canonical
    `blobbonaut-${prefix12}`,
    // Legacy: capitalized
    `Blobbonaut-${prefix12}`,
    `Blobbonaut-${prefix8}`,
    // Legacy: generic
    'blobbonaut-profile',
    // Legacy: shorter prefixes
    `blobbonaut-${prefix8}`,
  ];
}

// ─── Legacy Migration Helpers ─────────────────────────────────────────────────

/**
 * Build tags for migrating a legacy Pets pet to canonical format.
 * 
 * Migration preserves:
 * - seed (existing or derived once)
 * - name (tag > legacy d-tag derived > fallback)
 * - core state tags (stage, state, stats, etc.)
 * - legacy visual tags (explicitly preserved for backwards compatibility)
 * - unknown tags (for forward compatibility)
 * 
 * @param legacyEvent - The original legacy event
 * @param newPetId - The new 10-char hex petId for canonical format
 * @param pubkey - The owner's pubkey
 * @returns Tags for the new canonical event
 */
export function buildMigrationTags(
  legacyEvent: NostrEvent,
  newPetId: string,
  pubkey: string
): string[][] {
  const canonicalD = getCanonicalPetsD(pubkey, newPetId);
  const legacyTags = legacyEvent.tags;
  
  // Get or derive seed - use legacy event's created_at for consistency
  // IMPORTANT: If seed exists and is valid, preserve it. Only derive if missing.
  const existingSeed = getTagValue(legacyTags, 'seed');
  const seed = existingSeed && existingSeed.length === 64
    ? existingSeed
    : derivePetsSeedV1(pubkey, canonicalD, legacyEvent.created_at);
  
  const now = Math.floor(Date.now() / 1000).toString();
  
  // Start with required tags
  const legacyD = getTagValue(legacyTags, 'd');
  const newTags: string[][] = [
    ['d', canonicalD],
    ['b', PETS_ECOSYSTEM_NAMESPACE],
    ['seed', seed],
  ];
  
  // Store a back-reference to the legacy d-tag for future equivalence lookups.
  // This is additive — current dedup logic uses name-based matching, but future
  // versions can use this tag for stronger deterministic equivalence.
  if (legacyD) {
    newTags.push(['migrated_from', legacyD]);
  }
  
  // Preserve name with priority: name tag > legacy d-tag derived > fallback
  const nameTag = getTagValue(legacyTags, 'name');
  const resolvedName = nameTag ?? (legacyD ? deriveNameFromLegacyD(legacyD) : 'Unnamed NOSTR PET');
  newTags.push(['name', resolvedName]);
  
  // Preserve all persistent tags from the legacy event
  // This includes: state, stats, progression, social, personality, evolution, and extension tags
  // Per pets-tag-schema.md: Do NOT invent values for tags that don't exist
  const persistentTagNames = [
    // State/lifecycle tags
    'stage',
    // Stat tags
    'hunger', 'happiness', 'health', 'hygiene', 'energy',
    // Care-streak tags
    'care_streak', 'care_streak_last_at', 'care_streak_last_day',
    // Progression process tags
    'progression_state', 'progression_started_at',
    // Legacy progression timing (also preserve for fallback)
    'state_started_at',
    // Social/flag tags
    'social', 'generation', 'breeding_ready',
    // Personality tags (preserve if they exist, do NOT generate)
    'personality', 'trait', 'favorite_food', 'voice_type', 'mood',
    // Evolution tags
    'adult_type',
    // Breed category / asset tags (preserve species selection across migration)
    'breed_category', 'breed_asset', 'bao_rarity',
    // Phase C: custom species + pet-bound economy
    'custom_form', 'fiat_balance', 'egg_scale',
    // Extension tags
    'theme', 'crossover_app', 'asset_3d',
  ];
  
  for (const tagName of persistentTagNames) {
    const value = getTagValue(legacyTags, tagName);
    if (value !== undefined) {
      newTags.push([tagName, value]);
    }
  }
  
  // ─── Normalise legacy state → progression_state ───
  // If the legacy event has state='incubating' or state='evolving', migrate
  // to the new split model during migration.
  const legacyState = getTagValue(legacyTags, 'state');
  if (legacyState === 'incubating' || legacyState === 'evolving') {
    // Set activity state to 'active' (the progression process is tracked separately)
    newTags.push(['state', 'active']);
    // Only set progression_state if not already set from persistentTagNames
    if (!getTagValue(legacyTags, 'progression_state')) {
      newTags.push(['progression_state', legacyState]);
      // Migrate state_started_at → progression_started_at if present
      const startedAt = getTagValue(legacyTags, 'state_started_at');
      if (startedAt && !getTagValue(legacyTags, 'progression_started_at')) {
        newTags.push(['progression_started_at', startedAt]);
      }
    }
  } else if (legacyState) {
    newTags.push(['state', legacyState]);
    // Ensure progression_state is set
    if (!getTagValue(legacyTags, 'progression_state')) {
      newTags.push(['progression_state', 'none']);
    }
  } else {
    newTags.push(['state', 'active']);
    newTags.push(['progression_state', 'none']);
  }
  
  // ALWAYS include visual trait tags - derived from seed, with legacy tag fallbacks
  // This ensures every migrated event has complete visual traits for consistent rendering
  const visualTraits = deriveVisualTraits(legacyTags, seed);
  newTags.push(['base_color', visualTraits.baseColor]);
  newTags.push(['secondary_color', visualTraits.secondaryColor]);
  newTags.push(['eye_color', visualTraits.eyeColor]);
  newTags.push(['pattern', visualTraits.pattern]);
  newTags.push(['special_mark', visualTraits.specialMark]);
  newTags.push(['size', visualTraits.size]);
  newTags.push(['archetype', visualTraits.archetype]);
  newTags.push(['special_ability', visualTraits.specialAbility]);
  
  // Update timestamps
  newTags.push(['last_interaction', now]);
  const lastDecay = getTagValue(legacyTags, 'last_decay_at');
  if (lastDecay) {
    newTags.push(['last_decay_at', lastDecay]);
  } else {
    newTags.push(['last_decay_at', now]);
  }
  
  // Preserve truly unknown tags for forward compatibility
  // (tags not in managed set AND not in visual trait set AND not deprecated)
  const knownTagNames = new Set([
    ...MANAGED_PETS_STATE_TAG_NAMES,
    ...VISUAL_TRAIT_TAG_NAMES,
    ...DEPRECATED_PETS_TAG_NAMES,
  ]);
  const unknownTags = legacyTags.filter(tag => !knownTagNames.has(tag[0]));
  
  const assembledTags = [...newTags, ...unknownTags];
  
  // ─── Validate and Repair Tags ───
  // Use the tag integrity guard to ensure all required tags are present
  // and deprecated tags are removed
  const repairResult = validateAndRepairPetsTags(assembledTags, legacyTags);
  
  if (import.meta.env.DEV) {
    if (repairResult.repaired) {
      console.log('[Migration] Tag repairs applied:', repairResult.repairs);
    }
    if (repairResult.errors.length > 0) {
      console.warn('[Migration] Tag validation errors:', repairResult.errors);
    }
  }
  
  return repairResult.tags;
}

/**
 * Check if a Pets needs migration to canonical format.
 */
export function needsCanonicalMigration(d: string): boolean {
  return isLegacyPetsD(d);
}

/**
 * Add a pet to the profile's 'has' list without duplicates.
 * Returns updated has array.
 */
export function addPetToHas(currentHas: string[], newPetD: string): string[] {
  if (currentHas.includes(newPetD)) {
    return currentHas;
  }
  return [...currentHas, newPetD];
}

/**
 * Remove a legacy pet ID from 'has' and replace with canonical.
 */
export function migratePetInHas(
  currentHas: string[],
  legacyD: string,
  canonicalD: string
): string[] {
  const filtered = currentHas.filter(d => d !== legacyD);
  if (!filtered.includes(canonicalD)) {
    filtered.push(canonicalD);
  }
  return filtered;
}

// ─── Legacy / Canonical Deduplication ──────────────────────────────────────────

/**
 * Normalize a Pets name for equivalence comparison.
 * Lowercases and trims whitespace so "Jack", "jack", and " Jack " all match.
 */
export function normalizePetsName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Check whether a canonical companion is equivalent to a legacy companion.
 *
 * Equivalence priority (first match wins):
 * 1. **migrated_from exact match**: canonical has a `migrated_from` tag that
 *    equals the legacy d-tag. This is the strongest signal — it was written
 *    during migration and is preserved across all subsequent updates.
 * 2. **name + base_color match**: same normalized name AND same raw `base_color`
 *    tag value (both present and equal). Covers older canonical copies that
 *    were created before the `migrated_from` tag existed.
 * 3. **name-only fallback**: same normalized name when the legacy event has no
 *    explicit `base_color` tag (too bare to compare). This is the weakest tier
 *    and only applies to genuinely old legacy events with no visual tags.
 */
function isCanonicalEquivalentToLegacy(
  canonical: PetsCompanion,
  legacyD: string,
  legacyName: string,
  legacyBaseColor: string | undefined,
): boolean {
  // Priority 1: migrated_from exact match
  const migratedFrom = getTagValue(canonical.event.tags, 'migrated_from');
  if (migratedFrom === legacyD) return true;

  // Priority 2: name + base_color (both must be present and equal)
  const canonicalBaseColor = getTagValue(canonical.event.tags, 'base_color');
  if (
    normalizePetsName(canonical.name) === legacyName &&
    legacyBaseColor !== undefined &&
    canonicalBaseColor !== undefined &&
    legacyBaseColor.toUpperCase() === canonicalBaseColor.toUpperCase()
  ) {
    return true;
  }

  // Priority 3: name-only when legacy has no base_color to compare
  if (
    normalizePetsName(canonical.name) === legacyName &&
    legacyBaseColor === undefined
  ) {
    return true;
  }

  return false;
}

/**
 * Filter out legacy companions that have been migrated to canonical format.
 *
 * A legacy companion is hidden when ALL of the following are true:
 * 1. It is a legacy event (companion.isLegacy === true)
 * 2. The legacy d-tag is NOT present in profile.has (confirming migration occurred)
 * 3. A canonical equivalent exists, determined by (first match wins):
 *    a. migrated_from exact match on the legacy d-tag
 *    b. same normalized name + same raw base_color tag
 *    c. same normalized name (fallback when legacy has no base_color tag)
 *
 * After legacy filtering, a second pass collapses canonical → canonical
 * duplicates that share the same `migrated_from` tag value (i.e. were both
 * migrated from the same legacy d-tag due to a race condition). For each
 * group the companion with the newest `created_at` is kept; the rest are
 * hidden. Canonical companions without a `migrated_from` tag are always
 * kept — no heuristic (name, color, etc.) grouping is applied.
 *
 * @param companions - All parsed companions (legacy + canonical)
 * @param profileHas - The profile.has array of owned Pets d-tags
 * @returns Filtered companions with migrated legacy entries and canonical
 *          duplicates removed
 */
export function filterMigratedLegacyCompanions(
  companions: PetsCompanion[],
  profileHas: string[],
): PetsCompanion[] {
  // Collect canonical companions for equivalence checks
  const canonicals = companions.filter((c) => !c.isLegacy);

  // If there are no canonical companions, nothing to filter
  if (canonicals.length === 0) return companions;

  const hasSet = new Set(profileHas);

  const afterLegacyFilter = companions.filter((c) => {
    // Keep all canonical companions unconditionally (deduped in next pass)
    if (!c.isLegacy) return true;

    // Keep legacy companions that are still in profile.has (not yet migrated)
    if (hasSet.has(c.d)) return true;

    // Check if any canonical companion is equivalent to this legacy one
    const legacyName = normalizePetsName(c.name);
    const legacyBaseColor = getTagValue(c.event.tags, 'base_color');

    const hasEquivalent = canonicals.some((canonical) =>
      isCanonicalEquivalentToLegacy(canonical, c.d, legacyName, legacyBaseColor),
    );

    // Hide if a canonical equivalent exists, keep otherwise
    return !hasEquivalent;
  });

  // ── Canonical → canonical dedup ──────────────────────────────────────────
  // Group canonical companions by `migrated_from` tag. Within each group,
  // keep only the newest event (highest created_at). Canonicals without the
  // tag are never grouped — they pass through untouched.
  const canonicalWinners = collapseCanonicalDuplicates(
    afterLegacyFilter.filter((c) => !c.isLegacy),
  );
  const winnerDs = new Set(canonicalWinners.map((c) => c.d));

  return afterLegacyFilter.filter((c) => {
    // Legacy companions already survived the first pass — keep them
    if (c.isLegacy) return true;
    // Canonical companions must be in the winner set
    return winnerDs.has(c.d);
  });
}

/**
 * Collapse canonical companions that were duplicated by a migration race.
 *
 * Two canonical companions are considered duplicates of the same logical
 * Pets if and only if both carry a `migrated_from` tag with the same
 * value. For each such group the companion with the newest `created_at`
 * is kept; ties are broken by d-tag lexicographic order (deterministic).
 *
 * Canonical companions *without* a `migrated_from` tag are always kept —
 * no heuristic grouping (name, color, etc.) is applied.
 */
function collapseCanonicalDuplicates(
  canonicals: PetsCompanion[],
): PetsCompanion[] {
  // Companions without migrated_from — always kept
  const ungrouped: PetsCompanion[] = [];
  // Group canonical companions by migrated_from value
  const groups = new Map<string, PetsCompanion[]>();

  for (const c of canonicals) {
    const migratedFrom = getTagValue(c.event.tags, 'migrated_from');
    if (!migratedFrom) {
      ungrouped.push(c);
      continue;
    }
    const group = groups.get(migratedFrom);
    if (group) {
      group.push(c);
    } else {
      groups.set(migratedFrom, [c]);
    }
  }

  // Pick the winner from each group: newest created_at, tie-break on d-tag
  const winners: PetsCompanion[] = [...ungrouped];
  for (const group of groups.values()) {
    let best = group[0];
    for (let i = 1; i < group.length; i++) {
      const c = group[i];
      if (
        c.event.created_at > best.event.created_at ||
        (c.event.created_at === best.event.created_at && c.d > best.d)
      ) {
        best = c;
      }
    }
    winners.push(best);
  }

  return winners;
}

/**
 * Find an existing canonical companion that is equivalent to a legacy companion.
 *
 * Used by the migration guard to avoid creating duplicate canonical events.
 * Uses the same equivalence priority as `filterMigratedLegacyCompanions`:
 * 1. migrated_from exact match (strongest)
 * 2. same normalized name + same raw base_color tag
 * 3. same normalized name when legacy has no base_color (weakest)
 *
 * When multiple canonical companions match, the one with the newest
 * created_at is returned (most up-to-date state).
 *
 * @param legacy - The legacy companion to find an equivalent for
 * @param companions - All parsed companions
 * @returns The best matching canonical companion, or undefined
 */
export function findCanonicalEquivalent(
  legacy: PetsCompanion,
  companions: PetsCompanion[],
): PetsCompanion | undefined {
  const legacyName = normalizePetsName(legacy.name);
  const legacyBaseColor = getTagValue(legacy.event.tags, 'base_color');
  let best: PetsCompanion | undefined;

  for (const c of companions) {
    if (c.isLegacy) continue;
    if (!isCanonicalEquivalentToLegacy(c, legacy.d, legacyName, legacyBaseColor)) continue;
    // Among multiple matches, prefer the newest (most up-to-date state)
    if (!best || c.event.created_at > best.event.created_at) {
      best = c;
    }
  }

  return best;
}

// ─── LocalStorage Cache Types ─────────────────────────────────────────────────

export interface PetsBootCache {
  /** The user's pubkey this cache belongs to */
  pubkey: string;
  profile: NostrPetProfile | null;
  companion: PetsCompanion | null;
  cachedAt: number;
}

export const PETS_CACHE_KEY = 'pets:boot-cache';
