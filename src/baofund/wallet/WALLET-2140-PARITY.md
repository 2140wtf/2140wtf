# Wallet parity with the 2140 wallet (mainnet)

The Fund wallet is the same Cashu stack as 2140 (`@cashu/cashu-ts` 2.9.0, NUT-04/05/06/11/15/16/27, NIP-60 storage, NIP-61 nutzaps — see `vendor/cashu-wallet`). This note tracks what was ported over from the 2140 wallet UI and the rules that keep it mainnet-only.

## Ported in this change

| Feature | Fund file | Source (2140) |
| --- | --- | --- |
| Sat preset ladder (`100 … 214k`, one-tap fill) | `src/wallet/SatsPresetPills.tsx` | `components/SatsPresetPills.tsx` |
| Token QR: static for small tokens, **NUT-16 animated UR fragments** for large ones (encoder imported **on demand** - see below), reduced-motion "next frame" control | `src/wallet/CashuTokenQr.tsx` | `components/CashuTokenQr.tsx` |
| Send flow shows the outgoing token as a QR + copy + raw token text | `src/wallet/WalletPanel.tsx` (`handleSend` block) | `components/CashuWalletTab.tsx` (Send tab) |
| Presets wired into Send and "Top up with Lightning" amount inputs | `src/wallet/WalletPanel.tsx` (`TopUpPanel`) | `components/CashuWalletTab.tsx` |
| Mint discovery (NIP-87): kind-38172 announcements + kind-38000 recommendations, global/follows scope, search, ranked list, add-to-wallet | `src/wallet/mintDiscovery.ts`, `src/wallet/MintDiscovery.tsx` | `pages/MintDiscoveryPage.tsx`, `hooks/useMintDiscovery.ts` |
| Wallet history: receive / send / Lightning top-up / Lightning payment, newest first, bounded to 200 entries | `src/wallet/walletHistory.ts`, `src/wallet/WalletHistory.tsx` | `components/CashuWalletTab.tsx` (history tab), `lib/cashu/storage.ts` |

Tests: `src/wallet/SatsPresetPills.test.tsx`, `src/wallet/CashuTokenQr.test.tsx` (jsdom, mocked NUT-16 encoder for the animated path — no camera or network needed). Wallet core suites (`cashuWallet.test.ts`, `useNip60Wallet`, `nip61.test.ts`, `cashuBackup.test.ts` via the vendor package) were already green and stay the regression net for the money paths.

The fund version renders QR frames with the existing `qrcode` dependency (SVG data-URL, the same renderer as `LightningInvoice`) instead of adding `qrcode.react`; NUT-16 animation comes from the vendored `CashuUrEncoder`. No new dependencies.

**NUT-16 import rule (learned in E2E).** The vendored barrel documents `nut16` as node-context-only: it pulls `@ngraveio/bc-ur`, whose browserified `util`/`assert` shims reference a bare `process` at evaluation time and blank the **dev** server with `process is not defined` (production tree-shook the shims, which is why the first build looked fine). `CashuTokenQr` therefore never imports it statically: the animate predicate is computed locally (`shouldAnimateToken`, byte cap + proof count via `decodeCashuToken`), the encoder is `import()`-ed only when a large token is actually displayed, and any failure degrades to a static QR (note shown) or, past QR capacity, to "copy the token text". Regression evidence: `npm run test:e2e` (dev server on :5175) — the app used to crash at first paint.

## Mint rules (enforced by config and tests)

- `src/wallet/mintConfig.ts`: primary mint is `VITE_BAO_MINT_URL`, fallback is a public **mainnet** mint (`https://mint.minibits.cash/Bitcoin`). Never a signet/regtest fallback — a test mint would make the wallet show real-looking but worthless ecash.
- **Owner decision 2026-09-21 (final): no signet Cashu wallet anywhere.** The hosted demo does NOT bake a test mint — `deploy/web/publish-web.sh` passes `VITE_BAO_MINT_URL` only when a caller sets it, and the code fallback is mainnet Minibits. A wrong/missing env can never point at a signet mint.
- The relay-hosted BAO mint (`relay.bao.network/cashu`) is signet and is only for markets CBANOS settlement tests; it must never become a Fund default. `loadStoredWallet` never opens on it: an empty legacy signet wallet is migrated to the mainnet fallback, and a funded one keeps its proofs in the mint map but is not the active mint (proofs are never destroyed).
- Public `https://` mints only (loopback HTTP allowed for local dev); max 8 mints, deduplicated and normalized.
- Multi-mint containment and removal safety: `src/wallet/MINT-SAFETY.md`.

## Ported items (owner ask 2026-09-21: "same wallet as 2140, same features")

- ~~**Mint info + independent audit panel**~~ **ported**: `MintDiscovery`'s
  per-mint **details** expander loads `/v1/info` and an audit.8333.space
  summary **on demand** (never for blocked test-network hosts) and renders
  name/version, MOTD, units/methods and supported NUTs; with the WS5 review
  composer it is the 2140 details panel. Files: `src/wallet/MintDiscovery.tsx`
  (+ `mintInfo.ts`/`mintAudit` helpers).
- ~~**Mint review publishing** (kind-38000 with the signed-in key)~~ **ported 2026-09-21 (WS5)**: the mint details expander has a star + text composer that signs a kind-38000 event with the signed-in identity, publishes it to the discovery relays (`publishMintRecommendation`) and echoes it locally (`upsertRecommendation`, no refetch). Addressable latest-wins via the `d` tag; a local once-per-mint + 5-minute cooldown guard prevents spam. Follows scope now shows only mints recommended by followed keys (announcement-only metadata is filtered out).
- ~~**Seed backup export UI**~~ **ported 2026-09-21 (WS4)**: `Wallet → Wallet backup` exports a password-encrypted `bao-fund-wallet-backup` JSON file (identity pubkey + NIP-60 wallet key + mints; nsec / seed phrase opt-in) and restores it through `applyImportedWalletKey` → the existing `restoreWalletForIdentity` flow. Files: `src/wallet/walletBackupFile.ts`, `WalletBackupPanel.tsx`. The relay-published `cashuBackup` (DPCS) API stays the cross-app sync path, not this file format.
- Camera scanning: **implemented without a dependency** via the native
  `BarcodeDetector` (`src/wallet/QrScanDialog.tsx` + `qrScan.ts`; scan
  buttons in the Wallet tab). Firefox/Safari lack `BarcodeDetector` and get
  the fail-closed fallback; adding `qr-scanner` remains an owner decision
  and can be swapped behind the injectable detector/decoder factory seams.

## Fund-specific testnet rails (beyond 2140 parity)

- **Created testnet wallets (2026-09-22/23):** users can create/import
  independent **testnet4** and **Liquid testnet** wallets in the browser
  (per-identity `railWalletStore`, words shown + re-revealable, forget
  confirmation-gated, encrypted-backup file carries them additively). The
  Liquid wallet receives confidential (`tlq1`) + unconfidential (`tex1`) and
  sends **blinded** outputs (confidential recipients supported; fail-closed
  when the zkp context is unavailable). Funding for tests: Liquid via
  `scripts/faucet-claim.mjs`, testnet4 via the tester-wallet transfer
  (`scripts/testnet4-fund-stage.ts --to`). Full detail:
  `docs/WALLET-RAILS-PORT-PLAN.md`.

## Verify

```sh
npm run lint && npx vitest run src/wallet && npm run verify-all
```
