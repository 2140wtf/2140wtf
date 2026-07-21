/**
 * PetsAdultSvgRenderer — Pure SVG rendering component for adult Pets.
 *
 * This component is the leaf node of the visual pipeline. It:
 *   1. Resolves the base SVG for the adult form
 *   2. Customizes colors and unique IDs
 *   3. Adds eye animation infrastructure (blink clip-paths, gaze groups)
 *   4. Applies visual recipe or emotion preset
 *   5. Applies manual body effects (when no recipe is provided)
 *   6. Sanitizes the SVG
 *   7. Renders via dangerouslySetInnerHTML
 *
 * It does NOT know about:
 *   - Eye tracking hooks (usePetsEyes / useExternalEyeOffset)
 *   - Render mode (page vs companion)
 *   - Reaction CSS classes (sway / bounce)
 *   - Companion runtime (drag, float, position)
 *
 * This separation ensures that the SVG DOM node stays mounted and stable
 * as long as the visual inputs don't change. SMIL and CSS animations
 * inside the SVG continue running across parent rerenders.
 */

import { useMemo } from 'react';

import { resolveAdultSvgWithForm, customizeAdultSvgFromPets } from '@/pets/adult-pets';
import { getBaoRecipeById } from '@/pets/adult-pets/lib/bao-recipe';
import { generateBaoSvg, customizeBaoSvg } from '@/pets/adult-pets/lib/bao-svg';
import { sanitizePetsSvg } from '@/lib/sanitizePetsSvg';
import { useCustomFormSvg } from '@/pets/three-d/hooks/useCustomFormSvg';
import type { CustomPetForm } from '@/pets/three-d/lib/custom-forms-schema';

import { addEyeAnimation } from './lib/eye-animation';
import { resolveVisualRecipe, applyVisualRecipe, type PetsVisualRecipe } from './lib/recipe';
import type { PetsEmotion } from './lib/emotion-types';
import { applyBodyEffects, type BodyEffectsSpec } from './lib/bodyEffects';
import { debugPets } from './lib/debug';
import { useRecipeFingerprint } from './hooks/useFillLevelUpdate';
import { usePetsInstanceId } from './hooks/usePetsInstanceId';
import type { Pets } from '@/pets/core/types/pets';

export interface PetsAdultSvgRendererProps {
  /** The Pets data */
  pets: Pets;
  /** Whether the Pets is sleeping */
  isSleeping: boolean;
  /** Pre-resolved visual recipe. Takes precedence over `emotion`. */
  recipe?: PetsVisualRecipe;
  /** Label for the recipe (used in CSS class names). */
  recipeLabel?: string;
  /** Named emotion preset. Ignored when `recipe` is provided. Default: 'neutral' */
  emotion?: PetsEmotion;
  /** Body-level visual effects (manual/external use only — not from status reaction). */
  bodyEffects?: BodyEffectsSpec;
  /** Optional owner custom species map. If omitted, the current user's profile is used. */
  customForms?: Record<string, CustomPetForm>;
  /** Additional CSS classes for the container */
  className?: string;
}

/**
 * Pure SVG renderer for adult Pets.
 *
 * IMPORTANT: This component must remain a pure rendering leaf. It must NOT:
 * - Run eye-tracking hooks (those belong in the Visual wrapper)
 * - Know about render modes or companion runtime
 * - Apply reaction CSS classes (those belong on an outer wrapper)
 *
 * The parent Visual wrapper owns the DOM query boundary (containerRef)
 * that eye hooks use to find SVG elements via querySelector.
 */
