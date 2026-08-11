# Concord V2 Transport Isolation

Status: implemented for the web transport; native background transport remains
disabled until it can preserve the same partition.

## Problem

The web client currently authenticates the logged-in user and every registered
Concord stream key on the same `NRelay1` connection. A relay can therefore
cryptographically link a public identity to community membership and can link
multiple communities that share that relay. Encryption still protects content,
but it does not protect this relationship metadata.

Connection reuse by URL is the source of the leak. Merely filtering which keys
are signed, splitting subscriptions, or adding a transport-shaped wrapper over
the existing `NPool` cannot isolate identities while `nostr.relay(url)` returns
the same underlying socket.

## Security invariant

For every relay WebSocket connection, the set of NIP-42 AUTH pubkeys MUST be
exactly one of:

1. the logged-in public identity, with no Concord-derived stream keys; or
2. stream keys belonging to exactly one Concord community, with no real user
   pubkey and no keys from another community.

Account switching MUST close every Concord socket. Relay authentication sets
only grow during a socket lifetime, so clearing local bookkeeping without
closing the connection is insufficient.

This prevents cryptographic same-socket linkage. It does not prevent a relay
from correlating IP address, connection timing, traffic volume, TLS/browser
fingerprints, or coordinated reconnects. Users needing that protection require
an OS/VPN/Tor-style proxy or a trusted private relay.

## Connection ownership

The isolated transport owns sessions keyed by:

`account generation + community id + normalized relay URL + capability keyset`

Each session:

- owns its own `NRelay1` socket;
- has no reference to the user's signer;
- accepts only derived group keys registered for its community;
- rejects query authors outside that registered set;
- signs stream-only kind-22242 AUTH events for the live challenge;
- tracks AUTH acknowledgements and reconnect state inside the session;
- closes on account reset, community leave, relay removal, or idle expiry.

Identity-bearing personal events—profiles, kind-13302 community vaults,
kind-13303 invite vaults and ordinary Nostr activity—remain on the identity
pool. Direct-invite delivery uses a one-shot socket authenticated only as the
giftwrap's ephemeral outer author; it never borrows an identity or standing
community-authenticated socket.

## Atomic migration sequence

An unused service is prohibited: it would reduce no leakage and would drift
from production reconnect behavior. The migration series must keep source,
callers and tests together:

1. Implement the isolated session/provider and a fake-relay harness that records
   connection ids, AUTH pubkeys, subscriptions and publishes.
2. Change Wire subscriptions and cursors to key by community plus relay; migrate
   standing Wire and control/plane-sync reads.
3. Migrate every community-bound read/write path: channel, control, guestbook,
   typing, moderation, rekey, relay mirror, community actions and link bundles.
4. Move late stream-key registration and AUTH acknowledgement gates into the
   isolated session.
5. Remove the Concord stream-auth graft and registry from `NostrProvider`.
6. Close and recreate sessions on account generation change; verify native
   notification work follows the same partition before enabling it.

No release may claim relay-unlinkable membership while any community-bound
caller can still authenticate stream keys on the shared identity pool.

## Acceptance tests

The implementation is complete only when tests prove:

- same relay plus two communities produces two different sockets;
- no socket records both the real user and a stream AUTH;
- no stream socket records keys from two communities;
- requested `authors` outside a session's registered keys fail before network;
- a new key capability creates a separate matching session rather than
  widening an already-authenticated socket;
- reconnect clears challenge/ack state and re-authenticates the same scope;
- account switch closes all old sessions and stale async work cannot reopen one;
- cursors for two communities on one relay advance independently;
- same-community scopes may still batch while cross-community scopes never do;
- all configured community relays still receive writes and auth-required retry
  behavior remains functional.

Battery and connection count are explicit tradeoffs. Sessions are lazy, reuse a
socket only for an exact community/relay/capability set, and close when idle;
reducing socket count must never cross or widen the isolation boundary.
