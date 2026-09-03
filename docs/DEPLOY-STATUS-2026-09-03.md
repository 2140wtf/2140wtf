# Deploy status — 2026-09-03

## The two failed deployments (2 days ago) — already superseded, no action needed

| Deployment | Commit | Result | Why |
|---|---|---|---|
| Deploy to GitHub Pages #1 | `main` @ "fix: use secrets directly in git URL" | **failed** | Workflow runs on the **2140-social** repo (mirror). The two commits listed ("checkout with default token, push with MIRROR_TOKEN", "use secrets directly in git URL") are **workflow-CI fixes for the mirror push**, both touching `.github/workflows/mirror*`. They failed while debugging mirror auth, and the fixed runs now succeed. |
| Deploy to GitHub Pages #2 | `main` @ "fix: checkout with default token, push with MIRROR_TOKEN" | **failed** | Same debugging sequence — each fix commit triggered a deploy attempt; failures were from the broken run itself, not the site. |

Both are marked `inactive` now (superseded by a newer deployment) — GitHub keeps failed deployment records forever, so they show in the UI even though they no longer matter.

## Current state: production is UP TO DATE ✅

| Check | Result |
|---|---|
| Latest `Deploy to GitHub Pages` run on `main` (`307c0f2c`, PR #120 chat parent-auth) | **success** (05:07Z) |
| Deployment `6237347086` status | **success** |
| https://2140.wtf/ | 200, serving current bundle `index-CwN87HKr.js` |
| Deployed bundle contains the chat parent-auth handshake (`2140-chat-auth-offer`) | ✅ present |
| Test / Security Scan workflows on the merge commit | success |

## Still pending on `origin/main` after this merge (not yet deployed)

The `/community` route rename + auction house + lightning addresses land with the **next** PR merge (they sit on local `main`, ahead of `origin/main`). Once the open PR is merged, Pages auto-deploys again.
