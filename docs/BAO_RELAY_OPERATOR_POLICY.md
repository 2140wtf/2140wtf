# BAO relay operator policy (VPS, relay.bao.network)

**Status:** relay-side spec. Privileged operator identities are the npubs in
`BAO_RELAY_OPERATOR_PUBKEYS` in the relay's `roster.env` (live on
`ubuntu-16gb-nbg1-1`, `/opt/bao-relay`). Community owners remain authorized
only for their own communities; every other identity is a regular
participant. The relay's write policy remains the final authority.

## Operator identities

Deployed operator list (2026-08-12, container start):

```
BAO_RELAY_OPERATOR_PUBKEYS=
  73d9e19ef07e0d098fc0fc5fb75db0f854824e8b4e43905acce638ddf6469960,  # BAO Markets Feed (predictions@bao.markets)
  606f05b0696f8d561a5470ead20d74b08ecd6243a6907acdc450a4849c9c0bc6,  # (no kind-0 on the relay)
  fba1bbd8ab57f258673157defd5afc9ceda004c6845f99db3169fe4b61ba7416   # 2140wtf (2140wtf@rizful.com)
```

(The docs previously listed only `fba1bbd8…`; the extra keys were added on
2026-08-12. `whitelist.txt` — `add-npub.sh` — is **not** wired into the
relay; it gates nothing. The deletion rule keys off
`BAO_RELAY_OPERATOR_PUBKEYS` only.)

## Rule 1 — invite bundles open to anyone (kind 33301)

Add `33301` to the anyone-can-publish set (current: 1059, 21059, 38000,
38003, 37107, 33831). Invite links are authored by fresh per-link keys by
design (CORD-05), so gating them to registered accounts rejects every link
by construction. Bundles are small, addressable, and replaceable
(revocation tombstones overwrite).

## Rule 2 — operator-moderated NIP-09 deletion

Kind 5 stays author-owned as today (verified honored for 1059 and 38000),
PLUS:

```
if kind == 5 and pubkey in OPERATOR_PUBKEYS:
    accept and honor for referenced "k"-tag kinds
    {1059, 21059, 13302, 13303, 33301, 39998}, regardless of event author
```

Client behavior (already shipped): a purge sends per-author kind-5s (works
on every relay) PLUS one caller-signed kind-5 per batch. Standard relays
apply the latter to the caller's own events only; this rule makes it cover
the whole community when the caller is an operator. The caller-signed batch
is also sent for community owners (not just operators) so the owner's own
kind-39998 sponsorship records are deleted on every relay.

## Rule 3 — operator-only ₿AO creation, open participation

```
kind 1059/21059:
  if the author already has stored events on this relay:
      accept                                   # participation: anyone joins,
                                               # chats, reacts — no identity
  else:
      require socket NIP-42 auth as an OPERATOR_PUBKEYS member   # creation
kind 33301: require socket NIP-42 auth as an OPERATOR_PUBKEYS member
```

Client behavior (already shipped): genesis editions and channel seeds try
the key-isolated Concord transport first; only if every relay refuses do
they retry through the app pool, whose NIP-42 answers with the user's own
npub — operators pass rule 3, everyone else is refused (intended). Channel
streams are seeded with a founder message at creation so all later member
writes are "known author" writes.

## Deployment status (2026-08-13)

- [x] Rules 1–3 deployed to the relay write policy (`/opt/bao-relay` on the
      relay VPS `ubuntu-16gb-nbg1-1`, git `master` — current uncommitted
      write-policy.mjs is live since container restart 2026-08-13 01:12).
      The operator kind-5 rule is enforced by the plugin itself: it validates
      the `k` tags against {1059, 21059, 13302, 13303, 33301, 39998}, re-proves
      `e`-tagged targets against stored kinds, and finishes the cross-author
      deletion with `strfry delete`, because strfry's native NIP-09 removes
      same-author events only.
- [x] Verified live end-to-end (2026-08-11, throwaway operator key, removed
      after): sponsored wrap (kind 1059) and the sponsorship record (kind 39998)
      were both physically deleted by one operator-signed kind-5.
- [x] Reloaded the container 2026-08-13 after allowinglist additions
      (30078, NIP-29 group kinds) made the on-disk policy newer than the
      running one.
