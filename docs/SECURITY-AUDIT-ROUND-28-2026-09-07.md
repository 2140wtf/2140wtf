# Security Audit — Round 28 (2026-09-07)

**Focus:** NIP-17 DM inbox fetch correctness — "sometimes messages fail to show" (user report).

**Surfaces:** `src/hooks/useNip17Inbox.ts` (the shared inbox subscription behind `DmInboxProvider`), new `src/lib/nip17Backfill.ts` (pagination), `src/hooks/useNip17SendMessage.ts` / `src/lib/inboxRelays.ts` (read-only, to confirm the delivery model).

## Root causes found (four independent bugs)

### F-28-1: Racy single-page backfill (High — missing messages)

The backfill was one `pool.query([{ kinds: [1059], '#p': [me], limit: 100 }])`. NPool's grouped
`query` resolves after the **first** relay EOSE plus a ~1s grace window (`NPool.js`: `eoseTimeout`
default 1000ms, resolve on first EOSE). What lands in that window is timing-dependent:

- an inbox with >100 wraps is silently truncated (no pagination existed);
- on cold start, sockets to some relays may not even be open before the first EOSE arrives, so
  their events never enter the snapshot.

Any wrap not in that snapshot and older than the live `since` cursor is **permanently invisible**.

**Fix:** `paginateBackfill()` walks the inbox backwards with `until` cursors (page size 100, cap 10
pages) until exhausted, deduplicating by id. Deterministic and complete regardless of relay timing;
a no-progress guard handles same-second clusters larger than a page.

### F-28-2: NIP-65 read relays missing from the inbox read set (High — systematically missing messages)

The send path (`useNip17SendMessage.fetchDmRelays`) delivers the recipient's wrap to their
**kind-10050 DM relays, falling back to their NIP-65 (kind 10002) read relays**. The inbox read set
was `kind-10050 relays ∪ app defaults` — **NIP-65 relays were never read**.

Consequence: for any user without a kind-10050 list, wraps published to their NIP-65 inbox relays
(exactly where our own sender publishes them) never appeared. This is the "some conversations are
empty / missing messages" generator.

**Fix:** inbox read set is now `kind-10050 ∪ NIP-65 read ∪ app defaults`, deduplicated, capped at
16 sockets. The cap is an abuse bound: kind-10050/10002 are self-published, so a malicious own-list
cannot make the client open unlimited sockets.

### F-28-3: NIP-59 back-dating gap in the live cursor (Medium — missing recent messages)

The live subscription used `since = now − 2d`. NIP-59 explicitly allows gift wraps to be
back-dated up to two days. A wrap published at time T can carry `created_at = T − 2d + ε`; the old
cursor skipped any wrap whose back-dated timestamp fell before it.

**Fix:** the cursor is anchored to `backfillStart − 2d − 60s`, so every wrap published after the
backfill began is seen no matter how far the sender back-dated it. Duplicates against the backfill
are dropped by message id (existing dedup).

### F-28-4: Silently dead live subscription (Medium — messages stop arriving)

`NPool.req` forwards `CLOSED` only when **every** relay in the group closes it, after which the
generator ends. The hook's `for await` simply finished and the inbox went live-dead: no errors, no
reconnect, all new messages invisible until a full remount. Network blips / relay restarts make
this a matter of time for every session.

**Fix:** the live subscription now runs in a bounded loop — on generator end (not abort) it waits
3s and re-opens with the same cursor. Unmount still tears down immediately via the abort signal.

## Deliberately unchanged

- `unwrapNip17Message` crypto chain (hash+sig checks on wrap and seal, seal-author/rumor-author
  binding, content length and clock-skew bounds) — audited in earlier rounds, correct.
- Conversation grouping (`computeNip17ConversationId`) — matches the send path.
- `DmInboxContext` single-subscription architecture — unchanged.

## Verification

- New `src/lib/nip17Backfill.test.ts` (5 tests): full backwards walk, cross-page dedup, page cap
  under a bottomless inbox, same-second no-progress termination, empty inbox.
- Full gates: 1,966 tests / 200 files green, `tsc --noEmit`, ESLint, `npm run build` clean.

## Residual risks / follow-ups

- The 16-socket inbox cap trades a sliver of coverage (users listing >16 relays) for DoS safety.
- `pool.req` per-relay AUTH failures still surface only as missing relays (NPool behavior); a
  per-relay status diagnostic for the DM inbox could improve observability later.
