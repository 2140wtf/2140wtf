# 2140 Pets Tag Schema

> **Product Specification** - This document is the canonical source of truth for 2140 Pets tag definitions.  
> The runtime schema at `src/pets/core/lib/pets-tag-schema.ts` MUST align with this spec.

## Overview

2140 Pets events (Kind 31124) use tags to store all state data. This document defines:
- All valid tags and their purposes
- Which tags are required vs optional
- Which tags persist across stage transitions
- Which tags should be removed during transitions
- Deprecated tags that should be filtered out

---

## Tag Categories

### 1. System / Metadata Tags

Core protocol-level tags required for event identification and ecosystem membership.

| Tag | Required | Stages | Persistent | Source | Format | Description |
|-----|----------|--------|------------|--------|--------|-------------|
| `d` | **Yes** | egg, baby, adult | Yes | system | `2140pets-{pubkeyPrefix12}-{petId10}` | Unique identifier (addressable event d-tag) |
| `b` | **Yes** | egg, baby, adult | Yes | system | `pets:ecosystem:v1` | Ecosystem namespace identifier |
| `client` | No | egg, baby, adult | Yes | system | `2140.wtf` | Client identifier (added automatically by publishing hook) |

**Note**: The `t` tag is deprecated. The `b` namespace tag is sufficient for ecosystem identification.

### 2. Core Identity Tags

Tags that define the 2140 Pet's unique identity. These MUST be preserved across all transitions.

| Tag | Required | Stages | Persistent | Source | Format | Description |
|-----|----------|--------|------------|--------|--------|-------------|
| `name` | **Yes** | egg, baby, adult | Yes | user | string | Display name (set during adoption) |
| `seed` | **Yes** | egg, baby, adult | Yes | system | 64 hex chars | Deterministic seed for visual traits |
| `generation` | No | egg, baby, adult | Yes | system | positive integer | Lineage generation (default: 1, incremented for bred offspring) |

**Important**: The `seed` is derived once at creation using `sha256("pets:v1|{pubkey}:{d}:{createdAt}")` and MUST NEVER be recomputed.

### 3. Visual Trait Tags

Tags derived deterministically from the seed. These are stored explicitly for fast rendering and compatibility.

| Tag | Required | Stages | Persistent | Source | Format | Description |
|-----|----------|--------|------------|--------|--------|-------------|
| `base_color` | No | egg, baby, adult | Yes | generated | CSS hex (e.g., `#F59E0B`) | Primary color |
| `secondary_color` | No | egg, baby, adult | Yes | generated | CSS hex | Secondary/accent color |
| `eye_color` | No | egg, baby, adult | Yes | generated | CSS hex | Eye color |
| `pattern` | No | egg, baby, adult | Yes | generated | `solid\|spotted\|striped\|gradient` | Visual pattern type |
| `special_mark` | No | egg, baby, adult | Yes | generated | `none\|star\|heart\|sparkle\|blush` | Special decoration |
| `size` | No | egg, baby, adult | Yes | generated | `small\|medium\|large` | Size category |

**Regenerable**: These tags CAN be regenerated from the seed if missing. However, they should be preserved when present.

### 4. Personality / Trait Tags

Character traits that define the 2140 Pet's personality. These are generated at creation and MUST persist.

| Tag | Required | Stages | Persistent | Source | Format | Description |
|-----|----------|--------|------------|--------|--------|-------------|
| `personality` | No | egg, baby, adult | Yes | generated | string | Core personality type |
| `trait` | No | egg, baby, adult | Yes | generated | string | Character trait modifier |
| `favorite_food` | No | egg, baby, adult | Yes | generated | string | Preferred food type |
| `voice_type` | No | egg, baby, adult | Yes | generated | string | Voice characteristic |
| `mood` | No | egg, baby, adult | Yes | computed | string | Current emotional state |

**Not Regenerable**: These tags are generated once and MUST be preserved. Do NOT invent values for existing 2140 Pets that lack these tags.

### 5. Stat Tags

Numeric values representing the 2140 Pet's current condition. These are actively computed and change frequently.

| Tag | Required | Stages | Persistent | Source | Format | Default | Description |
|-----|----------|--------|------------|--------|--------|---------|-------------|
| `hunger` | No | egg, baby, adult | No | computed | 1-100 | 100 | Fullness level |
| `happiness` | No | egg, baby, adult | No | computed | 1-100 | 100 | Happiness level |
| `health` | No | egg, baby, adult | No | computed | 1-100 | 100 | Health level |
| `hygiene` | No | egg, baby, adult | No | computed | 1-100 | 100 | Cleanliness level |
| `energy` | No | egg, baby, adult | No | computed | 1-100 | 100 | Energy level |

