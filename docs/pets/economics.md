# 2140 Pets Economics & Gameplay Systems

This document describes the economic and gameplay systems added in **Phase B** of the pet redesign.

## Currencies

There is one currency in the Pets economy:

| Currency | Source | Spent on | Storage |
|---|---|---|---|
| `sats` | Daily login bonus, daily missions, BAO rewards, battles | Shop items (food, toys, medicine, hygiene, energy), adoption, rerolls | kind 11125 `sats` tag |

`sats` are demo sats when `wallet_mode` is `demo-sats` and real BTC sats when `wallet_mode` is `btc-sats`. All breed categories share this balance. New Nostr pets start with `0` sats and must claim daily rewards to earn their first sats.

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
- **Real-sats earnings**: in `btc-sats` wallet mode, ₿AO trading rewards are real BTC sats credited to the profile `sats` tag; in `demo-sats` mode they are demo sats.
- **Trade-streak bonus**: consecutive days of BAO trading boost the next claim.
- **Market sense**: rare+ pets show trending-relay hints in the UI (visual only).

## ₿AO Rarity

BAO pets have one of five rarity tiers. Rarity is set at mint time from the selected `breed_asset` and stored in the `bao_rarity` tag.

| Tier | Drop weight | IDs | Stat cap bonus | BAO reward bonus |
|---|---|---|---|---|
| Common | 50% | bao-01 – bao-08 | +0 | +1,000 sats |
| Uncommon | 28% | bao-09 – bao-13 | +5 | +1,800 sats |
| Rare | 14% | bao-14 – bao-17 | +12 | +2,800 sats |
| Epic | 6% | bao-18 – bao-20 | +20 | +4,000 sats |
| Legendary | 2% | bao-21 | +30 | +5,000 sats |

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

## Shop Prices

Shop prices are denominated directly in sats, anchored to rough real-world USD equivalents (~$3 ≈ 5,000 sats). Examples:

| Item | Price (sats) | Approx. USD |
|---|---|---|
| Apple | 1,000 | ~$0.60 |
| Burger | 5,000 | ~$3.00 |
| Pizza | 5,000 | ~$3.00 |
| Cake | 7,500 | ~$4.50 |
| Health Elixir | 12,000 | ~$7.20 |

## Daily Quests

Each day the player receives 3 missions. Mission selection is seeded by date, pubkey, and active pet category. At least one mission (40% weighting) is drawn from the active category's pool.

Rewards are paid in `sats` (demo sats by default; real BTC sats once `btc-sats` wallet mode is enabled).

## Economy Safety Rules

- All currency values are non-negative integers.
- New Nostr pets start with `0` sats and must claim daily rewards to earn their first sats.
- `demo-sats` is the default wallet mode; `btc-sats` is gated by a feature flag while real-sats settlement is still being tested.
- Profile content JSON is the source of truth for BAO streaks.
- Kind 31124 tags remain the source of truth for pet state, rarity, and breeding cooldowns.