export function PetsAdultSvgRenderer({
  pets,
  isSleeping: _isSleeping,
  recipe: recipeProp,
  recipeLabel,
  emotion = 'neutral',
  bodyEffects,
  customForms,
  className,
}: PetsAdultSvgRendererProps) {
  const recipeFingerprint = useRecipeFingerprint(recipeProp);

  const instanceId = usePetsInstanceId(pets.id);

  const customSvg = useCustomFormSvg(pets, customForms);

  const customizedSvg = useMemo(() => {
    debugPets('svg-rebuild', 'adult customizedSvg rebuild');

    // Resolve the correct adult art. NOSTR Pets / Blobbi use the standard
    // adult-form SVGs; ₿AO Pets (identified by a known breed_asset recipe) render
    // a generated trading-card variation. Custom species use their uploaded SVG.
    let form: string;
    let colorizedSvg: string;

    const baoRecipe = pets.breedAsset ? getBaoRecipeById(pets.breedAsset) : undefined;

    if (baoRecipe) {
      form = pets.breedAsset!;
      colorizedSvg = customizeBaoSvg(generateBaoSvg(baoRecipe), baoRecipe, instanceId);
    } else if (pets.breedCategory === 'custom' && pets.breedAsset) {
      // Custom species render the user-uploaded SVG directly. We do not run the
      // built-in colorizer or eye-animation mutators on it because the uploaded
      // art is self-contained and may not follow the built-in element contract.
      form = pets.breedAsset;
      colorizedSvg = customSvg.svg ?? getFallbackCustomSvg(form);
    } else if (pets.breedCategory === 'bao' && pets.breedAsset) {
      return '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><text x="100" y="110" text-anchor="middle" font-size="12" fill="#666">Unknown ₿AO</text></svg>';
    } else {
      const resolved = resolveAdultSvgWithForm(pets, { isSleeping: false });
      form = resolved.form;
      colorizedSvg = customizeAdultSvgFromPets(resolved.svg, resolved.form, pets, false);
    }

    let animatedSvg =
      pets.breedCategory === 'custom'
        ? colorizedSvg
        : addEyeAnimation(colorizedSvg, { baseColor: pets.baseColor, instanceId });

    if (recipeProp && pets.breedCategory !== 'custom') {
      animatedSvg = applyVisualRecipe(animatedSvg, recipeProp, recipeLabel ?? 'status', 'adult', form, instanceId);
    } else if (emotion !== 'neutral' && pets.breedCategory !== 'custom') {
      const resolved = resolveVisualRecipe(emotion);
      animatedSvg = applyVisualRecipe(animatedSvg, resolved, emotion, 'adult', form, instanceId);
    }

    if (bodyEffects && !recipeProp && pets.breedCategory !== 'custom') {
      animatedSvg = applyBodyEffects(animatedSvg, { ...bodyEffects, idPrefix: bodyEffects.idPrefix ?? instanceId });
    }

    return animatedSvg;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pets.id, pets.baseColor, pets.secondaryColor, pets.eyeColor, pets.adult?.evolutionForm, pets.seed, pets.breedCategory, pets.breedAsset, instanceId, recipeFingerprint, recipeLabel, emotion, bodyEffects, customSvg.svg]);

  const safeSvg = useMemo(() => sanitizePetsSvg(customizedSvg), [customizedSvg]);

  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{ __html: safeSvg }}
    />
  );
}

// ─── Fallback ─────────────────────────────────────────────────────────────────

function getFallbackCustomSvg(form: string): string {
  return `
    <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="fallbackCustomGradient" cx="0.3" cy="0.25">
          <stop offset="0%" style="stop-color:#f472b6"/>
          <stop offset="60%" style="stop-color:#db2777"/>
          <stop offset="100%" style="stop-color:#be185d"/>
        </radialGradient>
      </defs>
      <ellipse cx="100" cy="110" rx="50" ry="60" fill="url(#fallbackCustomGradient)" />
      <ellipse cx="82" cy="95" rx="10" ry="12" fill="#fff" />
      <ellipse cx="118" cy="95" rx="10" ry="12" fill="#fff" />
      <circle cx="82" cy="96" r="7" fill="#374151" />
      <circle cx="118" cy="96" r="7" fill="#374151" />
      <circle cx="84" cy="94" r="2.5" fill="white" />
      <circle cx="120" cy="94" r="2.5" fill="white" />
      <path d="M 88 120 Q 100 130 112 120" stroke="#374151" stroke-width="3" fill="none" stroke-linecap="round" />
      <text x="100" y="180" text-anchor="middle" font-size="12" fill="#666">${form}</text>
    </svg>
  `;
}
