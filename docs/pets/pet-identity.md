# Pet Identity — per-pet npubs (research)

> Status: **study, not a decision.** Nothing here is implemented. Pet Secrets
> (kind 1125) deliberately encrypts between **owner** keys and addresses pets
> by `a`-tag coordinate, so it works today and migrates cleanly if pets ever
> get their own keys.

## The question

Should each pet have its own npub, instead of living only as data (kind 31124)
signed by its owner? The long-term vision needs it: pets that fundraise, speak
in ₿AO community chat as individuals, and eventually run as LLM agents with a
soul file and memory file on their own VPS environment.

## Options

### 1. Derive pet keys from the owner's nsec (deterministic child keys)

`petSecret = HKDF(owner_nsec, "pets:v1|<pet-d-tag>")` — mirrors the existing
deterministic `seed` used for visual traits.

- ✅ Regenerable anywhere, nothing to back up, stable identity per pet
- ❌ **Only works for nsec logins.** Browser extensions (NIP-07) and remote
  signers (NIP-46) never expose the private key, so the app cannot derive
  anything. A core pets feature that silently excludes extension/bunker users
  is a non-starter.
- ❌ Couples every pet to the owner key forever: rotating or losing the owner
  key invalidates all pet identities; rehoming a pet to a new owner is
  impossible without re-keying.
- ❌ If the app can derive pet keys from the owner nsec, so can any XSS that
  touches the nsec in localStorage — one leak, every pet compromised.

**Verdict: not recommended as the primary route.**

### 2. Independently generated pet keys with encrypted custody

At adoption (or first "awakening"), generate a fresh keypair per pet. The pet
nsec is stored NIP-44-encrypted **to the owner** (relay event or encrypted
local storage), so any signer type works — the owner key only ever encrypts.

- ✅ Works with NIP-07/NIP-46/nsec logins alike
- ✅ Pet identity survives owner-key rotation; a pet can be rehomed by
  handing over (re-encrypting) its key custody event
- ✅ Natural stepping stone to agents: custody moves from "encrypted blob the
  owner's client holds" to "a key living on the pet's own environment"
- ❌ Key material exists somewhere decryptable by the owner's signer — the
  app's threat model (XSS → key theft) extends to every pet key it can unwrap
- ❌ Custody UX is real work: backup, restore, device transfer, loss

**Verdict: the practical route when pet keys become necessary.**

### 3. NIP-26 delegation / owner-signed proxy

Pets never hold keys; the owner signs events carrying a pet `a` tag (status
quo), or issues NIP-26 delegation tokens to a session key.

- ✅ Zero new key management
- ❌ Pets are not addressable identities — no zaps to a pet, no DMs to a pet,
  no independent reputation; NIP-26 is also deprecated in practice
- ❌ Doesn't serve the fundraising/agent vision at all

**Verdict: fine for v1 features (this is what Pet Secrets does), not the end state.**

### 4. Pet keys as NIP-46 bunkers (the agent endgame)

The pet's nsec lives on the pet's own always-on environment (VPS, LLM agent),
exposed only as a NIP-46 remote signer. The owner's client connects as a
supervised session; the agent signs its own posts, chat messages, and
fundraising receipts within a permission policy.

- ✅ The only model where an LLM-powered pet can act 24/7 without the owner's
  keys (or the pet's keys) ever touching the browser
- ✅ Granular policy per pet (allowed kinds, rate limits, no zaps above X)
- ✅ Maps directly onto "soul file + memory file" agents
- ❌ Requires the agent infrastructure itself; the biggest build by far

**Verdict: the north star. Design custody (option 2) so keys can graduate here.**

## Recommended path

1. **Now** — Pet Secrets v1 (kind 1125): owner-key encryption, pet addressing
   by coordinate. No pet keys.
2. **When pets need to receive/spend independently** (zap-to-pet, pet DMs,
   pet-authored notes) — option 2: generated keys, NIP-44-encrypted custody to
   the owner, documented rotation/rehoming flow.
3. **When pets become agents** — option 4: move the pet key into a NIP-46
   bunker on the pet's environment; custody event becomes the recovery path.

## Open questions to resolve before any implementation

- Signer compatibility matrix: exactly which login types can support custody
  encryption (all support NIP-44 to self — verify per signer)
- Key-theft blast radius: one XSS unwraps owner *and* all pet keys — is
  custody-at-rest acceptable, or should pet keys only exist on demand?
- Rehoming: what does transferring a pet (and its key, history, and funds) to
  a new owner look like as a protocol flow?
- Sybil economics: if pets get identities, what stops pet-key farms? (WoT,
  adoption cost, caretaking history as reputation)
