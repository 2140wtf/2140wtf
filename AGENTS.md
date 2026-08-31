# Agent working rules — 2140.wtf

These rules exist because past agent sessions made real, costly mistakes.
They are not suggestions. Read this file at the start of every work session.
If a rule blocks what you're about to do, that is the point.

## 1. Nostr publishing safety (MANDATORY)

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

## 2. Money safety (MANDATORY)

1. **Never publish or log nsec/seed/private keys** — not in code, not in
   terminal output, not in screenshots, not in commit messages.
2. Real sats flow through the Cashu wallet and auction escrow. Treat every
   money-moving code path as production: tests use mock wallets, never real
   mint balances.
3. Keys a user may need later (wallet, demo identities, operator co-signer)
   are saved to gitignored local storage with mode 0600 and a backup copy
   outside the repo. Losing keys = losing funds. This is unacceptable.

## 3. Relay/event hygiene

1. **Deleting Nostr events requires the original author's key** (NIP-09).
   A deletion from any other key is accepted by relays but has zero effect.
   Before publishing anything, know how it will be removed.
2. Events live on relays independently of this repo. Cleaning up files or
   code does NOT clean up the Nostr ecosystem. Cleanup must happen on the
   relays, and must be verified there (query the relays afterward).

## 4. Session memory is volatile — verify claims, don't recall them

**Mistake that caused this rule:** sessions repeatedly claimed work was
"done" when it wasn't (events left on relays, files not deleted, scripts
committed then re-added as debug garbage).

1. "Done" means **verified with a real tool call**: the test run output, a
   relay query, a browser check — not a mental note.
2. Before reporting a deletion/cleanup as complete, **re-query the source**
   (relays, filesystem, git status) and show the result.
3. If you cannot verify (no auth, no network), say so explicitly instead of
   assuming success.

## 5. Ephemeral key patterns

Any key generated in a script (`generateSecretKey()`) is a liability:

- Persist it to the gitignored keyring (`e2e/.demo-keys.json`) or do not
  publish at all.
- Never print the full secret; print at most a prefix for identification.
- Record event ids alongside the key that can delete them.

## 6. Debug/test scripts lifecycle

1. One-off debug scripts must never be committed. Delete them (or place
   them in gitignored paths) before the commit stage of any task.
2. Long-lived test tooling lives in `e2e/` with a header comment stating
   what it does, how to run it, and how to undo it.
3. Before pushing a branch, run `git status --porcelain -uall` and clean
   untracked leftovers. The working tree must be clean at PR time.

## 7. Language

The user works in English. All responses, comments, and commit messages
are English. No other languages, even by accident from mixed training
data — check your own output.

## 8. Verify before merge

The pre-merge checklist (run it, paste the tail of the output):

```bash
git status --porcelain -uall        # must be empty
npx tsc --noEmit                    # 0 errors
npx eslint .                        # 0 errors
npx vitest run                      # all passing
npm run build                       # succeeds
```

If any step fails, the branch is not ready — fix it before asking to merge.
