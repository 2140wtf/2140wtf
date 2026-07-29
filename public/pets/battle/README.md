# Battle sprite skins (Open Design)

Animated WebP frames that skin the pet battle engine. Everything in this
folder is optional — with no `manifest.json`, battles render procedurally
(SVG pets + canvas sword/effects), which is the current default.

## Contract

```
manifest.json          — index of skins (required for anything to load)
<key>/<pose>.webp      — animated WebP, transparent background, ~512×512
```

`manifest.json`:

```json
{
  "version": 1,
  "skins": {
    "glitchfox": {
      "frames": {
        "idle": "glitchfox/idle.webp",
        "walk": "glitchfox/walk.webp",
        "slash": "glitchfox/slash.webp",
        "massive-fireball": "glitchfox/massive-fireball.webp"
      },
      "proceduralSword": true
    },
    "default": { "frames": { "idle": "default/idle.webp" } }
  }
}
```

- **Keys** are pet `breed_asset` ids (e.g. `glitchfox`, `biomechmoth`,
  `liquidblob`, `honey-badger`, `bleep`, buzz ids). `default` is the
  fallback skin for pets without a dedicated one.
- **Poses**: `idle`, `walk`, `dash`, `jump`, `block`, `hit`, `ko`, plus one
  per move id: `slash`, `slash-2`, `slash-3`, `uppercut`, `sweep`,
  `dash-slash`, `spin-slash`, `hammer-smash`, `air-slash`, `air-swirl`,
  `salto`, `dive-kick`, `flip-over`, `fireball`, `massive-fireball`,
  `fireball-upper`, `air-fireball`, `dash-fireball`.
- Missing poses fall back to the skin's `idle` frame (so a skin with only
  `idle` still works).
- `proceduralSword` (default `true`): keep drawing the engine's glowing
  sword over the skin. Set `false` when the frames have weapons baked in.
- Fighters face right in source art; the engine mirrors with `scaleX(-1)`.
- Spin/tilt transforms (salto, swirl, dive-kick…) still apply on top, and
  all canvas effects (speed lines, impact flashes, SFX pops) stay on either
  way.