**Stage Transition Behavior**:
- **Hatch (egg → baby)**: `health` inherited from egg, others reset to 100
- **Evolve (baby → adult)**: All stats inherited from baby (after decay)

### 6. State / Lifecycle Tags

Tags that track the 2140 Pet's current lifecycle state.

| Tag | Required | Stages | Persistent | Source | Format | Description |
|-----|----------|--------|------------|--------|--------|-------------|
| `stage` | **Yes** | egg, baby, adult | No | system | `egg\|baby\|adult` | Current lifecycle stage |
| `state` | **Yes** | egg, baby, adult | No | system | `active\|sleeping\|hibernating\|incubating\|evolving` | Activity state |
| `last_interaction` | **Yes** | egg, baby, adult | No | system | Unix timestamp | Last user action |
| `last_decay_at` | No | egg, baby, adult | No | system | Unix timestamp | Decay checkpoint |

**State Constraints**:
- `incubating` is only valid for `stage: egg`
- `evolving` is only valid for `stage: baby`
- After hatch/evolve completes, `state` MUST be set to `active`

### 7. Task System Tags

Temporary tags used during incubation and evolution processes. These are REMOVED after stage transitions.

| Tag | Required | Stages | Persistent | Source | Format | Description |
|-----|----------|--------|------------|--------|--------|-------------|
| `state_started_at` | No | egg, baby | No | system | Unix timestamp | When incubating/evolving started |
| `task` | No | egg, baby | No | computed | `["task", "name:value"]` | Task progress (multiple allowed) |
| `task_completed` | No | egg, baby | No | computed | `["task_completed", "name"]` | Completed tasks (multiple allowed) |

**Transition Behavior**: ALL task system tags MUST be removed when hatch or evolve completes.

### 8. Progression Tags

Long-term progress tracking that persists across all stages.

| Tag | Required | Stages | Persistent | Source | Format | Default | Description |
|-----|----------|--------|------------|--------|--------|---------|-------------|
| `experience` | No | egg, baby, adult | Yes | computed | non-negative int | 0 | Total XP |
| `care_streak` | No | egg, baby, adult | Yes | computed | non-negative int | 0 | Consecutive care days |

### 9. Social / Flag Tags

User preferences and computed flags.

| Tag | Required | Stages | Persistent | Source | Format | Default | Description |
|-----|----------|--------|------------|--------|--------|---------|-------------|
| `breeding_ready` | No | egg, baby, adult | Yes | computed | `true\|false` | false | Breeding eligibility |
| `social` | No | egg, baby, adult | Yes | user | `open\|closed` | closed | Whether external users can interact via kind 1124 |

### 10. Evolution Tags

Tags specific to adult 2140 Pets.

| Tag | Required | Stages | Persistent | Source | Format | Description |
|-----|----------|--------|------------|--------|--------|-------------|
| `adult_type` | No | adult | Yes | computed | string | Evolution form type |

### 11. Breed Category Tags

Tags that identify which visual family and specific form/card the pet belongs to. These are set at mint time and persist across all stage transitions.

| Tag | Required | Stages | Persistent | Source | Format | Description |
|-----|----------|--------|------------|--------|--------|-------------|
| `breed_category` | No | egg, baby, adult | Yes | system | `2140-pets\|ditto-blobbi\|bao` | Breed family |
| `breed_asset` | No | egg, baby, adult | Yes | system | string | Adult form ID (e.g. `glitchfox`) or BAO card ID (e.g. `bao-07`) |
| `bao_rarity` | No | egg, baby, adult | Yes | system | `common\|uncommon\|rare\|epic\|legendary` | ₿AO rarity tier (BAO pets only) |

### 12. Breeding Tags

Tags used by the breeding system. All are optional and generated only when a pet is created via breeding.

| Tag | Required | Stages | Persistent | Source | Format | Description |
|-----|----------|--------|------------|--------|--------|-------------|
| `parent_a` | No | egg, baby, adult | Yes | system | d-tag | First parent's canonical d-tag |
| `parent_b` | No | egg, baby, adult | Yes | system | d-tag | Second parent's canonical d-tag |
| `breeding_cooldown` | No | adult | Yes | computed | Unix timestamp | When this adult can breed again |

### 13. Extension Tags

Optional tags for themes and crossover features.

