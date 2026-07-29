import { useMemo } from 'react';
import { Palette } from 'lucide-react';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import { cn } from '@/lib/utils';
import { customizeAdultSvg, getAdultBaseSvg, type AdultForm } from '@/pets/adult-pets';
import { getBaoRecipeById } from '@/pets/adult-pets/lib/bao-recipe';
import { customizeBaoSvg, generateBaoSvg } from '@/pets/adult-pets/lib/bao-svg';
import {
  getCategoryMembers,
  getCustomCategoryMembers,
  getMemberAssetId,
  isAdultFormMember,
  type PetsBreedCategory,
} from '@/pets/core/lib/pet-categories';
import { getBuzzPetAnimatedUrl } from '@/pets/core/lib/buzz-pets';
import { deriveVisualTraits } from '@/pets/core/lib/pets';
import { useCustomForms } from '@/pets/three-d/hooks/useCustomForms';

export interface BreedCategoryPreviewsProps {
  category: PetsBreedCategory;
  size?: 'sm' | 'md';
  /** Maximum number of preview tiles to render (useful in compact cards). */
  limit?: number;
  className?: string;
}

const SIZE_CLASSES: Record<Required<BreedCategoryPreviewsProps>['size'], string> = {
  sm: 'w-8 h-8',
  md: 'w-10 h-10',
};

/**
 * Build a stable 64-char hex seed for a category member preview.
 * The seed is only used to derive deterministic colors; it is not a real pet identity.
 */
function getPreviewSeed(category: PetsBreedCategory, memberId: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(`pets:preview:v1|${category}:${memberId}`)));
}

function getAdultFormPreviewSvg(form: AdultForm, category: PetsBreedCategory): string {
  const seed = getPreviewSeed(category, form);
  const traits = deriveVisualTraits([], seed);
  const svg = getAdultBaseSvg(form);
  return customizeAdultSvg(svg, form, {
    baseColor: traits.baseColor,
    secondaryColor: traits.secondaryColor,
    eyeColor: traits.eyeColor,
  }, false, `${category}-${form}`);
}

function getBaoCardPreviewSvg(recipeId: string): string {
  const recipe = getBaoRecipeById(recipeId);
  if (!recipe) return '';
  const svg = generateBaoSvg(recipe);
  return customizeBaoSvg(svg, recipe, `preview-bao-${recipeId}`);
}

/**
 * Render a small preview tile for every species available in a breed category.
 *
 * - Adult-form categories show the colorized SVG for each form.
 * - ₿AO shows each curated card design.
 * - Custom shows placeholders for the owner's custom species (or a "design your own" prompt).
 */
export function BreedCategoryPreviews({
  category,
  size = 'md',
  limit,
  className,
}: BreedCategoryPreviewsProps) {
  const customForms = useCustomForms();

  const members = useMemo(() => {
    if (category === 'custom') {
      return getCustomCategoryMembers(Object.values(customForms));
    }
    return getCategoryMembers(category);
  }, [category, customForms]);

  const displayedMembers = limit === undefined ? members : members.slice(0, limit);

  if (category === 'custom' && members.length === 0) {
    return (
      <div className={cn('flex items-center justify-center gap-2 text-muted-foreground', className)}>
        <div className={cn('rounded-lg bg-muted/40 flex items-center justify-center', SIZE_CLASSES[size])}>
          <Palette className="size-4" />
        </div>
        <span className="text-xs">Design your own</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-center gap-1.5',
        className,
      )}
    >
      {displayedMembers.map((member) => {
        const memberId = isAdultFormMember(member) ? member.form : member.id;

        // Buzz tiles use the animated WebP directly instead of an SVG string.
        if (category === 'buzz') {
          return (
            <div
              key={memberId}
              className={cn(
                'relative rounded-lg bg-muted/40 overflow-hidden',
                SIZE_CLASSES[size],
              )}
              title={member.label}
            >
              <img
                src={getBuzzPetAnimatedUrl(getMemberAssetId(member))}
                alt={member.label}
                className="w-full h-full object-contain p-0.5"
                loading="lazy"
              />
            </div>
          );
        }

        const svg = isAdultFormMember(member)
          ? getAdultFormPreviewSvg(member.form, category)
          : category === 'bao'
            ? getBaoCardPreviewSvg(getMemberAssetId(member))
            : '';

        return (
          <div
            key={memberId}
            className={cn(
              'relative rounded-lg bg-muted/40 overflow-hidden',
              SIZE_CLASSES[size],
            )}
            title={member.label}
          >
            {svg ? (
              <img
                src={`data:image/svg+xml,${encodeURIComponent(svg)}`}
                alt={member.label}
                className="w-full h-full object-contain p-0.5"
                loading="lazy"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Palette className="size-4 text-muted-foreground" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
