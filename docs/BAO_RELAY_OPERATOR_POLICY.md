# BAO relay operator policy (VPS, relay.bao.network)

**Status:** relay-side spec. The only privileged operator identity is the
2140.wtf-owned npub below. Community owners remain authorized only for their
own communities; every other identity is a regular participant. The relay's
write policy remains the final authority.

## Operator identity

```
OPERATOR_NPUB = "fba1bbd8ab57f258673157defd5afc9ceda004c6845f99db3169fe4b61ba7416"  # 2140wtf
```

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
if kind == 5 and pubkey == OPERATOR_NPUB:
    accept and honor for referenced "k"-tag kinds
    {1059, 21059, 13302, 13303, 33301}, regardless of event author
```

Client behavior (already shipped): a founder purge sends per-author kind-5s
(works on every relay) PLUS one caller-signed kind-5 per batch. Standard
relays apply the latter to the caller's own events only (usually none);
this rule makes it cover the whole community when the caller is an operator.

## Rule 3 — operator-only ₿AO creation, open participation

```
kind 1059/21059:
  if the author already has stored events on this relay:
      accept                                   # participation: anyone joins,
                                               # chats, reacts — no identity
  else:
      require socket NIP-42 auth as OPERATOR_NPUB   # creation: new ₿AO /
                                                     # channel stream
kind 33301: require socket NIP-42 auth as OPERATOR_NPUB
```

Client behavior (already shipped): genesis editions and channel seeds try
the key-isolated Concord transport first; only if every relay refuses do
they retry through the app pool, whose NIP-42 answers with the user's own
npub — operators pass rule 3, everyone else is refused (intended). Channel
streams are seeded with a founder message at creation so all later member
writes are "known author" writes.

## This week

- [ ] Deploy rules 1–3 to the relay write policy
- [ ] Verify: operator creates ₿AO + link natively on relay.bao.network;
      non-operator creation refused; member join/chat unaffected;
      operator kind-5 deletes a whole ₿AO
