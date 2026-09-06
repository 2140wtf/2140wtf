# Security Audit — Round 25 (2026-09-06)

**Focus:** Cashu token/proof parsing (`decodeCashuToken`, mint-URL policy, DM-content extraction) and HD/seed derivation hygiene (`deriveBaoCashuMnemonic`, `derivePetCashuMnemonic`).

**Tooling:** `fast-check` property campaigns (deterministic seed `20260906`), plus runtime ground-truth probes of the `@cashu/cashu-ts` encode/decode round-trip to constrain the fuzzing to inputs that can actually arrive on the wire.

## Findings fixed

### F-25-1: IPv4-mapped IPv6 bypasses the mint-URL blocklist (High — SSRF policy)
`isAllowedMintUrl` classified IPv6 hosts only against literal `::1`/`fc00::/7`/`fe80::/10` prefixes. A mint URL like `https://[::ffff:127.0.0.1]/` (or `::ffff:7f00:1`, `::ffff:a00:1`, `::ffff:c0a8:101`) bypassed the blocklist entirely while browsers **resolve it onto the IPv4 loopback/private stack**. Property P2 falsified the original guard immediately; a runtime probe confirmed the URL parser keeps these hosts in IPv6 form (`[::ffff:7f00:1]`), so the IPv4 classifier never saw them.

**Fix:** `mappedIpv4Of()` extracts the embedded IPv4 from `::ffff:a.b.c.d` and `::ffff:aabb:ccdd` forms; mapped hosts are classified by their IPv4 address against the private-range table.

### F-25-2: Domain names misclassified as IPv6 — public mints falsely rejected (Medium — availability)
The same prefix checks (`fc`/`fd`/`fe[89ab]`) ran against *domain names*: any mint whose hostname starts with those prefixes — e.g. **`fca.aa`**, `february.mint.example`, `fd-relay.example` — was silently rejected as "private". Found by property P4's counterexample `https://fca.aa`. My first repair attempt (`[a-z0-9]` hrp matcher) was falsified by P1 before it landed; the correct fix classifies by **host kind**: IPv6 rules apply only when the host contains `:`, dotted/integer hosts go through the IPv4 classifier (which sees every textual encoding because the URL parser canonicalizes first — integer `2130706433`, hex `0x7f000001`, octal `0177.0.0.1`, 2/3-part hybrids all canonicalize to dotted form).

### F-25-3: Uncapped proof-amount sums (Medium — financial integrity)
`decodeCashuToken` reduced proof amounts with **no overflow check**: individually valid proofs summing past 2^53−1 silently produced a **rounded, wrong** token amount. Fixed with `safeSumProofAmounts()` (fail-closed → entry dropped / token null). `getTokenAmount` (`cashuEscrow.ts`) got the same cross-entry guard (returns 0 instead of a corrupted credit). Note: the cashu-ts wire encoder caps integers, so this needs hand-crafted CBOR to exploit — but the decoder is the trust boundary, not the encoder.

### F-25-4: Pet seed derivation skipped input hygiene + zeroization (Low — defense in depth)
`derivePetCashuMnemonic` lacked the empty/length guards and `finally`-zeroization its sibling `deriveBaoCashuMnemonic` applies; mnemonic entropy and derived entropy lingered in the heap until GC. Parity applied.

## Audited clean

- **HD derivation core** (`deriveMasterKey`/`deriveNutzapKey`/`deriveNip60WalletKey`/`deriveBaoWalletKey`): HKDF-SHA256 with distinct domain-separation info strings per purpose, zeroized seeds in `finally`, bounded mnemonic input. No key cross-usage between protocols.
- **Mint SSRF basics:** HTTPS enforced, localhost/private IPv4 (all encodings) blocked, `MAX_TOKEN_LENGTH`/`MAX_PROOF_FIELD_LENGTH` bounds hold (P1/P6).
- **DM-content extraction** (`cashuRequests.ts`): totality and shape invariants hold on 5,000-input fuzz runs (P1–P6 of `cashuRequests.property.test.ts`); currently has no external callers (dead-but-exported — hardened anyway since it's public API).

## Test-environment honesty notes

- A first `v3Token` fixture faked V3 as JSON+base64 — cashu-ts rejected it ("Token version is not supported"); fixtures were rebuilt on the **real** `getEncodedToken` single-mint form, verified by probe. The raw-JSON V2 legacy path was disproven the same way, so P8 became token-shaped-garbage robustness (5,000 runs, always null).
- Hostile-field fuzzing initially included mutations the encoder itself refuses (`NaN`, `2^53`, numeric `C`) — the suite now documents the exact survivor set (`amount: 0`, `amount: '3'`, 4097-char `secret`, empty `C`, oversized `witness`) and pins that the decoder rejects all of them (P2).
- My P4 oracle initially flagged hex-like public domains (`0.aa`) as private — the property was corrected to canonical-host truth, which is precisely what exposed the real F-25-2 bug.

## Verification

- **1,916 tests** pass across 194 files (18 new property tests this round: 4 mint-URL, 6 requests, 8 decode)
- TypeScript, ESLint, production build, `npm audit`, secret-leak grep — all clean
