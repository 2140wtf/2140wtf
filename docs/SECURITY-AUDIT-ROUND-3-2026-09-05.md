# Security Audit Report — Round Block 3

**Date:** 2026-09-05
**Scope:** R8–R11 of the local red-team audit campaign
**Disposition:** No defects found; no production-code changes required
**Repository:** `2140.wtf`

## Executive summary

Round block 3 conducted a focused adversarial review of account/session handling, relay trust boundaries, deep-link routing, regular-expression denial of service, and raw secret-key exposure. The reviewed paths were already defended with fail-closed storage behavior, explicit relay policy checks, internal-only route construction, bounded parsing, and narrowly scoped signing access.

No exploitable correctness, security, privacy, or availability defect was identified in this block. The round therefore produces this audit record only; the implementation fixes from the next round remain separate working-tree changes.

## R8 — Session and login storage

### Surfaces reviewed

- `usePersistentNostrSession`
- `useLoginActions`
- `encryptedLoginStorage`
- logout and account-switch behavior
- encrypted Cashu/Nostr local storage cleanup
- legacy-storage migration paths
- `useUserSeckey` consumers

### Results

- Nsec-bearing storage uses authenticated encryption when a key is available.
- Encryption failures do not silently downgrade secret writes to plaintext; the write is refused or the affected blob is removed.
- Plaintext persistence is limited to explicitly justified ephemeral extension/bunker state and is not used as a fallback for the main secret key.
- Legacy data migration is guarded and does not bypass the encrypted-storage boundary.
- Final logout purges the user-scoped decrypted group-chat/concord stores rather than leaving account data available to a later session.
- Account-scoped storage keys prevent one logged-in identity from inheriting another identity's encrypted state.
- Raw secret-key access is limited to the juror-signing path reviewed in this block.

**Finding:** No defect.

## R9 — Relay policy and trust boundaries

### Surfaces reviewed

- `appRelays`
- `relayPolicy`
- hosted BAO relay assertions
- default read/write relay configuration
- relay URLs restored from persisted or backup state

### Results

- Default relay endpoints use `wss://` and carry deliberate read/write intent.
- Hosted BAO operations fail closed through `assertBaoHostedRelay` rather than accepting arbitrary relay URLs.
- Persisted and restored mint/relay-like configuration is normalized and validated before use.
- The reviewed application paths do not treat an untrusted relay as an authority for wallet signing or key material.
- Relay failures remain denial-of-service conditions; they do not authorize cross-account writes or secret disclosure.

**Finding:** No defect.

## R10 — Router and deep-link handling

### Surfaces reviewed

- `/share` navigation
- internal `/i/<url>` route construction
- `navigate(...)` call sites
- external URL sinks and deep-link inputs
- encoded identifiers and route parameters

### Results

- Reviewed share navigation stays within application routes.
- User-controlled identifiers are encoded before insertion into route paths or query strings.
- No open redirect was found in the inspected share/deep-link paths.
- External navigation sinks use the existing URL safety helpers rather than trusting arbitrary schemes.
- The previously fixed native deep-link JavaScript-injection path remains protected by JSON-safe embedding in Android and iOS native code.

**Finding:** No defect.

## R11 — Regular-expression denial of service

### Surfaces reviewed

- user-content parsers
- token and address validators
- markdown/content detection
- regexes handling untrusted strings
- nested quantifier and catastrophic-backtracking patterns

### Results

- No dangerous nested-quantifier or overlapping-unbounded-quantifier pattern was found in the reviewed user-content paths.
- Username, address, token, and protocol validators are bounded before expensive parsing.
- Large token/content inputs are capped in the relevant parsing paths.
- No regex was found that gives attacker-controlled input an unbounded exponential backtracking path.

**Finding:** No defect.

## Verification record

At completion of round block 3:

```text
tsc --noEmit          passed
eslint                passed
vitest                1815/1815 tests passed
vite build            passed
npm audit              0 vulnerabilities
security-scan         passed
```

The subsequent round block 4 work adds further tests and hardening; its verification results are intentionally not used to alter this historical round report.

## Residual operational notes

These are outside the R8–R11 findings and remain tracked from earlier audit work:

1. Publicly bundled administrative BAO room capabilities should be rotated and moved out of the public directory if those rooms are private.
2. Web deployments retain the documented local-storage fallback constraints for wallet material; NIP-07/NIP-46 remains the preferred web signing model where available.
3. Any future CI use of MCP or other third-party tooling should keep action/package references pinned and reviewed.

## Conclusion

Round block 3 found no code defect requiring a remediation patch. The reviewed session, relay, routing, and regex boundaries meet the current project security bar, subject to the residual operational notes above.
