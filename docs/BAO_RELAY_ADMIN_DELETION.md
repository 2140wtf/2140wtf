# BAO relay — write-policy specs (VPS, relay.bao.network)

**Status:** DEPLOYED (see `BAO_RELAY_OPERATOR_POLICY.md` — operator list is
`BAO_RELAY_OPERATOR_PUBKEYS` in the relay's `roster.env`, currently three
keys: BAO Markets Feed, an unlabeled key, and the 2140wtf key). Client
support for operator deletion lives in `purgeCommunityRemote`
(`callerSigner`) and the purge path in `useCommunityManagement2`; the
operator list deliberately stays out of the client (`src/lib/admins.ts` was
removed — the client is operator-neutral). The relay-side rule is live: the
write-policy plugin validates operator kind-5 `k` tags against the Concord
set and finishes the cross-author deletion with `strfry delete` (strfry's
native NIP-09 is same-author only). Verified end-to-end — one operator
kind-5 physically removed a wrap and the sponsorship record (kind 39998).

## Rule 1 — invite bundles open to anyone (kind 33301)

Invite links are authored by fresh per-link keypairs (CORD-05 — that is what
makes them unlinkable and revocable), so the "registered BAO account" gate
rejects every bundle by construction. Add `33301` to the anyone-can-publish
set:

```
anyone may publish: 1059, 21059, 38000, 38003, 37107, 33831  ← current
anyone may publish: + 33301  ← invite bundles (CORD-05 interop kind; small,
                                addressable, replaceable — revocation
                                tombstones overwrite live bundles)
```

Every interop relay (ditto, jskitty, vectorapp, dreamith) accepts kind 33301
from anyone; the "registered account" gate was meant for chat kinds, not the
interop invite kind. With this line, bao-only communities mint links natively
— no consent prompt, no third-party copies.

## Rule 3 — operator-only ₿AO creation, open participation

The relay cannot see who authored a wrap (anonymous stream keys by design),
so creation and participation are gated differently — by whether the wrap's
AUTHOR is already known to the relay:

```
ADMIN_NPUB = fba1bb8d…7416 (2140wtf-owned)

kind 1059/21059:
  if the author already has stored events on this relay (any kind):
      accept                       # participation: members join/chat/react on
                                   # existing streams, no identity required
  else:
      require the socket to be NIP-42-authed as ADMIN_NPUB
                                   # creation: new ₿AO / new channel stream

kind 33301 (invite bundles):
  require socket AUTH as ADMIN_NPUB    # links are minted by the operator

kind 5: author-owned as today, PLUS admin-signed (rule 2)
markets kinds (38000/38003/37107/33831): unchanged, open
```

Semantics: only the 2140.wtf operator npub can create ₿AOs, channels, or invite
links on the relay; ANYONE can then join and participate in those communities
(their writes land on already-known streams — members never authenticate with
their real npub, privacy isolation preserved). Operator identities are public
by design, so operator sockets authenticating with them costs no privacy.

Client side (implemented): when the creator is an operator npub, the genesis
editions, channel seeds, and invite bundles publish through the app pool —
whose NIP-42 answers with the operator npub — instead of the key-isolated
Concord transport; every channel stream is seeded with a founder message at
creation so later member writes are "known author" writes. Non-operator
creates keep the isolated path (creation-gated relays will refuse them —
that is the point).

## Rule 2 — admin-moderated NIP-09 deletion

The relay already accepts and honors NIP-09 (kind 5) deletions from an
event's own author (verified live for kinds 1059 and 38000). Add ONE rule:

The relay already accepts and honors NIP-09 (kind 5) deletions from an
event's own author (verified live for kinds 1059 and 38000). Add ONE rule:

```
if event.kind == 5
   and event.pubkey == fba1bbd8ab57f258673157defd5afc9ceda004c6845f99db3169fe4b61ba7416
then:
    accept, and honor the deletion for referenced events whose "k" tag kind is in
    {1059, 21059, 13302, 13303, 33301, 39998} — REGARDLESS of the referenced event's author.
```

That hex is the 2140wtf admin npub
(`npub1lwsmhk9t2le9see32l006khunnk6qpxxs30enke3d8lykcd6wstqegy86j`).

## Semantics

- The admin identity can wipe any ₿AO's wraps, invite bundles, and vault
  copies on the relay with one signed event per batch. Nobody else gains any
  new power — every other key keeps today's exact behavior.
- Deletion is physical removal from THIS relay only. Members' already-synced
  local copies are unrecoverable by design; rekey remains the forward-secrecy
  mechanism. Markets (kind 38000) stay out of the admin set: with open
  positions they are voided/closed through the API, never hard-deleted.
- Everything else in the allowlist is unchanged: anyone may publish
  1059/21059 + the ₿AO Markets kinds (38000, 38003, 37107, 33831); the
  "registered BAO account" gate stays for the rest.

## Reference implementation (strfry-style write policy, pseudocode)

```lua
local ADMIN_HEX = "fba1bbd8ab57f258673157defd5afc9ceda004c6845f99db3169fe4b61ba7416"
local ADMIN_DELETABLE = { [1059]=true, [21059]=true, [13302]=true, [13303]=true, [33301]=true, [39998]=true }

if event.kind == 5 and event.pubkey == ADMIN_HEX then
  for _, tag in ipairs(event.tags) do
    if tag[1] == "k" and not ADMIN_DELETABLE[tonumber(tag[2])] then
      return reject("admin deletion limited to Concord kinds")
    end
  end
  return accept_and_delete_referenced_events()
end
-- existing rules below, unchanged
```

## Client side (already implemented)

- `purgeCommunityRemote(nostr, community, keys, hints, callerSigner?, ...)` —
  with `callerSigner` it batches ALL found events (any author) into
  caller-signed kind-5s, one signature per 100 events. No per-link secrets
  needed.
- The purge mutation passes the caller signer for the community owner as
  well as the 2140 operator, so the owner's own kind-39998 sponsorship
  records are deleted on every relay (standard NIP-09 same-author for the
  owner's events; community-wide where the owner is also a relay operator).
- The "Purge BAO from relays…" menu item shows for the founder/owner or the
  operator.
