// src/wallet/nip60/multidevice.test.ts
//
// WS9 multi-device NIP-60 scenario: two devices share one identity/wallet key
// and one relay. A spend on device A must supersede the pre-spend token event
// (NIP-60 `del` pointer) so a FRESH device restores only live proofs - never
// the spent ones - and spending the LAST proof must leave a superseding empty
// tombstone, not just vanish locally.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNip60Signer, type Nip60WalletConfig } from '@/baofund/cashu-wallet/lib/cashu/index';
import type { Event as NostrEvent } from 'nostr-tools/pure';
import {
  publishAllTokenEvents,
  publishWalletConfig,
  restoreWalletForIdentity,
  type Nip60Signer,
  type Nip60SyncApi,
} from './sync';

const MINT = 'https://mint.example.com';
const TOKEN_KIND = 7375;
const T0 = 1_700_000_000_000;

const bytes = (fill: number): Uint8Array => new Uint8Array(32).fill(fill);
const hex = (b: Uint8Array): string => Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
const proof = (secret: string, amount: number) => ({
  id: '00' + '0'.repeat(62),
  C: '02' + '0'.repeat(64),
  secret,
  amount,
});

/** In-memory relay. NIP-60 supersession is decided by the CLIENT (`del`
 *  pointers inside token event content), so the store keeps every event and
 *  only answers filters - newest first, like a strfry query. */
class FakeRelay {
  events: NostrEvent[] = [];

  query = async (filter: { kinds?: number[]; authors?: string[]; limit?: number }): Promise<NostrEvent[]> =>
    this.events
      .filter(
        (e) =>
          (!filter.kinds || filter.kinds.includes(e.kind)) &&
          (!filter.authors || filter.authors.includes(e.pubkey)),
      )
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, filter.limit ?? this.events.length);
}

function makeApi(relay: FakeRelay, identitySigner: Nip60Signer): Nip60SyncApi {
  const publish = async (event: NostrEvent): Promise<string | null> => {
    relay.events.push(event);
    return event.id;
  };
  return {
    signer: identitySigner,
    relays: ['wss://relay.test'],
    publish,
    publishToRelays: async (_urls: string[], event: NostrEvent) => publish(event),
    query: relay.query,
    queryRelays: async (_urls: string[], filter: never) => relay.query(filter),
  } as unknown as Nip60SyncApi;
}

const tokenEventsFor = (relay: FakeRelay, pubkey: string): NostrEvent[] =>
  relay.events.filter((e) => e.kind === TOKEN_KIND && e.pubkey === pubkey);

async function decryptPayload(
  walletSigner: Nip60Signer,
  event: NostrEvent,
): Promise<{ mint: string; proofs: Array<{ secret: string }>; del?: string[] }> {
  const plain = await walletSigner.nip44Decrypt(walletSigner.pubkey, event.content);
  return JSON.parse(plain!) as { mint: string; proofs: Array<{ secret: string }>; del?: string[] };
}

