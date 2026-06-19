# Baby Pets Module

Self-contained module for baby stage Pets visuals and customization.

## Overview

This module provides everything needed to render and customize baby stage Petss:

- **SVG Assets**: Base and sleeping variants
- **SVG Resolution**: Loading and variant selection
- **Customization**: Color and appearance customization
- **Type Safety**: Full TypeScript support

## Module Structure

```
src/pets/baby-pets/
├── assets/
│   ├── pets-baby-base.svg      # Awake baby variant
│   └── pets-baby-sleeping.svg   # Sleeping baby variant
├── lib/
│   ├── baby-svg-resolver.ts       # SVG loading and resolution
│   └── baby-svg-customizer.ts     # Color customization utilities
├── types/
│   └── baby.types.ts              # Type definitions
├── index.ts                       # Barrel exports
└── README.md                      # This file
```

## Usage

### Basic SVG Resolution

```typescript
import { resolveBabySvg, getBabyBaseSvg, getBabySleepingSvg } from '@/pets/baby-pets';

// Get specific variant
const awakeSvg = getBabyBaseSvg();
const sleepingSvg = getBabySleepingSvg();

// Resolve from Pets instance
const svg = resolveBabySvg(pets, { isSleeping: false });
```

### Color Customization

```typescript
import { customizeBabySvgFromPets } from '@/pets/baby-pets';

// Get base SVG
const baseSvg = getBabyBaseSvg();

// Apply Pets's colors
const customizedSvg = customizeBabySvgFromPets(baseSvg, pets, false);
```

### Preloading

```typescript
import { preloadBabySvgs } from '@/pets/baby-pets';

// Preload all baby SVGs for quick switching
preloadBabySvgs();
```

## Customization Options

The module supports three color customizations:

- **baseColor**: Primary body color
- **secondaryColor**: Secondary gradient color
- **eyeColor**: Pupil/eye color (not applied to sleeping variant)

## Design Principles

1. **Portability**: Self-contained, minimal external dependencies
2. **Type Safety**: Full TypeScript coverage
3. **Performance**: Eager loading via Vite for instant access
4. **Consistency**: Follows established patterns from egg module
5. **Separation**: Baby-specific logic isolated from adult/egg logic

## Integration

This module is designed to be:

- Imported via barrel exports from `@/pets/baby-pets`
- Used alongside egg and adult modules
- Easily moved to other projects with minimal changes

## Related Modules

- **Egg Module**: `src/egg/` - Egg stage visuals and incubation
- **Adult Module**: Adult stage visuals (to be refactored similarly)
