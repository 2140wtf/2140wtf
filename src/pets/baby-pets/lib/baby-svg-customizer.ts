/**
 * Baby Pets SVG Customizer
 *
 * Handles applying colors and customizations to baby SVG content.
 * Uses shared utilities from pets/ui/lib/svg for common operations.
 */

import { Pets } from '@/pets/core/types/pets';
import { lightenColor, uniquifySvgIds, ensureSvgFillsContainer } from '@/pets/ui/lib/svg';
import { BabySvgCustomization } from '../types/baby.types';

/**
 * Apply color customizations to baby SVG
 * 
 * @param svgText - The SVG content to customize
 * @param customization - Color customization options
 * @param isSleeping - Whether the Pets is sleeping (affects eye rendering)
 * @param instanceId - Optional unique ID to prevent gradient ID collisions when multiple Petss are rendered
 */
export function customizeBabySvg(
  svgText: string, 
  customization: BabySvgCustomization,
  isSleeping: boolean = false,
  instanceId?: string
): string {
  let modifiedSvg = svgText;

  // Ensure SVG fills its container by adding width/height attributes
  // This is needed because the SVG only has viewBox, and without explicit dimensions
  // it may not fill flex containers properly
  modifiedSvg = ensureSvgFillsContainer(modifiedSvg);

  // Some category-specific SVGs ship with their own curated palette (e.g. the
  // 2140-pets glassmorphism gangster). Skip recoloring so the design stays intact.
  const hasFixedColors = /data-pets-fixed-colors=["']true["']/.test(modifiedSvg);

  // Only apply customizations if we have colors and the SVG isn't fixed-color
  if (hasFixedColors || (!customization.baseColor && !customization.secondaryColor && !customization.eyeColor)) {
    // Still uniquify IDs if instanceId provided (even without color changes)
    if (instanceId) {
      modifiedSvg = uniquifySvgIds(modifiedSvg, instanceId);
    }
    return modifiedSvg;
  }

  // Apply body gradient customization
  if (customization.baseColor) {
    modifiedSvg = applyBodyGradient(modifiedSvg, customization);
  }

  // Apply eye color customization (skip for sleeping SVGs - eyes are closed)
  if (customization.eyeColor && !isSleeping) {
    modifiedSvg = applyEyeColor(modifiedSvg, customization.eyeColor);
  }

  // Make all IDs unique to prevent collisions when multiple Petss are rendered
  if (instanceId) {
    modifiedSvg = uniquifySvgIds(modifiedSvg, instanceId);
  }

  return modifiedSvg;
}

/**
 * Apply body gradient customization
 */
function applyBodyGradient(svgText: string, customization: BabySvgCustomization): string {
  const bodyGradientRegex = /<radialGradient[^>]*id=["']petsBodyGradient["'][^>]*>([\s\S]*?)<\/radialGradient>/;
  const bodyGradientMatch = svgText.match(bodyGradientRegex);

  if (!bodyGradientMatch || !customization.baseColor) {
    return svgText;
  }

  let newGradient = '';

  if (customization.secondaryColor) {
    // Both base_color and secondary_color are present
    newGradient = `<radialGradient id="petsBodyGradient" cx="0.3" cy="0.25">
      <stop offset="0%" style="stop-color:${customization.secondaryColor}"/>
      <stop offset="60%" style="stop-color:${lightenColor(customization.secondaryColor, 20)}"/>
      <stop offset="100%" style="stop-color:${customization.baseColor}"/>
    </radialGradient>`;
  } else {
    // Only base_color is present
    newGradient = `<radialGradient id="petsBodyGradient" cx="0.3" cy="0.25">
      <stop offset="0%" style="stop-color:${lightenColor(customization.baseColor, 40)}"/>
      <stop offset="60%" style="stop-color:${lightenColor(customization.baseColor, 20)}"/>
      <stop offset="100%" style="stop-color:${customization.baseColor}"/>
    </radialGradient>`;
  }

  return svgText.replace(bodyGradientMatch[0], newGradient);
}

/**
 * Apply eye color customization
 */
function applyEyeColor(svgText: string, eyeColor: string): string {
  const eyeGradientRegex = /<radialGradient[^>]*id=["']petsPupilGradient["'][^>]*>([\s\S]*?)<\/radialGradient>/;
  const eyeGradientMatch = svgText.match(eyeGradientRegex);

  if (!eyeGradientMatch) {
    return svgText;
  }

  const newEyeGradient = `<radialGradient id="petsPupilGradient" cx="0.3" cy="0.3">
    <stop offset="0%" style="stop-color:${lightenColor(eyeColor, 30)}"/>
    <stop offset="100%" style="stop-color:${eyeColor}"/>
  </radialGradient>`;

  return svgText.replace(eyeGradientMatch[0], newEyeGradient);
}

/**
 * Convenience function to customize baby SVG from a Pets instance.
 * 
 * Uses the Pets's ID to uniquify SVG IDs, preventing gradient collisions
 * when multiple Petss are rendered on the same page.
 */
export function customizeBabySvgFromPets(
  svgText: string,
  pets: Pets,
  isSleeping: boolean = false
): string {
  const customization: BabySvgCustomization = {
    baseColor: pets.baseColor,
    secondaryColor: pets.secondaryColor,
    eyeColor: pets.eyeColor,
  };

  // Pass pets.id to uniquify gradient IDs and prevent collisions
  return customizeBabySvg(svgText, customization, isSleeping, pets.id);
}