describe('NIP-60 multi-device restore (WS9)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ now: T0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const setup = async () => {
    const relay = new FakeRelay();
    const identitySigner = createNip60Signer(bytes(0x21));
    const walletSigner = createNip60Signer(bytes(0x42));
    const api = makeApi(relay, identitySigner);
    const config: Nip60WalletConfig = { id: 'default', privkey: hex(bytes(0x42)), mints: [MINT] };
    expect(await publishWalletConfig(api, [config])).toBeTruthy();
    return { relay, identitySigner, walletSigner, api };
  };

  it('a fresh device restores only live proofs after another device spends', async () => {
    const { relay, identitySigner, walletSigner, api } = await setup();

    expect(await publishAllTokenEvents(api, walletSigner, { [MINT]: [proof('s1', 10), proof('s2', 20)] })).toBe(1);
    const [firstEvent] = tokenEventsFor(relay, walletSigner.pubkey);

    // Device 1 spends s1 a moment later; s2 remains.
    vi.advanceTimersByTime(2_000);
    expect(await publishAllTokenEvents(api, walletSigner, { [MINT]: [proof('s2', 20)] })).toBe(1);
    const spendEvent = tokenEventsFor(relay, walletSigner.pubkey).find((e) => e.id !== firstEvent.id)!;
    expect((await decryptPayload(walletSigner, spendEvent)).del).toEqual([firstEvent.id]);

    // Device 2: fresh localStorage is a fresh device on the same identity + relay.
    localStorage.clear();
    const api2 = makeApi(relay, identitySigner);
    const { restored, walletSigner: restoredSigner } = await restoreWalletForIdentity(identitySigner, api2, bytes(0x99));

    expect(restored.adoptedWalletPubkey).toBe(walletSigner.pubkey);
    expect(restoredSigner.pubkey).toBe(walletSigner.pubkey);
    const secrets = (restored.proofsByMint[MINT] as Array<{ secret: string }>).map((p) => p.secret);
    expect(secrets).toEqual(['s2']);
  });

  it('a spend of the LAST proof tombstones a fresh device to zero', async () => {
    const { relay, identitySigner, walletSigner, api } = await setup();

    expect(await publishAllTokenEvents(api, walletSigner, { [MINT]: [proof('s1', 10)] })).toBe(1);
    const [firstEvent] = tokenEventsFor(relay, walletSigner.pubkey);

    // Device 1 empties the mint: the empty list is skipped by the publish
    // loop, but the mint stays in the published set so a tombstone supersedes
    // the pre-spend event.
    vi.advanceTimersByTime(2_000);
    expect(await publishAllTokenEvents(api, walletSigner, { [MINT]: [] })).toBe(1);
    const tombstone = tokenEventsFor(relay, walletSigner.pubkey).find((e) => e.id !== firstEvent.id)!;
    const payload = await decryptPayload(walletSigner, tombstone);
    expect(payload.proofs).toEqual([]);
    expect(payload.del).toEqual([firstEvent.id]);

    localStorage.clear();
    const api2 = makeApi(relay, identitySigner);
    const { restored } = await restoreWalletForIdentity(identitySigner, api2, bytes(0x99));
    expect(restored.proofsByMint[MINT] ?? []).toHaveLength(0);
    // The old pre-spend event is still on the relay - only the del pointer
    // keeps it from resurrecting s1.
    expect(relay.events.filter((e) => e.kind === TOKEN_KIND)).toHaveLength(2);
  });

  it('a second device chains the supersede onto the event it restored', async () => {
    const { relay, identitySigner, walletSigner, api } = await setup();

    expect(await publishAllTokenEvents(api, walletSigner, { [MINT]: [proof('s1', 10), proof('s2', 20)] })).toBe(1);
    const [firstEvent] = tokenEventsFor(relay, walletSigner.pubkey);
    vi.advanceTimersByTime(2_000);
    expect(await publishAllTokenEvents(api, walletSigner, { [MINT]: [proof('s2', 20)] })).toBe(1);
    const spendA = tokenEventsFor(relay, walletSigner.pubkey).at(-1)!;

    // Device 2 restores the post-spend state, then spends s2 itself.
    localStorage.clear();
    const api2 = makeApi(relay, identitySigner);
    const { restored, walletSigner: restoredSigner } = await restoreWalletForIdentity(identitySigner, api2, bytes(0x99));
    expect((restored.proofsByMint[MINT] as unknown[])).toHaveLength(1);

    vi.advanceTimersByTime(2_000);
    expect(await publishAllTokenEvents(api2, restoredSigner, { [MINT]: [] })).toBe(1);
    const tombstone = tokenEventsFor(relay, walletSigner.pubkey).at(-1)!;
    const tombstonePayload = await decryptPayload(walletSigner, tombstone);
    // The chain covers BOTH prior events: the pre-spend one and the one
    // device 2 itself restored (it never saw the first device's local state).
    // Device 2 could only tombstone at all because restoring SEEDED the
    // tracked-mint set - a fresh device has never published this mint.
    expect(tombstonePayload.del).toContain(spendA.id);
    expect(tombstonePayload.del).toContain(firstEvent.id);

    // Device 3 sees a zero balance.
    localStorage.clear();
    const api3 = makeApi(relay, identitySigner);
    const { restored: restored3 } = await restoreWalletForIdentity(identitySigner, api3, bytes(0x99));
    expect(restored3.proofsByMint[MINT] ?? []).toHaveLength(0);
  });
});
