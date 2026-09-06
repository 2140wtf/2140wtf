# Agent working rules — 2140.wtf

These rules exist because past agent sessions made real, costly mistakes.
They are not suggestions. Read this file at the start of every work session.
If a rule blocks what you're about to do, that is the point.

## 1. Branch/PR metadata hygiene (MANDATORY — cost the user three bad PR titles)

**Mistake that caused this rule:** the audit branch was named
`security/audit-rounds-3-14` for its first scope. Three PR waves later it
carried rounds 18–25, but every PR GitHub auto-created from it inherited
the stale auto-title "Security/audit rounds 3 14" — one with an empty
description. The user asked "are you losing track of previous PRs?" —
fair. The agent controls the branch name and PR metadata, not GitHub.

Rules:

1. **Rename the branch when its scope changes.** The branch name must
   describe what the NEXT PR from it contains, not what it contained
   when created. (`git branch -m old new && git push -u origin new &&
   git push origin --delete old`.)
2. **Never let GitHub auto-fill a PR title.** With `gh` authenticated:
   create PRs via `gh pr create --title ... --body ...` — never by
   telling the user to click the compare URL. If a PR must be opened in
   the browser, hand over the exact title + description text with it.
3. **Every PR gets a real description** — summary, fixes per round/area,
   verification results. An empty description is a failed handoff.
4. **One PR = one named batch.** If pushing more work to an open PR,
   update its title/body to cover the new content:
   `gh pr edit <n> --title ... --body ...`.
5. **`main` is branch-protected.** Never attempt `git push origin main`;
   go through a PR every time. Do not reset local `main` and retry —
   that push will always be declined.

## 2. Nostr publishing safety (MANDATORY)

**Mistake that caused this rule:** demo auction scripts published test
listings to the **public Nostr relays** (ditto, primal, nos.lol, dreamith)
with throwaway keys that were never saved. That content is visible to the
entire Nostr ecosystem and some of it is permanently undeletable. The user
called this "garbage for the entire Nostr ecosystem."

Rules:

1. **Never publish to public relays as a side effect.** Any script that
   publishes Nostr events (test data, demos, fixtures) must refuse to run
   unless `ALLOW_DEMO_PUBLISH=1` is set explicitly by a human decision.
2. **Test content stays local.** Use local Nostr relays (e.g. `strfry`,
   `rabbit-relay`) or mock the query layer in tests instead. Public relays
   are production.
3. **If publishing anything real is unavoidable, the signing key MUST be
   persisted first** (gitignored, mode 0600) and every published event id
   recorded, so a deletion is always possible. See `e2e/demo-keyring.mjs`
   for the pattern.
4. **Anything user-visible on shared infrastructure needs the same care:**
   public relays, shared caches, production databases, third-party APIs.

## 3. Chat privacy — NEVER leak to public Nostr (MANDATORY)

**Mistake that caused this rule:** the Fal Live TV "trollbox" chat published
plaintext **kind-1 notes to public relays** (ditto, primal, …), signed with
the user's **real key**, bypassing the 2140 Social identity-privacy module
(nip05 / hashed / anon). The user's real npub was publicly attached to chat
messages in a privacy-first product — a critical incident.

Rules:

