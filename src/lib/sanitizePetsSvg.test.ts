import { describe, it, expect } from 'vitest';
import { sanitizePetsSvg } from './sanitizePetsSvg';
import { sanitizeSvg } from './sanitizeSvg';

describe('sanitizePetsSvg', () => {
  it('preserves data-* attributes used by eye animation', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <g class="pets-blink pets-blink-left" data-cx="35" data-cy="45" data-eye-top="18" data-eye-bottom="52" data-clip-height="25" data-clip-id="pets-blink-clip-abc123-left">
        <circle cx="35" cy="45" r="5" fill="#1f2937" />
      </g>
    </svg>`;

    const sanitized = sanitizePetsSvg(svg);

    expect(sanitized).toContain('data-cx="35"');
    expect(sanitized).toContain('data-cy="45"');
    expect(sanitized).toContain('data-eye-top="18"');
    expect(sanitized).toContain('data-eye-bottom="52"');
    expect(sanitized).toContain('data-clip-height="25"');
    expect(sanitized).toContain('data-clip-id="pets-blink-clip-abc123-left"');
  });

  it('blocks SMIL animation elements and attributes', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <rect x="10" y="20" width="30" height="25">
        <animate attributeName="y" values="20;40;20" keyTimes="0;0.5;1" dur="8s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.6 1;0.4 0 0.6 1" />
      </rect>
    </svg>`;

    const sanitized = sanitizePetsSvg(svg);

    expect(sanitized).not.toContain('<animate');
    expect(sanitized).not.toContain('attributeName');
    expect(sanitized).not.toContain('keyTimes');
    expect(sanitized).not.toContain('repeatCount');
    expect(sanitized).toContain('<rect');
  });

  it('blocks animateTransform elements', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <path d="M 35 45 L 40 50" stroke="#1f2937">
        <animateTransform attributeName="transform" type="rotate" from="360 35 45" to="0 35 45" dur="2s" repeatCount="indefinite" />
      </path>
    </svg>`;

    const sanitized = sanitizePetsSvg(svg);

    expect(sanitized).not.toContain('<animateTransform');
    expect(sanitized).not.toContain('type="rotate"');
    expect(sanitized).not.toContain('repeatCount');
    expect(sanitized).toContain('<path');
  });

  it('blocks style tags with @keyframes', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <defs>
        <style type="text/css">
          @keyframes sleepy-zzz { 0% { opacity: 0; } 100% { opacity: 1; } }
          .pets-zzz { animation: sleepy-zzz 8s ease-in-out infinite; }
        </style>
      </defs>
      <g class="pets-zzz" opacity="0">
        <text x="70" y="12" font-family="system-ui" font-size="8">z</text>
      </g>
    </svg>`;

    const sanitized = sanitizePetsSvg(svg);

    expect(sanitized).not.toContain('<style');
    expect(sanitized).not.toContain('@keyframes');
    expect(sanitized).not.toContain('animation:');
    expect(sanitized).toContain('<text');
  });

  it('preserves clipPath with references', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <defs>
        <clipPath id="pets-blink-clip-abc123-left">
          <rect class="pets-blink-clip-rect" x="10" y="20" width="30" height="25" />
        </clipPath>
      </defs>
      <g clip-path="url(#pets-blink-clip-abc123-left)">
        <circle cx="35" cy="45" r="5" fill="white" />
      </g>
    </svg>`;

    const sanitized = sanitizePetsSvg(svg);

    expect(sanitized).toContain('<clipPath id="pets-blink-clip-abc123-left"');
    expect(sanitized).toContain('clip-path="url(#pets-blink-clip-abc123-left)"');
  });

  it('preserves gradient definitions', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <defs>
        <radialGradient id="tearGradient" cx="0.3" cy="0.3">
          <stop offset="0%" stop-color="#e0f2fe" />
          <stop offset="100%" stop-color="#7dd3fc" />
        </radialGradient>
      </defs>
      <ellipse fill="url(#tearGradient)" cx="50" cy="50" rx="10" ry="15" />
    </svg>`;

    const sanitized = sanitizePetsSvg(svg);

    expect(sanitized).toContain('<radialGradient id="tearGradient"');
    expect(sanitized).toContain('stop-color="#e0f2fe"');
    expect(sanitized).toContain('fill="url(#tearGradient)"');
  });

  it('blocks inline style attributes', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <g class="pets-eye" style="transform-box: fill-box; transform-origin: center;">
        <circle cx="35" cy="45" r="5" fill="#1f2937" />
      </g>
    </svg>`;

    const sanitized = sanitizePetsSvg(svg);

    expect(sanitized).not.toContain('style=');
    expect(sanitized).not.toContain('transform-box');
    expect(sanitized).not.toContain('transform-origin');
    expect(sanitized).toContain('<circle');
  });

  it('blocks event handlers', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" onload="alert('xss')">
      <circle cx="50" cy="50" r="10" onclick="alert('xss')" />
    </svg>`;

    const sanitized = sanitizePetsSvg(svg);

    expect(sanitized).not.toContain('onload');
    expect(sanitized).not.toContain('onclick');
    expect(sanitized).not.toContain('alert');
  });

  it('blocks script tags', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <script>alert('xss')</script>
      <circle cx="50" cy="50" r="10" />
    </svg>`;

    const sanitized = sanitizePetsSvg(svg);

    expect(sanitized).not.toContain('<script');
    expect(sanitized).not.toContain('alert');
  });

  it('blocks href attributes', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <a href="javascript:alert('xss')">
        <circle cx="50" cy="50" r="10" />
      </a>
    </svg>`;

    const sanitized = sanitizePetsSvg(svg);

    expect(sanitized).not.toContain('href');
    expect(sanitized).not.toContain('javascript');
  });

  it('blocks foreignObject', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <foreignObject width="100" height="100">
        <div xmlns="http://www.w3.org/1999/xhtml">XSS</div>
      </foreignObject>
    </svg>`;

    const sanitized = sanitizePetsSvg(svg);

    expect(sanitized).not.toContain('foreignObject');
    expect(sanitized).not.toContain('XSS');
  });

  it('preserves text and tspan elements', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <text x="50" y="50" font-family="system-ui" font-size="12" font-weight="bold" fill="#6b7280">
        <tspan x="50" y="50">Hello</tspan>
        <tspan x="50" y="65">World</tspan>
      </text>
    </svg>`;

    const sanitized = sanitizePetsSvg(svg);

    expect(sanitized).toContain('<text');
    expect(sanitized).toContain('<tspan');
    expect(sanitized).toContain('font-family="system-ui"');
    expect(sanitized).toContain('font-weight="bold"');
  });

  it('preserves mask element', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <defs>
        <mask id="test-mask">
          <rect x="0" y="0" width="100" height="100" fill="white" />
        </mask>
      </defs>
      <circle mask="url(#test-mask)" cx="50" cy="50" r="40" fill="blue" />
    </svg>`;

    const sanitized = sanitizePetsSvg(svg);

    expect(sanitized).toContain('<mask id="test-mask"');
    expect(sanitized).toContain('mask="url(#test-mask)"');
  });

  it('rejects SVGs exceeding max length', () => {
    const largeSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <text>${'x'.repeat(600 * 1024)}</text>
    </svg>`;

    const sanitized = sanitizePetsSvg(largeSvg);

    expect(sanitized).toBe('');
  });
});

