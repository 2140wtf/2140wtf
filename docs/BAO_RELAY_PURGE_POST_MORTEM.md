# BAO relay operator purge — post-mortem & operating guide

**Incident:** 2026-08-12/13 — "cannot purge ₿AOs created with the 2140 npub".
**Status:** root-caused, fixed (relay live, client fix in PR
`fix/bao-purge-owner-sponsorship`). This document is for **LLM agents and
operators** who touch the BAO relay, the purge feature, or the operator list.

---

## 1. TL;DR for agents

- A ₿AO purge **deletes on the relay only what the current `write-policy.mjs`
  physically removes**. If the policy file on disk is newer than the running
  plugin process, **nothing you edit is live** — restart the container.
- The purge client must send **caller-signed kind-5 batches for the community
  owner too**, not just the app operator. Without that, the owner's own
  kind-39998 sponsorship records survive and deletion **verification fails**
  ("could not be verified on … (N remaining)").
- Operator identities come **only** from `BAO_RELAY_OPERATOR_PUBKEYS` in the
  relay's `roster.env`. `whitelist.txt`/`add-npub.sh` gates **nothing**.
- **Never put nsecs in the repo or docs.** Agent identity files live in
  `~/.concord-live/<name>.json` (mode 0600); the human-facing operator key is
  the one logged into the web client. If a doc claims an nsec location,
  verify before trusting it — the 2140wtf operator nsec is **not** in this
  repo and is not in any local agent state file.

## 2. The actors (know your hosts and files)

| Thing | Where |
|---|---|
| **Live BAO relay** | `ubuntu-16gb-nbg1-1`, tailscale `100.91.106.42`, `/opt/bao-relay` (a **git repo**), docker container `bao-strfry` |
| **Relay write policy** | `/opt/bao-relay/write-policy.mjs` (node, strfry `writePolicy` plugin), self-test `write-policy.test.mjs` |
| **Operator list + roster env** | `/opt/bao-relay/roster.env` (`BAO_RELAY_OPERATOR_PUBKEYS`, `BAO_RELAY_ORACLE_PUBKEYS`, `BAO_RELAY_ROSTER_*`) |
| **Relay config** | `/opt/bao-relay/strfry.conf` (wires `plugin = "/app/write-policy.mjs"`), `docker-compose.yml` |
| **Management box** | `bao8gb` / `142.132.167.103` (tailscale `100.123.93.11`): nginx `relay.bao.network` → proxies to `100.91.106.42:7777`. Its **own local `bao-strfry` container is not the live relay.** |
| **NIP-11** | `https://relay.bao.network/nip11.json` — advertises NIP-09, pubkey is the BAO Oracle key |
| **Client purge** | `src/concord-v2/hooks/useCommunityActions2.ts` (`purgeRemote`), `src/concord-v2/lib/purgeCommunity.ts`, `src/concord-v2/lib/relayDeletion.ts` |
| **App operator key** | `src/lib/appOperator.ts` `APP_OPERATOR_PUBKEY` = `fba1bbd8…7416` (2140.wtf, `2140wtf@rizful.com`) — the **only** key the client recognizes as operator (by design, see §5) |

## 3. What went wrong (timeline + root causes)

1. **Aug 10–11 — purge worked.** The relay's operator-deletion rule (rule 2:
   operator-signed kind-5 honored cross-author for
   `{1059, 21059, 13302, 13303, 33301, 39998}`) was deployed and verified
   live (community `cb09755c` fully deleted including its sponsorship). The
   client at that time passed `user.signer` as the caller for **every** purge.
2. **Aug 11 — client regression.** Commit `7a56e1b9` restricted the
   caller-signed batch to the app operator
   (`isOperator ? user.signer : undefined`). From then on, an owner purge no
   longer deleted the **owner-signed kind-39998 sponsorship records**
   (per-author deletions only cover stream keys and invite-link keys, never
   the owner's own key). Result: sponsorship residue on every relay ⇒
   verification `remaining > 0` ⇒ **"The BAO purge could not be verified"**.
3. **Aug 12 20:53 — relay restarted with a 3-key operator list.**
   `roster.env` grew from 1 operator (`fba1bbd8…`) to 3:
   `73d9e19e…` (BAO Markets Feed, `predictions@bao.markets`),
   `606f05b0…` (no kind-0; the client labels it "₿AO HQ" in
   `src/components/InitialSyncGate.tsx`; added per
   `docs/SESSION_WRAPUP_2026-08-07.md` as "bao.markets + bao fund npubs"),
   `fba1bbd8…` (2140.wtf). The docs still said "one operator" — docs drift.
4. **Aug 12 21:47 — policy edited but never reloaded.** `write-policy.mjs`
   gained allowlist entries (30078, NIP-29 group kinds, kind-1 `bao-chat-*`),
   a sponsorship `created_at` guard, and an `e`-tag deletion re-proof — but
   the container was **not restarted** and the changes were **left
   uncommitted**. The running plugin (started 20:53) did not contain them;
   the relay kept rejecting kinds the new file would accept
   ("write policy blocked event …" flood in `docker logs bao-strfry`).
5. **The user's purge attempt.** Community `48f29a09…` (created 21:20:31 as
   `fba1bbd8…`) still holds its sponsorship + 1 genesis wrap; the operator
   kind-5 at 21:19:52 was honored, but **no kind-5 was ever published after
   the re-create** — a client-side failure consistent with the §3.2
   regression (owner-path gate/verification), not a relay rejection.

