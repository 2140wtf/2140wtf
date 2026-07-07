import { describe, expect, it, vi } from 'vitest';
import { finalizeEvent, getPublicKey } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils.js';
import type { NostrEvent } from '@nostrify/nostrify';

import { sendToInboxRelays } from './inboxRelays';

const aliceSk = hexToBytes('0000000000000000000000000000000000000000000000000000000000000001');
const alicePubkey = getPublicKey(aliceSk);
const bobSk = hexToBytes('0000000000000000000000000000000000000000000000000000000000000002');
const _bobPubkey = getPublicKey(bobSk);

function createRelayListEvent(relays: string[], signer: Uint8Array): NostrEvent {
  return finalizeEvent(
    {
      kind: 10002,
      created_at: 1000,
      content: '',
      tags: relays.map((url) => ['r', url, 'read']),
    },
    signer,
  );
}

function createNoteEvent(signer: Uint8Array): NostrEvent {
  return finalizeEvent(
    {
      kind: 1,
      created_at: 1000,
      content: 'hello',
      tags: [],
    },
    signer,
  );
}

function createMockNostr(events: NostrEvent[]) {
  return {
    query: vi.fn().mockResolvedValue(events),
    group: vi.fn().mockReturnValue({ event: vi.fn().mockResolvedValue(undefined) }),
    event: vi.fn().mockResolvedValue(undefined),
  };
}

describe('sendToInboxRelays', () => {
  it('publishes to read relays of tagged users', async () => {
    const event = createRelayListEvent(['wss://alice.relay'], aliceSk);
    const nostr = createMockNostr([event]);

    await sendToInboxRelays(nostr, createNoteEvent(bobSk), [alicePubkey]);

    expect(nostr.group).toHaveBeenCalledWith(['wss://alice.relay/']);
  });

  it('ignores relay lists with invalid signatures', async () => {
    const event = JSON.parse(JSON.stringify(createRelayListEvent(['wss://alice.relay'], aliceSk))) as NostrEvent;
    event.sig = event.sig.slice(0, -1) + (event.sig.slice(-1) === '0' ? '1' : '0');
    const nostr = createMockNostr([event]);

    await sendToInboxRelays(nostr, createNoteEvent(bobSk), [alicePubkey]);

    expect(nostr.group).not.toHaveBeenCalled();
  });

  it('ignores relay lists authored by someone other than the tagged user', async () => {
    const event = createRelayListEvent(['wss://bob.relay'], bobSk);
    const nostr = createMockNostr([event]);

    await sendToInboxRelays(nostr, createNoteEvent(bobSk), [alicePubkey]);

    expect(nostr.group).not.toHaveBeenCalled();
  });

  it('does not send back to the event author', async () => {
    const event = createRelayListEvent(['wss://alice.relay'], aliceSk);
    const nostr = createMockNostr([event]);

    await sendToInboxRelays(nostr, createNoteEvent(aliceSk), [alicePubkey]);

    expect(nostr.group).not.toHaveBeenCalled();
  });
});
