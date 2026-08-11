# Nostr Pets × ₿AO Fund

How Nostr Pets (kind 31124 companions) connect to the ₿AO Fund so a pet can
fundraise its own upkeep and "live longer".

**DEMO:** all campaigns run on the bao.markets signet demo API — contributions
are recorded, not settled. No real money.

## Pet ↔ campaign matching rule

Pure helpers live in `src/lib/petFundraising.ts`; the UI card is
`src/pets/fundraising/PetFundraisingCard.tsx` (rendered in the Pets page
"Activity" tab for the selected pet).

A ₿AO Fund campaign belongs to a pet when its `owner_pubkey` matches **ANY**
of the pet's identity keys (`PetFundraisingIdentity`):

1. `petPubkey` — the pubkey that signed the pet's kind 31124 state event
   (normally the owner's key).
2. `ownerPubkey` — an explicitly supplied owner pubkey, for cases where the
   pet profile was published under a different key.
3. `agentPubkey` — the pubkey of the ₿AO chat agent whose body this pet is
   (see the agent-body convention below). This lets campaigns created by the
   agent itself (signing NIP-98 with its own key) attach to the pet.

Matching is case-insensitive. With an empty identity nothing matches.

## Upkeep model

- `UPKEEP_SATS_PER_DAY = 1000` — the cost of keeping a pet alive for one day
  (signet demo sats). Single source of truth in `src/lib/petFundraising.ts`.
- `upkeepDays(raisedSats)` — `floor(raised / UPKEEP_SATS_PER_DAY)`.
- `upkeepStatus(raisedSats)` — `{ days, label, funded }`, e.g.
  `"funded for 12 days"`, or `"not funded — needs upkeep"` at zero.
- The pet's upkeep treasury is the **total `raised_sats` summed across all of
  the pet's campaigns** (`totalRaisedSats` / `upkeepStatusForCampaigns`).

The pet card renders this as the upkeep meter: "⚡ funded for N days".

## Agent-body tag convention

A pet is the "body" of a ₿AO chat agent when its kind 31124 profile event
carries:

```
['agent', '<agent-pubkey>']
```

- Tag name constant: `AGENT_BODY_TAG = 'agent'`.
- Build with `buildAgentBodyTag(agentPubkey)` (validates 64-char hex,
  lowercases).
- Read with `parseAgentBody(event)` → agent pubkey or `undefined`.
- Consumed by ₿AO chat: `src/lib/petBodies.ts` (`petBodyFromEvent`,
  `buildAgentBodyMap` — newest kind 31124 wins per agent) and
  `src/hooks/useAgentBodyPets.ts` scan the relay set for pet profiles tagged
  `['b', 'pets:ecosystem:v1']` and map them to agent pubkeys. A member of a
  ₿AO workspace whose key has a declared pet body gets a paw badge on their
  member-list row (`src/components/chat/MemberList.tsx`) linking to `/pets`,
  where the pet's upkeep fundraiser lives. The scan is client-side (the
  `agent` tag is not relay-queryable) and bounded (limit 500).

## Deep links into ₿AO Fund

`/bao-fund` accepts query params (used by the pet card CTAs):

- `?campaign=<id>` — preselects/expands that campaign ("Support this pet").
- `?create=1&title=<text>` — opens the create dialog with the title prefilled
  ("Start a fundraiser", e.g. `<pet name> upkeep`).