describe('sanitizer isolation', () => {
  // These tests verify that the two sanitizers are properly isolated and
  // that importing one doesn't affect the other.

  it('sanitizePetsSvg allows data-* attributes', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <g data-cx="35" data-cy="45">
        <circle cx="35" cy="45" r="5" fill="#1f2937" />
      </g>
    </svg>`;

    const sanitized = sanitizePetsSvg(svg);

    expect(sanitized).toContain('data-cx="35"');
    expect(sanitized).toContain('data-cy="45"');
  });

  it('both sanitizers block style tags', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <style>.test { fill: red; }</style>
      <circle cx="50" cy="50" r="10" fill="blue" />
    </svg>`;

    const genericSanitized = sanitizeSvg(svg);
    const petsSanitized = sanitizePetsSvg(svg);

    // Both sanitizers block <style>
    expect(genericSanitized).not.toContain('<style');
    expect(genericSanitized).not.toContain('.test');
    expect(petsSanitized).not.toContain('<style');
    expect(petsSanitized).not.toContain('.test');
  });

  it('both sanitizers block animate elements', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <rect x="10" y="20" width="30" height="25">
        <animate attributeName="y" values="20;40;20" dur="2s" />
      </rect>
    </svg>`;

    const genericSanitized = sanitizeSvg(svg);
    const petsSanitized = sanitizePetsSvg(svg);

    // Both sanitizers block <animate>
    expect(genericSanitized).not.toContain('<animate');
    expect(genericSanitized).not.toContain('attributeName');
    expect(petsSanitized).not.toContain('<animate');
    expect(petsSanitized).not.toContain('attributeName');
  });

  it('both sanitizers block style attributes', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="10" fill="blue" style="transform-origin: center; animation: pulse 2s infinite;" />
    </svg>`;

    const genericSanitized = sanitizeSvg(svg);
    const petsSanitized = sanitizePetsSvg(svg);

    // Both sanitizers block style attribute (explicitly forbidden)
    expect(genericSanitized).not.toContain('style=');
    expect(genericSanitized).not.toContain('transform-origin');
    expect(petsSanitized).not.toContain('style=');
    expect(petsSanitized).not.toContain('transform-origin');
  });

  it('both sanitizers allow defs/gradients (SVG profile includes them)', () => {
    // Both sanitizers use SVG profile which includes structural elements like defs
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <defs>
        <linearGradient id="grad1">
          <stop offset="0%" stop-color="red" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="10" fill="url(#grad1)" />
    </svg>`;

    const genericSanitized = sanitizeSvg(svg);
    const petsSanitized = sanitizePetsSvg(svg);

    // Both sanitizers allow structural SVG elements
    expect(genericSanitized).toContain('<defs');
    expect(genericSanitized).toContain('<linearGradient');
    expect(petsSanitized).toContain('<defs');
    expect(petsSanitized).toContain('<linearGradient');
  });

  it('both sanitizers block script tags', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <script>alert('xss')</script>
      <circle cx="50" cy="50" r="10" fill="blue" />
    </svg>`;

    const genericSanitized = sanitizeSvg(svg);
    const petsSanitized = sanitizePetsSvg(svg);

    // Both should block script
    expect(genericSanitized).not.toContain('<script');
    expect(genericSanitized).not.toContain('alert');
    expect(petsSanitized).not.toContain('<script');
    expect(petsSanitized).not.toContain('alert');
  });

  it('both sanitizers block event handlers', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" onload="alert('xss')">
      <circle cx="50" cy="50" r="10" fill="blue" onclick="alert('xss')" />
    </svg>`;

    const genericSanitized = sanitizeSvg(svg);
    const petsSanitized = sanitizePetsSvg(svg);

    // Both should block event handlers
    expect(genericSanitized).not.toContain('onload');
    expect(genericSanitized).not.toContain('onclick');
    expect(petsSanitized).not.toContain('onload');
    expect(petsSanitized).not.toContain('onclick');
  });

  it('both sanitizers block foreignObject', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <foreignObject width="100" height="100">
        <div xmlns="http://www.w3.org/1999/xhtml">XSS content</div>
      </foreignObject>
    </svg>`;

    const genericSanitized = sanitizeSvg(svg);
    const petsSanitized = sanitizePetsSvg(svg);

    // Both should block foreignObject
    expect(genericSanitized).not.toContain('foreignObject');
    expect(genericSanitized).not.toContain('XSS content');
    expect(petsSanitized).not.toContain('foreignObject');
    expect(petsSanitized).not.toContain('XSS content');
  });

  it('both sanitizers block href/xlink:href', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <a href="javascript:alert('xss')">
        <circle cx="50" cy="50" r="10" fill="blue" />
      </a>
    </svg>`;

    const genericSanitized = sanitizeSvg(svg);
    const petsSanitized = sanitizePetsSvg(svg);

    // Both should block href
    expect(genericSanitized).not.toContain('href');
    expect(genericSanitized).not.toContain('javascript');
    expect(petsSanitized).not.toContain('href');
    expect(petsSanitized).not.toContain('javascript');
  });

  it('lifts <stop> inline styles into stop-color/stop-opacity attributes', () => {
    // Regression: several pipeline assets declare stops as
    // <stop offset="0%" style="stop-color:#8b5cf6;stop-opacity:1" />.
    // Stripping the inline style without lifting the colors left bare stops,
    // and SVG's default stop-color is BLACK — every such gradient rendered as
    // a solid black blob (the "black muppet" baby).
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <defs>
        <radialGradient id="g" cx="0.3" cy="0.25">
          <stop offset="0%" style="stop-color:#8b5cf6;stop-opacity:1" />
          <stop offset="60%" style="stop-color:#7c3aed;stop-opacity:0.5" />
          <stop offset="100%" stop-color="#6d28d9" />
        </radialGradient>
      </defs>
      <path d="M 50 15 L 60 30" fill="url(#g)" />
    </svg>`;

    const sanitized = sanitizePetsSvg(svg);

    expect(sanitized).not.toContain('style=');
    expect(sanitized).toContain('stop-color="#8b5cf6"');
    expect(sanitized).toContain('stop-color="#7c3aed"');
    expect(sanitized).toContain('stop-opacity="0.5"');
    // Attribute-form stops were already fine and must be untouched.
    expect(sanitized).toContain('stop-color="#6d28d9"');
  });

  it('keeps the generic baby SVG body colors through sanitization', async () => {
    // End-to-end guard for the baby pipeline asset that rendered black.
    const { BABY_BASE_SVG } = await import('@/pets/baby-pets/lib/baby-svg-data');
    const sanitized = sanitizePetsSvg(BABY_BASE_SVG);

    // No bare stops: every stop must carry an explicit stop-color.
    const stops = sanitized.match(/<stop\b[^>]*>/g) ?? [];
    expect(stops.length).toBeGreaterThan(0);
    for (const stop of stops) {
      expect(stop).toContain('stop-color=');
    }
    expect(sanitized).toContain('#8b5cf6');
  });

  it('inlines :root CSS custom properties referenced via var()', () => {
    // Regression: the ₿AO generator and Open Design adult forms declare their
    // palette as <style>:root{--baseColor:…}</style> + var(--baseColor) refs.
    // Stripping the style tag without inlining left var() undefined — ₿AO
    // bodies (no fallback) rendered BLACK, Open Design forms silently fell
    // back to baked-in hexes instead of the pet's colors.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
      <defs>
        <style>
          :root {
            --baseColor: #f7931a;
            --secondaryColor: #4d94ff;
          }
        </style>
        <radialGradient id="g" cx="40%" cy="35%" r="70%">
          <stop offset="0%" stop-color="var(--secondaryColor)" />
          <stop offset="100%" stop-color="var(--baseColor)" />
        </radialGradient>
      </defs>
      <ellipse cx="100" cy="112" rx="56" ry="50" fill="url(#g)" stroke="var(--secondaryColor)" />
      <circle cx="78" cy="104" r="4" fill="var(--eyeColor, #22d3ee)" />
    </svg>`;

    const sanitized = sanitizePetsSvg(svg);

    expect(sanitized).not.toContain('<style');
    expect(sanitized).not.toContain('var(--');
    expect(sanitized).toContain('stop-color="#4d94ff"');
    expect(sanitized).toContain('stop-color="#f7931a"');
    expect(sanitized).toContain('stroke="#4d94ff"');
    // Undeclared variable → the var() fallback is honored.
    expect(sanitized).toContain('fill="#22d3ee"');
  });

  it('keeps the ₿AO adult palette through sanitization', async () => {
    // End-to-end guard for the ₿AO pipeline asset that rendered black.
    const { generateBaoSvg, customizeBaoSvg } = await import('@/pets/adult-pets/lib/bao-svg');
    const { BAO_RECIPE } = await import('@/pets/adult-pets/lib/bao-recipe');
    const recipe = BAO_RECIPE[0];
    const svg = customizeBaoSvg(generateBaoSvg(recipe), recipe, 'test-inst');
    const sanitized = sanitizePetsSvg(svg);

    expect(sanitized).not.toContain('var(--');
    expect(sanitized).toContain(recipe.palette.base);
    expect(sanitized).toContain(recipe.palette.secondary);
    expect(sanitized).toContain(recipe.palette.eye);
  });
});
