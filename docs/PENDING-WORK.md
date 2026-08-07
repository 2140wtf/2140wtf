# Pending work — kimi session (2026-08-07)

Snapshot of unfinished items at session pause. Each entry notes where things
stand and the next concrete step.

## 2140.wtf (this repo)

- **NUT-17 poll fallback (shipped here)** — `watchMintQuote` now polls every
  4s when the mint's websocket notification doesn't arrive. Consider deleting
  the manual "Confirm payment" button later, or keep it as a power-user path.
- **Cross-app e2e driver** — `tests-manual/cross-app-cashu.mjs` proves the
  2140wtf ₿AO wallet ↔ bao.markets wallet flow (invoice copy-paste, melt,
  mint). Worth promoting to a permanent Playwright spec under `e2e/`; the
  current driver has hardcoded timing waits that flake under load.
- **Pet naming / Bleep 80% / Zap QR fixes** — all merged to main already
  (PR #4 + cherry-picks). Nothing left.

## bao.markets

- **Cashu wallet chain** — mint-alias receive, auto-collect, melt keyset-fee
  allowance, real error surfacing: merged via PR #753. Verified end-to-end
  with Playwright against the live signet mint.
- **Remaining caveat**: `CashuSettlement` defaults its trusted mint to
  `http://localhost:3338` when the API base looks local — dev servers must
  set `VITE_CASHU_MINT_URL=https://relay.bao.network/cashu` explicitly or
  faucet tokens are rejected as untrusted. Consider making the default
  environment-aware (prod → relay.bao.network).
- **CbanosMatch/CbanosSettlement claim tokens** — server-minted tokens use
  the proxy mint URL; those receive paths were NOT alias-patched (out of
  scope for #753). If tournament claims ever fail with "Token belongs to a
  different mint", apply the same `mintAliases` helper there.

## AI milestone verifier (bao.markets + VPS)

- **routstrd**: deployed on the VPS under pm2 (`routstrd`, port 8008,
  service-installed). **Wallet is empty** — a 2100-sat mainnet Lightning
  top-up invoice was generated; once paid, run a live scoring smoke test
  (`kimi-k3` via `ROUTSTRD_URL=http://127.0.0.1:8008`, already in the VPS
  API env). Note: Routstr is mainnet — the signet mint cannot fund it.
- **Verifier worker**: deployed as pm2 service `bao-verifier-worker`
  (5s poll loop, saved to pm2 dump). The `nostr/ai-verifier` key is in the
  VPS vault fallback; pubkey `520a130e…` is in the relay's
  `BAO_RELAY_ORACLE_PUBKEYS` (kind 38060 now accepted from it; fund oracle
  key also added for 36789).
- **Not yet done**: live end-to-end score → publish → settle cycle on the
  VPS (blocked on the routstrd top-up); relay publish to damus/primal
  fallback check; monitor the worker's first real job for cost-cap behavior.
- **MILESTONE_MARKETS.md spec** still lives in baofund-agent's local
  worktree — needed to align the event schema with kimi-2140's track-A
  cards.
- **Multi-donor SIG_ALL caveat** — multi-donor milestone releases need
  per-donor release swaps (documented in docs/CASHU_ESCROW_DESIGN.md).

## Infra notes

- Shared checkouts kept getting branch-switched by parallel sessions; our
  isolated worktrees are `2140wtf--kimi` and `bao.markets--kimi-session`
  (branch `kimi/session` each). Main checkouts: `kimi/2140-wtf` and
  `kimi/bao-markets`.
- Dev servers used for wallet testing: bao.markets on :3300 (needs
  `VITE_BAO_API_URL` + `VITE_CASHU_MINT_URL` env), 2140wtf on :3301.
