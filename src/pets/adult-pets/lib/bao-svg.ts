/**
 * ₿AO Pets SVG generator.
 *
 * Builds a living SVG adult for any variation in the BAO_RECIPE. The output
 * uses CSS custom properties for recoloring and exposes the same eye hooks
 * (data-pets-pupil) as Blobbi so it works with PetsAdultSvgRenderer.
 */

import { uniquifySvgIds, ensureSvgFillsContainer } from '@/pets/ui/lib/svg';
import type { BaoRecipe, BaoAccessories } from './bao-recipe';

function baoAccessorySVG(type: string): string {
  switch (type) {
    case 'horns':
      return `<path d="M70 80 Q55 45 60 30" stroke="var(--secondaryColor)" stroke-width="4" fill="none" stroke-linecap="round" />
              <path d="M130 80 Q145 45 140 30" stroke="var(--secondaryColor)" stroke-width="4" fill="none" stroke-linecap="round" />`;
    case 'ram':
      return `<path d="M68 82 Q45 50 35 65 Q45 75 62 88" stroke="var(--secondaryColor)" stroke-width="5" fill="none" stroke-linecap="round" />
              <path d="M132 82 Q155 50 165 65 Q155 75 138 88" stroke="var(--secondaryColor)" stroke-width="5" fill="none" stroke-linecap="round" />`;
    case 'lightning':
      return `<polygon points="65,45 75,70 68,70 78,95 60,70 68,70" fill="var(--secondaryColor)" transform="translate(0,-10)" />
              <polygon points="135,45 125,70 132,70 122,95 140,70 132,70" fill="var(--secondaryColor)" transform="translate(0,-10)" />`;
    case 'rune-etched':
      return `<path d="M70 75 L62 50 L78 50 Z" fill="none" stroke="var(--secondaryColor)" stroke-width="3" />
              <path d="M130 75 L122 50 L138 50 Z" fill="none" stroke="var(--secondaryColor)" stroke-width="3" />`;
    case 'crown':
      return `<polygon points="60,55 75,40 90,55 105,40 120,55 135,40 140,55 140,70 60,70" fill="var(--secondaryColor)" />`;
    case 'stripe':
      return `<rect x="55" y="105" width="90" height="8" rx="4" fill="var(--secondaryColor)" opacity="0.75" />`;
    case 'spots':
      return `<circle cx="75" cy="110" r="7" fill="var(--secondaryColor)" opacity="0.7" />
              <circle cx="125" cy="120" r="5" fill="var(--secondaryColor)" opacity="0.7" />
              <circle cx="100" cy="135" r="4" fill="var(--secondaryColor)" opacity="0.7" />`;
    case 'rune-circle':
      return `<circle cx="100" cy="115" r="34" fill="none" stroke="var(--secondaryColor)" stroke-width="2" stroke-dasharray="6 4" opacity="0.8" />
              <text x="100" y="118" text-anchor="middle" fill="var(--secondaryColor)" font-size="14" font-family="monospace" opacity="0.9">₿</text>`;
    case 'chart-line':
      return `<polyline points="58,132 78,118 98,125 118,105 142,95" fill="none" stroke="var(--secondaryColor)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
              <polygon points="138,92 146,95 138,98" fill="var(--secondaryColor)" />`;
    case 'circuit':
      return `<path d="M60 115 H80 V100 H120 V115 H140" fill="none" stroke="var(--secondaryColor)" stroke-width="2" />
              <circle cx="60" cy="115" r="3" fill="var(--secondaryColor)" />
              <circle cx="100" cy="100" r="3" fill="var(--secondaryColor)" />
              <circle cx="140" cy="115" r="3" fill="var(--secondaryColor)" />`;
    case 'tail-coin':
      return `<circle cx="160" cy="145" r="14" fill="none" stroke="var(--secondaryColor)" stroke-width="3" />
              <text x="160" y="149" text-anchor="middle" fill="var(--secondaryColor)" font-size="12" font-family="monospace">₿</text>`;
    case 'wings':
      return `<path d="M70 100 Q30 60 25 95 Q40 120 70 110 Z" fill="var(--secondaryColor)" opacity="0.25" stroke="var(--secondaryColor)" stroke-width="1" />
              <path d="M130 100 Q170 60 175 95 Q160 120 130 110 Z" fill="var(--secondaryColor)" opacity="0.25" stroke="var(--secondaryColor)" stroke-width="1" />`;
    case 'spikes':
      return `<polygon points="55,95 60,75 65,95" fill="var(--secondaryColor)" />
              <polygon points="135,95 140,75 145,95" fill="var(--secondaryColor)" />
              <polygon points="95,55 100,35 105,55" fill="var(--secondaryColor)" />`;
    case 'halo':
      return `<ellipse cx="100" cy="45" rx="42" ry="8" fill="none" stroke="var(--secondaryColor)" stroke-width="3" />`;
    case 'aura-rare':
      return `<circle cx="100" cy="110" r="70" fill="none" stroke="var(--secondaryColor)" stroke-width="1.5" opacity="0.25" />`;
    case 'aura-epic':
      return `<circle cx="100" cy="110" r="76" fill="none" stroke="var(--secondaryColor)" stroke-width="2" opacity="0.3" />
              <circle cx="100" cy="110" r="64" fill="none" stroke="var(--secondaryColor)" stroke-width="1" opacity="0.2" />`;
    case 'aura-legendary':
      return `<circle cx="100" cy="110" r="82" fill="none" stroke="var(--secondaryColor)" stroke-width="2.5" opacity="0.35" />
              <circle cx="100" cy="110" r="68" fill="none" stroke="var(--baseColor)" stroke-width="1.5" opacity="0.25" />`;
    default:
      return '';
  }
}

