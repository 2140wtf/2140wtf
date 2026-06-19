# Cashu NIP-60 / NIP-61 Implementation Plan

> Goal: bring `2140wtf` to parity with the Freedom ID reference implementation.
> Replace the DPCS `kind:30078` blob with standard NIP-60 events, keep DPCS as an
> optional encrypted fallback, and implement real NIP-61 Nutzap send/receive.
>
> Updated after Freedom ID proved this exact scope end-to-end.

## Reference implementation

Freedom ID (pre-MVP mockup) now has:

- `/home/bob/Documents/nostrified-mockup/src/utils/cashuNip60.ts`
  - `Nip60Signer` abstraction (NIP-44 encrypt/decrypt + event signing).
  - `Nip60SyncApi` adapter (`signer`, `publish`, `query`, `relays`).
  - `buildWalletConfigEvent`, `buildTokenEvent`, `buildDeletionEvent`,
    `buildHistoryEvent`.
  - `buildNutzapInfoEvent`, `buildNutzapEvent`,
    `buildNutzapRedemptionHistoryEvent`, `parseNutzapEvent`.
  - `restoreNip60Wallet(walletSigner, configSigner, queryFn)`.
  - Encrypted localStorage helpers for last event id/hash/config hash/Nutzap info hash.
- `/home/bob/Documents/nostrified-mockup/src/utils/cashu.ts`
  - `deriveNip60WalletKey(seedPhrase)` → deterministic secp256k1 keypair for
    P2PK / Nutzaps.
- `/home/bob/Documents/nostrified-mockup/src/contexts/NostrContext.tsx`
  - `getNip60Signer()` exposing identity-based NIP-44 self-encryption and signing.
  - `subscribeNutzaps(mintUrls, onEvent)` monitoring `kind:9321` by `#p` + `#u`.
- `/home/bob/Documents/nostrified-mockup/src/hooks/useCashuWallet.ts`
  - Derives NIP-60 wallet key on seed unlock.
  - Accepts `Nip60SyncApi` and runs NIP-60 restore/convergence on startup.
  - Publishes `kind:17375` wallet config and `kind:10019` Nutzap info whenever
    mints/relays change.
  - After every proof-mutating operation (`send`, `receive`, `mint`, `melt`):
    new `kind:7375` token event with `del: [oldEventId]`, `kind:5` deletion of
    the old event, and `kind:7376` history event.
  - Exposes `sendNutzap`, `receiveNutzap`, and `nutzaps` state.
- `/home/bob/Documents/nostrified-mockup/src/FreedomIDPage.tsx`
  - Builds `nip60Sync` from `getNip60Signer`, `publish`, `query`, and default relays.
  - Subscribes incoming Nutzaps to `receiveNutzap`.

The same architecture should work in `2140wtf`.

---

## Target event model

```
Nostr relays
├── kind:17375  wallet config     (NIP-44 encrypted: wallet privkey + mint list)
├── kind:7375   token events      (NIP-44 encrypted: unspent proofs per mint)
├── kind:7376   history events    (NIP-44 encrypted: in/out audit log)
├── kind:5      deletions         (public: delete spent token events)
├── kind:10019  nutzap info       (public, opt-in: mints/relays/P2PK pubkey)
├── kind:9321   nutzap payments   (public: P2PK-locked proofs to recipient)
└── kind:30078  DPCS fallback     (encrypted: full wallet snapshot)
```

Local encrypted storage is the source of truth for spending. Relays are used
only for restore and multi-device convergence.

---

## Files to create / modify

### 1. `src/lib/cashu/cashuNip60.ts` (new)

Port the Freedom ID module. Required exports:

- Constants: `WALLET_CONFIG_KIND = 17375`, `TOKEN_KIND = 7375`,
  `HISTORY_KIND = 7376`, `DELETE_KIND = 5`, `NUTZAP_INFO_KIND = 10019`,
  `NUTZAP_KIND = 9321`.
