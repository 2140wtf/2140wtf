# 2140 Pets Economics & Gameplay Systems

This document describes the economic and gameplay systems added in **Phase B** of the pet redesign.

## Currencies

There are four currencies in the Pets economy:

| Currency | Source | Spent on | Storage |
|---|---|---|---|
| `coins` | Daily login bonus, daily missions, BAO rewards, battles | Shop items (food, toys, medicine, hygiene, energy) | kind 11125 `coins` tag |
| `runes` | 2140 category daily quests | 2140-specific items, relay-routing boosts | kind 11125 `content.runes` |
| `sats` | ₿AO category daily quests, BAO trading rewards, 2140 daylight netrunning bonus | ₿AO-specific items, market tonics | kind 11125 `sats` tag |
| `seeds` | Ditto Blobbi category daily quests | Ditto Blobbi-specific items, growth serums | kind 11125 `content.seeds` |

All category currencies default to `0` when missing from a profile.

## Category Abilities

Each breed category has passive abilities that modify decay, sats gain, and mission progress.

### Ditto Blobbi — Natural Growth

- **Generalist care boost**: happiness decay is 15% slower.
- **Steady growth**: base stat cap increased by 5.

### 2140 Pets — Netrunning

- **Netrunning**: daily quest tally progress counts as +20% (rounded down).
- **Encryption shield**: health penalties from missed care are 30% shorter/less severe.
- **Daylight netrunning**: +10% sats from care and missions during local daylight hours (06:00–18:00).
- **Social decryption**: reserved for future feed integration.

### ₿AO Pets — Market Born

- **Reward bonus**: flat sat bonus added to daily BAO claims based on rarity.
- **Trade-streak bonus**: consecutive days of BAO trading boost the next claim.
- **Market sense**: rare+ pets show trending-relay hints in the UI (visual only).

## ₿AO Rarity

BAO pets have one of five rarity tiers. Rarity is set at mint time from the selected `breed_asset` and stored in the `bao_rarity` tag.

| Tier | Drop weight | IDs | Stat cap bonus | BAO reward bonus |
|---|---|---|---|---|
| Common | 50% | bao-01 – bao-08 | +0 | +10 sats |
| Uncommon | 28% | bao-09 – bao-13 | +5 | +18 sats |
| Rare | 14% | bao-14 – bao-17 | +12 | +28 sats |
| Epic | 6% | bao-18 – bao-20 | +20 | +40 sats |
| Legendary | 2% | bao-21 | +30 | +50 sats |

Rarity affects:
- Effective stat cap used by item/direct-action calculations.
- Flat bonus added to `calculateBaoReward` when the active pet is a BAO.
- Visual aura overlay for legendary pets.

## BAO Trade Streak

The profile tracks consecutive days with BAO trading activity:

- `baoTradeStreak` — number of consecutive days with at least one BAO trade.
- `baoTradeStreakLastDay` — local day string (`YYYY-MM-DD`) of the last streak update.

The streak increments when a new trade occurs on the next local day, resets if a day is missed, and is used by ₿AO evolution missions and reward calculations.

## Breeding Economics

### Compatibility

| Pairing | Success chance | Cooldown |
|---|---|---|
| Same category | 80% | 48h |
| Cross-category | 25% (hybrid egg) | 72h |

Both parents must be adult and `breeding_ready === true`.

### Inheritance

- **Category**: 70% dominant parent, 30% recessive parent.
- **Form**: 50/50 within category; cross-category uses the category form table.
- **Rarity**: roll per parent, take higher, then 5% chance of +1 tier. Legendary × Legendary guarantees Epic+.
- **Colors**: OKLch interpolation between parent palettes.
- **Generation**: `max(parent.generation) + 1`.

### Cooldown Elixirs

Three shop items halve the remaining breeding cooldown once per pet per week:

- `elixir_overclock` — 2140 Pets
- `elixir_market` — ₿AO Pets
- `elixir_growth` — Ditto Blobbi

## Daily Quests

Each day the player receives 3 missions. Mission selection is seeded by date, pubkey, and active pet category. At least one mission (40% weighting) is drawn from the active category's pool.

Rewards include coins, sats, and the matching category currency.

## Economy Safety Rules

- All currency values are non-negative integers.
- Profile content JSON is the source of truth for category currencies and BAO streaks.
- Kind 31124 tags remain the source of truth for pet state, rarity, and breeding cooldowns.