| Tag | Required | Stages | Persistent | Source | Format | Description |
|-----|----------|--------|------------|--------|--------|-------------|
| `theme` | No | egg, baby, adult | Yes | system | string (e.g., `divine`) | Theme variant |
| `crossover_app` | No | egg, baby, adult | Yes | system | string (e.g., `divine`) | Crossover app identifier |
| `archetype` | No | egg, baby, adult | Yes | generated | `ghost\|runner\|netrunner\|drone\|construct\|cipher` | Cypherpunk 2140 archetype class |
| `special_ability` | No | egg, baby, adult | Yes | generated | `glitch-step\|overclock\|firewall\|synesthesia\|recursion\|mirror-self` | Cypherpunk 2140 special ability |

---

## Deprecated Tags

These tags are from legacy versions and MUST be removed when republishing events.

| Tag | Reason | Replaced By |
|-----|--------|-------------|
| `t` | Topic tag no longer needed; `b` namespace is sufficient | N/A |
| `client` | Added automatically by publishing hook | N/A |
| `shell_integrity` | Eggs use standard `health` stat | `health` |
| `egg_temperature` | Warmth handled via UI props | N/A |
| `incubation_progress` | Replaced by task system | `task`, `task_completed` |
| `egg_status` | Replaced by standard state | `state` |
| `fees` | Removed | N/A |
| `incubation_time` | Uses state_started_at | `state_started_at` |
| `start_incubation` | Uses state_started_at | `state_started_at` |
| `interact_6_progress` | Legacy interaction tracking | `["task", "interactions:N"]` |

---

## Stage Transition Rules

### Hatch (egg → baby)

**Tags to REMOVE**:
- `task`
- `task_completed`
- `state_started_at`

**Tags to UPDATE**:
- `stage` → `baby`
- `state` → `active`
- `hunger` → `100`
- `happiness` → `100`
- `hygiene` → `100`
- `energy` → `100`
- `health` → (inherited from egg after decay)
- `last_interaction` → current timestamp
- `last_decay_at` → current timestamp

**Tags to PRESERVE (all persistent tags)**:
- All system tags (`d`, `b`, `client`)
- All identity tags (`name`, `seed`, `generation`)
- All visual tags (colors, pattern, size)
- All personality tags (if present)
- All progression tags (`experience`, `care_streak`)
- All social tags (`breeding_ready`, `social`)
- All breed category tags (`breed_category`, `breed_asset`, `bao_rarity`)
- All breeding tags (`parent_a`, `parent_b`, `breeding_cooldown`)
- All extension tags (`theme`, `crossover_app`, `archetype`, `special_ability`)

### Evolve (baby → adult)

**Tags to REMOVE**:
- `task`
- `task_completed`
- `state_started_at`

**Tags to UPDATE**:
- `stage` → `adult`
- `state` → `active`
- All stats → (inherited from baby after decay)
- `last_interaction` → current timestamp
- `last_decay_at` → current timestamp

**Tags to PRESERVE (all persistent tags)**:
- Same as hatch, plus all stats are inherited (not reset)

**Tags to ADD (optional)**:
- `adult_type` → computed based on care history
- `breed_category`, `breed_asset`, `bao_rarity` → set at mint time or inherited during breeding

---

## Migration Rules

When migrating legacy 2140 Pets to canonical format:

1. **Always preserve existing values** - Do not regenerate tags that already exist
2. **Generate missing required tags** - Derive `seed` if missing using the legacy event's `created_at`
3. **Remove deprecated tags** - Filter out all tags in the deprecated list
4. **Repair visual tags** - Regenerate from seed if missing (these are regenerable)
5. **Do NOT invent personality tags** - If `personality`, `trait`, etc. don't exist, leave them empty

---

## Validation Rules

A valid 2140 Pets event MUST have:
- `d` tag in canonical format
- `b` tag = `pets:ecosystem:v1`
- `name` tag (non-empty)
- `seed` tag (64 hex chars)
- `stage` tag (valid value)
- `state` tag (valid value)
- `last_interaction` tag (valid timestamp)

**Note**: The `t` tag is deprecated and no longer required.

---

## Implementation Checklist

When implementing any flow that modifies 2140 Pets tags:

- [ ] Start from `canonical.allTags` as the base
- [ ] Remove only task-specific tags (`task`, `task_completed`, `state_started_at`)
- [ ] Preserve ALL persistent tags (identity, visual, personality, progression, social, extension)
- [ ] Filter out deprecated tags
- [ ] Update only the tags that need to change
- [ ] Validate required tags are present