- `Nip60Signer` interface.
- `Nip60SyncApi` interface (`signer`, `publish`, `query`, `relays`).
- `createNip60Signer(privkey: Uint8Array): Nip60Signer`.
- `buildWalletConfigPayload(walletPrivkey, mints)`.
- `buildWalletConfigEvent(payload, identitySigner)`.
- `parseWalletConfigEvent(event, identitySigner)`.
- `buildTokenEvent(mintUrl, proofs, walletSigner, delEventIds?)`.
- `parseTokenEvent(event, walletSigner)`.
- `buildDeletionEvent(eventIds, walletSigner, reason?)`.
- `buildHistoryEvent(direction, amount, mintUrl, walletSigner, referencedEvents?)`.
- `buildNutzapInfoEvent(mints, relays, walletPubkey, identitySigner)`.
- `buildNutzapEvent(recipientPubkey, mintUrl, proofs, identitySigner, opts?)`.
- `parseNutzapEvent(event)`.
- `buildNutzapRedemptionHistoryEvent(amount, mintUrl, nutzapEventId, senderPubkey, createdTokenEventId, walletSigner)`.
- `restoreNip60Wallet(walletSigner, configSigner, queryFn)`.
- `computeContentHash(payload)` and encrypted last-event/hash helpers.

### 2. `src/lib/cashu/cashu.ts` (modify)

Add:

```ts
export function deriveNip60WalletKey(seedPhrase: string): { privkey: Uint8Array; pubkey: string }
```

Use HKDF-SHA256 with a domain info string distinct from any Nutzap key, e.g.
`ditto:cashu:walletkey:v1`.

### 3. `src/contexts/NostrContext.tsx` (modify)

- Add `getNip60Signer()` to context value. It should return an object with
  `pubkey`, `nip44Encrypt`, `nip44Decrypt`, and `signEvent` using the user's
  Nostr identity key.
- Add `subscribeNutzaps(mintUrls, onEvent)` that subscribes to `kind:9321`
  events `#p` the identity pubkey and `#u` the user's trusted mint URLs.

### 4. `src/hooks/useCashuWallet.ts` (modify)

- Accept an optional `nip60Sync?: Nip60SyncApi` argument.
- On seed init:
  1. Derive `nip60WalletKey` from seed via `deriveNip60WalletKey`.
  2. Run `restoreNip60Wallet` once (merge remote proofs only when local store
     is empty, keep local state authoritative).
  3. Publish `kind:17375` wallet config.
  4. Sync all `kind:7375` token events.
  5. Publish `kind:10019` Nutzap info.
- After every proof mutation (`sendToken`, `receiveToken`, `mintFromQuote`,
  `payInvoice` / melt):
  1. Build new `kind:7375` for affected mint with remaining proofs and
     `del: [lastTokenEventId]`.
  2. Publish the new token event.
  3. Publish `kind:5` deletion of the old token event id.
  4. Publish `kind:7376` history event referencing created/destroyed token ids.
- On mint list changes, re-publish `kind:17375` and `kind:10019`.
- Add `sendNutzap(amount, recipientIdentityPubkey, mintUrl, opts?)`:
  - Lock proofs to `02${recipientWalletPubkey}` where the recipient wallet
    pubkey comes from their `kind:10019`.
  - Use `CashuWallet.send(amount, proofs, { pubkey: lockPubkey, includeDleq: true })`.
  - Save change, record transaction, sync NIP-60 token, publish `kind:9321`.
- Add `receiveNutzap(event)`:
  - Parse, verify `p` tag matches identity pubkey.
  - Receive the locked token with `wallet.receive(token, { privkey: walletPrivkeyHex, requireDleq: true })`.
  - Save proofs, record transaction, sync NIP-60 token, publish redemption
    `kind:7376` with public `e` + `p` tags.
- Add `nutzaps: Event[]` state and a processed-ids guard to avoid double redeem.

### 5. Wallet page / tab (modify)

- Build `nip60Sync` with `getNip60Signer`, `publish`, `query`, and relays.
- Pass it to `useCashuWallet`.
- Subscribe incoming Nutzaps: `subscribeNutzaps(mintUrls, receiveNutzap)`.
- Add UI for sending Nutzaps (recipient npub/nprofile, amount, mint selector).
- Keep `kind:10019` opt-in and explain the public nature clearly.

### 6. `src/lib/cashu/cashuBackup.ts` (modify)

- Keep writing the encrypted `kind:30078` DPCS snapshot as a **seed-based fallback**.
- Remove DPCS from the restore-first path; call it only when NIP-60 events are
  missing or incomplete.