function renderAccessories(accessories: BaoAccessories): string {
  const parts: string[] = [];
  if (accessories.back !== 'none') parts.push(baoAccessorySVG(accessories.back));
  if (accessories.aura !== 'none') parts.push(baoAccessorySVG(`aura-${accessories.aura}`));
  return parts.join('\n  ');
}

export interface BaoSvgOptions {
  /** Optional CSS class added to the SVG root in addition to the defaults. */
  className?: string;
  /**
   * Mark the SVG as carrying its own curated palette so the baby customizer
   * skips seed-based recoloring (the recipe palette IS the identity).
   */
  fixedColors?: boolean;
}

/**
 * Generate the living SVG string for a ₿AO variation.
 */
export function generateBaoSvg(recipe: BaoRecipe, options: BaoSvgOptions = {}): string {
  const { base, secondary, eye } = recipe.palette;
  const glowId = `bao-glow-${recipe.id}`;
  const bodyGradientId = `bao-body-${recipe.id}`;
  const rootClass = cn('pets-adult-art', 'bao-art', `bao-${recipe.id}`, options.className);
  const fixedColorsAttr = options.fixedColors ? ' data-pets-fixed-colors="true"' : '';

  const parts: string[] = [];
  parts.push(renderAccessories(recipe.accessories));

  return `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" class="${rootClass}" data-bao-id="${recipe.id}"${fixedColorsAttr}>
  <defs>
    <style>
      :root {
        --baseColor: ${base};
        --secondaryColor: ${secondary};
        --eyeColor: ${eye};
      }
    </style>
    <radialGradient id="${bodyGradientId}" cx="40%" cy="35%" r="70%">
      <stop offset="0%" stop-color="var(--secondaryColor)" />
      <stop offset="55%" stop-color="var(--baseColor)" />
      <stop offset="100%" stop-color="var(--baseColor)" />
    </radialGradient>
    <filter id="${glowId}" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="0" dy="0" stdDeviation="4" flood-color="var(--eyeColor)" flood-opacity="0.45"/>
    </filter>
  </defs>
  ${parts.join('\n  ')}
  <!-- Body -->
  <ellipse cx="100" cy="112" rx="56" ry="50" fill="url(#${bodyGradientId})" filter="url(#${glowId})" stroke="var(--secondaryColor)" stroke-width="1.5" />
  <!-- Marking -->
  ${recipe.accessories.marking !== 'none' ? baoAccessorySVG(recipe.accessories.marking) : ''}
  <!-- Horns -->
  ${recipe.accessories.horns !== 'none' ? baoAccessorySVG(recipe.accessories.horns) : ''}
  <!-- Face -->
  <g class="face">
    <g class="eye-group eye-open">
      <ellipse cx="78" cy="104" rx="11" ry="13" fill="#0a0a0f" />
      <ellipse class="pupil" cx="78" cy="104" rx="4" ry="6" fill="var(--eyeColor)" data-pets-pupil="true" />
    </g>
    <g class="eye-group eye-open">
      <ellipse cx="122" cy="104" rx="11" ry="13" fill="#0a0a0f" />
      <ellipse class="pupil" cx="122" cy="104" rx="4" ry="6" fill="var(--eyeColor)" data-pets-pupil="true" />
    </g>
    <g class="eye-group eye-closed">
      <path d="M66 104 Q78 111 90 104" stroke="var(--eyeColor)" stroke-width="2" fill="none" />
    </g>
    <g class="eye-group eye-closed">
      <path d="M110 104 Q122 111 134 104" stroke="var(--eyeColor)" stroke-width="2" fill="none" />
    </g>
  </g>
  <!-- Tiny paws -->
  <ellipse cx="78" cy="158" rx="8" ry="5" fill="var(--secondaryColor)" />
  <ellipse cx="122" cy="158" rx="8" ry="5" fill="var(--secondaryColor)" />
</svg>`;
}

/**
 * Customize a generated ₿AO SVG for a specific instance. Ensures the SVG fills
 * its container and uniquifies gradient/filter IDs so multiple ₿AO can render
 * on one page.
 */
export function customizeBaoSvg(
  svgText: string,
  _recipe: BaoRecipe,
  instanceId: string,
): string {
  let svg = ensureSvgFillsContainer(svgText);
  svg = uniquifySvgIds(svg, instanceId);
  return svg;
}

/**
 * Generate the baby-stage SVG for a ₿AO variation.
 *
 * Every baby should resemble its mature form: a ₿AO baby is the same creature
 * with the same recipe palette and the identity accessories (horns, marking),
 * minus the rare flex (back piece, aura) it grows into at adulthood. The
 * recipe palette is the identity, so the SVG is marked fixed-colors to keep
 * the baby customizer from seed-recoloring it.
 */
export function generateBaoBabySvg(recipe: BaoRecipe): string {
  const babyRecipe: BaoRecipe = {
    ...recipe,
    accessories: {
      horns: recipe.accessories.horns,
      marking: recipe.accessories.marking,
      back: 'none',
      aura: 'none',
    },
  };
  return generateBaoSvg(babyRecipe, { className: 'bao-baby-art', fixedColors: true });
}

// Small class-name merge helper to avoid pulling in the full utils module.
function cn(...classes: (string | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}