1. **Chat surfaces must use the encrypted scroll protocol**, never kind-1
   notes. 2140 Social rooms are end-to-end encrypted envelopes on the single
   2140.social relay (wss://2140.social/ws). A chat that is not an encrypted
   room must not post anything to Nostr at all (read-only or local-only).
2. **Never sign a user's message with their real key** unless the UI
   explicitly shows the real identity and the user chose it. Identity modes
   (anon / hashed / nip05) must be honored on the wire, not just displayed.
3. **No "test" or debug chat messages to public relays** — same rule as
   section 1; test chat on a local relay or don't send.
4. If a chat's storage relay is not confirmed writable/private, the safe
   default is: no composer, no publish path.

## 4. Bearer capabilities are secrets (MANDATORY)

**Mistake that caused this rule:** production ₿AO room invite URLs were
hardcoded in `src/lib/baosocial/rooms.ts`. That put invite secrets, room IDs,
welcomer keys, and routing IDs into Git history and deployed JavaScript. Deleting
the file did not revoke credentials already copied from history or caches.

Rules for every human and LLM agent:

1. **Treat every bearer capability exactly like a private key.** This includes
   complete `/chat/join#...` and `/agent#...` URLs, issued `/i/<code>` short
   links, split-invite `secret=` values, room keys, auth cookies, API tokens,
   Cashu tokens/proofs, wallet connection strings, and administrative URLs.
2. **Never put operational capabilities in tracked content:** not source,
   `public/`, JSON, docs, tests, fixtures, screenshots, generated bundles,
   terminal transcripts, commit messages, PR bodies, or issue comments. A room
   being called "public" does not make its admission capability public data.
3. **Use unmistakable invalid placeholders** such as `<invite-short-url>`,
   `<fragment>`, or values assembled from deterministic dummy parts. Never copy
   a live value and redact only part of it.
4. **Room discovery happens after authentication** on the canonical chat
   origin with `Cache-Control: no-store`. The static 2140 client must not embed,
   mirror, cache, or manufacture a production room directory.
5. **Hosted chat fails closed.** A verified hosted-room invite must use only
   `wss://2140.social/ws`. If the canonical origin or relay is unavailable,
   stop; never substitute the app's public Nostr relay pool.
6. **Run `node scripts/security-scan.mjs` before committing.** CI runs the same
   scanner across production code and repository text; locally it also checks
   untracked, non-ignored files before they can be staged. Do not bypass,
   weaken, or allowlist a finding merely to make CI green. Test the detector
   with synthetic values when its rules change.
7. **Scanner output must not reproduce a discovered secret.** Reports contain
   only file, line, length, and a short SHA-256 fingerprint. Never print the
   matching value while investigating.
8. **On any exposure, stop distribution and rotate first.** Invalidate the
   invite/token/key at its authority, rotate related routing capabilities where
   applicable, and verify rejection of the old value. Removing a file, force
   pushing Git, or clearing a deployment is not revocation.
9. **No agent may downgrade this rule based on intent.** If it is unclear
   whether a value is live, treat it as live and ask the operator privately.

## 5. Money safety (MANDATORY)

1. **Never publish or log nsec/seed/private keys** — not in code, not in
   terminal output, not in screenshots, not in commit messages.
2. Real sats flow through the Cashu wallet and auction escrow. Treat every
   money-moving code path as production: tests use mock wallets, never real
   mint balances.
3. Keys a user may need later (wallet, demo identities, operator co-signer)
   are saved to gitignored local storage with mode 0600 and a backup copy
   outside the repo. Losing keys = losing funds. This is unacceptable.

## 6. Relay/event hygiene

1. **Deleting Nostr events requires the original author's key** (NIP-09).
   A deletion from any other key is accepted by relays but has zero effect.
   Before publishing anything, know how it will be removed.
2. Events live on relays independently of this repo. Cleaning up files or
   code does NOT clean up the Nostr ecosystem. Cleanup must happen on the
   relays, and must be verified there (query the relays afterward).

## 7. Session memory is volatile — verify claims, don't recall them

**Mistake that caused this rule:** sessions repeatedly claimed work was
"done" when it wasn't (events left on relays, files not deleted, scripts
committed then re-added as debug garbage).

1. "Done" means **verified with a real tool call**: the test run output, a
   relay query, a browser check — not a mental note.
2. Before reporting a deletion/cleanup as complete, **re-query the source**
   (relays, filesystem, git status) and show the result.
3. If you cannot verify (no auth, no network), say so explicitly instead of
   assuming success.

## 8. Ephemeral key patterns

Any key generated in a script (`generateSecretKey()`) is a liability:

- Persist it to the gitignored keyring (`e2e/.demo-keys.json`) or do not
  publish at all.
- Never print the full secret; print at most a prefix for identification.
- Record event ids alongside the key that can delete them.

## 9. Debug/test scripts lifecycle

1. One-off debug scripts must never be committed. Delete them (or place
   them in gitignored paths) before the commit stage of any task.
2. Long-lived test tooling lives in `e2e/` with a header comment stating
   what it does, how to run it, and how to undo it.
3. Before pushing a branch, run `git status --porcelain -uall` and clean
   untracked leftovers. The working tree must be clean at PR time.

## 10. Language

The user works in English. All responses, comments, and commit messages
are English. No other languages, even by accident from mixed training
data — check your own output.

## 11. Verify before merge

The pre-merge checklist (run it, paste the tail of the output):

```bash
git status --porcelain -uall        # must be empty
npx tsc --noEmit                    # 0 errors
npx eslint .                        # 0 errors
npx vitest run                      # all passing
npm run build                       # succeeds
```

If any step fails, the branch is not ready — fix it before asking to merge.