### 7. `src/lib/kindLabels.ts` (modify)

Add labels for `17375`, `7375`, `7376`, `9321`, `10019`.

### 8. `NIP.md` (modify)

- Document the NIP-60 event kinds used.
- Document that DPCS (`kind:30078`) is now a fallback, not primary state.
- Document NIP-61 send/receive flow.
- Correct any claim that the opaque DPCS d-tag “reveals nothing”.

---

## Implementation order

1. `deriveNip60WalletKey()` + `cashuNip60.ts` builders + `getNip60Signer()`.
2. Wire `Nip60SyncApi` into `useCashuWallet`; publish `kind:17375` on mint changes.
3. Token rollover: `kind:7375` + `del` + `kind:5` deletion after every spend/receive.
4. `kind:7376` history events.
5. NIP-60 restore path (NIP-60 first, DPCS fallback).
6. `kind:10019` Nutzap info publish + `subscribeNutzaps`.
7. `receiveNutzap` + redemption history.
8. `sendNutzap` + UI flow.
9. Tests, lint, bug hunter, docs.
10. NIP-87 mint discovery (future phase, not required for parity).

---

## Tests

New / updated tests:

- `src/lib/cashu/cashuNip60.test.ts`
  - Wallet config encrypt/decrypt round-trip.
  - Token event build/parse.
  - Proof rollover produces correct `del` array and deletion event.
  - Nutzap info/event build/parse.
- `src/hooks/useCashuWallet.test.ts`
  - Cross-device spend race converges to same unspent set.
  - Restore rejects stale backup and preserves local state.
- `src/hooks/useNutzapReceiver.test.tsx` / sender tests
  - Receive and redeem a mocked `kind:9321`.
  - Build a `kind:9321` locked to a recipient pubkey.

## Bug hunting / release gates

Run the same gates Freedom ID passes:

```bash
cd /home/bob/Documents/2140wtf/2140wtf
npm run typecheck        # or equivalent
npm run test
node scripts/bug-hunter-deep.mjs   # port from Freedom ID if missing
node scripts/prod-audit.mjs
node scripts/check-licenses.mjs
node scripts/validate-env.mjs
node scripts/smoke-test.mjs        # with dev server on 127.0.0.1:5173
node scripts/e2e-smoke.mjs
npm run prod-check
bash scripts/android-debug-build.sh
```

If the repo lacks these scripts, port them from:

- `/home/bob/Documents/nostrified-mockup/scripts/bug-hunter-deep.mjs`
- `/home/bob/Documents/nostrified-mockup/scripts/prod-audit.mjs`
- `/home/bob/Documents/nostrified-mockup/scripts/check-licenses.mjs`
- `/home/bob/Documents/nostrified-mockup/scripts/validate-env.mjs`
- `/home/bob/Documents/nostrified-mockup/scripts/smoke-test.mjs`
- `/home/bob/Documents/nostrified-mockup/scripts/e2e-smoke.mjs`
- `/home/bob/Documents/nostrified-mockup/scripts/release-check.mjs`
- `/home/bob/Documents/nostrified-mockup/scripts/android-debug-build.sh`

---

## Critical rules

- **Local storage is source of truth.** Relay events are only for restore and
  convergence.
- **Never skip token rollover.** Every spend must publish a new `kind:7375`
  with remaining proofs and delete/replace the old one.
- **P2PK lock prefix.** Nutzap proofs must be locked to `02` + the x-only wallet
  pubkey from the recipient's `kind:10019`.
- **Recipient identity check.** The `p` tag on a `kind:9321` is the recipient's
  Nostr identity pubkey, not the wallet pubkey.
- **Opt-in `kind:10019`.** It is public by design; only publish when the user
  enables Nutzaps.
- **DPCS fallback only.** Do not treat the old `kind:30078` blob as operational
  state.

---

## Risks to watch

- **Cross-device races:** the token-event rollover is the fix. Any spend path
  that skips it re-introduces double-spend risk.
- **Stale relay state:** only merge remote proofs when local store is empty or
  remote proofs are provably unspent; never overwrite newer local state.
- **Unbounded processed-id sets:** cap and prune old Nutzap / processed-token
  entries.
- **Replaceable events:** `kind:17375` is replaceable by kind+author. Use a
  content-hash guard to avoid republishing identical events.
