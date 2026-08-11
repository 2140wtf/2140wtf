# PR #22 — ₿AO agent engine, terminal, and hardening (single combined description)

## What this PR does
Ships the ₿AO (Concord V2) agent layer end to end — a unified command engine,
the in-page agent terminal + global `/` palette, the security hardening, and
the performance/data fixes — plus a follow-on hardening pass (concurrency,
expert security review, bug-hunt rounds). This is one cohesive change set; no
separate follow-up PR is needed.

## Root cause
The ₿AO command surface was split across two divergent implementations (a
headless CLI and an in-page terminal) that reimplemented the same verbs on
different transports, and only a subset of community operations were reachable
headlessly. The feed and markets pages were slow, the follow list could regress
to a stale copy, and several security edges (key handling, invite relays,
per-community auth, private-community bans, concurrency races) were not hardened.

## The fix
- Unified, transport-agnostic command engine (baoEngine.ts) implements every
  verb once; the CLI (baoAdapter.ts) and in-page terminal (baoTermDispatch.ts)
  are thin adapters (~460 dead CLI lines removed).
- Agent surface: `login` verb, global `/` palette (Ctrl+K) that runs commands on
  Enter, in-page terminal wired to the logged-in account, 5-second `/agents`
  onboarding, always-on `listen` command (worker-free, private agent
  notifications), OpenRouter backend (`think --openrouter`).
- Security: per-community NIP-42 AUTH; private-community bans refuse when they'd
  need a key rotation the driver can't do; invite bootstrap relays validated
  (SSRF); `login --nsec` no longer mints a different key; Routstr bearer key not
  printed; stable error codes.
- Concurrency: registry editions chain off the folded head (no lost links);
  `say --key` retries dedupe in-process; per-community pools keyed by community
  + key so identities can't clobber the NIP-42 AUTH handler.
- Performance/data: All/global feed no longer blanks while follow/love lists
  resolve; markets render progressively; profile follow list shows the newest
  kind 3; `Anon-<npub>` names; dead relay + broken Blossom cleanup; `/events`
  defaults to global/all.

## Verification
- Full suite: 2026 tests pass (tsc, eslint, vitest, vite build green).
- CLI: all 30 commands dispatch; permission/edge cases error gracefully.
- Browser: `/` palette + `/agents` terminal run commands; duplicate-key console
  errors on /events and /market fixed and re-verified clean.
- Live relay: invite mint, ban/unban, admin grant, channel create, members work.