## 4. The fix (applied)

**Relay (live 2026-08-13 01:12 UTC):**
- Backed up `write-policy.mjs` → `write-policy.mjs.bak-20260813-011214`,
  restarted `bao-strfry`, verified the plugin started with the current file
  (`md5` of `/app/write-policy.mjs` == repo file; `pgrep` start time ==
  restart time).
- Committed the previously-uncommitted policy as `a24f6b2` (relay repo).
- Live checks: kind-1 rejected, kind 17375 / 30078 accepted, same-author
  kind-5 physically deletes; self-test (`node write-policy.test.mjs`) 90/90.

**Client (branch `fix/bao-purge-owner-sponsorship`, commit `edbbaf3f6`):**
- `purgeRemote` now passes the caller signer for
  `isOperator || user.pubkey === community.owner` — the owner's own
  sponsorship records get deleted on standard relays (same-author NIP-09)
  and community-wide on the BAO relay when the owner is also an operator.
- `npm run test` passes (tsc, eslint, 2147 vitest, vite build).

## 5. What to avoid — guardrails (so it never happens again)

1. **Never let the policy file drift from the running plugin.**
   After ANY edit to `write-policy.mjs`:
   `node --check write-policy.mjs` → `node write-policy.test.mjs` →
   commit → `docker restart bao-strfry` → confirm plugin start time >= file
   mtime. A newer file does nothing until restart. Check with:
   `ps -o lstart -p $(pgrep -f '^node /app/write-policy.mjs')` vs
   `stat -c %y write-policy.mjs`.
2. **Never leave policy changes uncommitted on the relay repo.** An
   uncommitted `.mjs` is one bad `git checkout`/overwrite away from losing
   the intended behavior.
3. **Never "fix" the purge via `whitelist.txt` / `add-npub.sh`.** It is not
   wired into strfry (`strfry.conf` has no `whitelistPolicy`). The only
   operator gate is `BAO_RELAY_OPERATOR_PUBKEYS`.
4. **When editing `roster.env`, keep every existing operator key.** A
   replace-all edit that drops `fba1bbd8…` silently disables operator
   deletion/creation for the 2140.wtf app. Restart the container after env
   changes (env is read at plugin process start).
5. **Don't regress the owner path.** The caller-signed batch must stay wired
   for owners (`Regression-of: 7a56e1b9`). A purge that "succeeds" while
   leaving the owner's sponsorship is a silent data-residue bug.
6. **Don't hardcode the relay operator list in the client.** Config lives in
   the relay by design (`a0cde5163` removed `src/lib/admins.ts`). Other
   operator npubs purge their **own** communities via the owner path; foreign
   communities deliberately require the app operator key.
7. **Don't add markets kinds to `OPERATOR_DELETABLE_KINDS`** (38000 et al.
   are voided/closed through the API, never hard-deleted — open positions).
8. **Remember which host is live.** SSH to `ubuntu-16gb-nbg1-1`
   (`100.91.106.42`), not bao8gb's local container, for relay policy work.
   Check `docker ps` + the nginx upstream before touching anything.
9. **Never put nsecs in docs/repos.** Agent identities: `~/.concord-live/`.
   The web operator key: the app login (browser). If an operator key appears
   in a doc, treat it as compromised-by-policy: rotate it.
10. **Read the actual error.** "Couldn't purge" surfaces either
    "relay did not accept any NIP-09 deletion requests" (all deletions
    rejected), "could not be verified on: <relay> (N remaining)" (residue:
    check sponsorship 39998 and invite bundles first), or an early client
    error (missing NIP-44 signer / gate "Only the founder or 2140 operator").
    Each has a different fix.

## 6. Recipe — operator asks "add/remove an operator" or "purge is broken"

**Add an operator:**
1. `ssh root@100.91.106.42` → `cd /opt/bao-relay`
2. Edit `roster.env`: append the hex pubkey to `BAO_RELAY_OPERATOR_PUBKEYS`
   (keep existing entries).
3. `docker restart bao-strfry`; verify:
   `docker exec bao-strfry env | grep BAO_RELAY_OPERATOR_PUBKEYS`.
4. Update `docs/BAO_RELAY_OPERATOR_POLICY.md` operator list + this doc.

**Purge broken — check in this order:**
1. Client error text (see guardrail 10).
2. Relay residuals: `docker exec bao-strfry /app/strfry scan '{"kinds":[39998],"limit":100}'`
   and kind-5 by the operator — is the sponsorship still there?
3. Policy freshness (guardrail 1).
4. `BAO_RELAY_OPERATOR_PUBKEYS` still contains the caller's key (guardrail 4).
5. `docker logs bao-strfry | grep -i 'write-policy\|blocked\|delet'` for
   plugin errors or rejection floods.
6. If all clean, reproduce with a throwaway community and read the report.

## 7. Key literature

- `docs/BAO_RELAY_OPERATOR_POLICY.md` — deployable policy spec (rules 1–3).
- `docs/BAO_RELAY_ADMIN_DELETION.md` — NIP-09 deletion design.
- `docs/SESSION_WRAPUP_2026-08-07.md` — why the extra operator npubs were
  added (bao.markets + bao fund).
- `src/concord-v2/lib/purgeCommunity.ts` — `purgeCommunityRemote` caller-signed
  batch mechanics.
- Relay repo on the VPS: `/opt/bao-relay` (git), including
  `write-policy.test.mjs`.
