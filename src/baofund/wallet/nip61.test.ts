import { describe, it, expect, beforeEach } from 'vitest';
import { finalizeEvent, getPublicKey } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils.js';
import {
  parseMine,
  claimNutzaps,
  loadClaimedIds,
  markClaimedIds,
  CLAIMED_KEY,
  type RawNostrEvent,
} from './nip61';

// Real keypair so events carry VALID signatures - the vendored parser
// enforces verifyEvent.
const HEX = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const SENDER = getPublicKey(hexToBytes(HEX)); // real pubkey for the signing key
const RECIPIENT = 'aa'.repeat(32);
const OTHER = 'bb'.repeat(32);

/** Build a properly SIGNED kind:9321 nutzap from sender OTHER. */
function signNutzap(template: {
  kind?: number;
  tags?: string[][];
  content?: string;
  created_at?: number;
}): RawNostrEvent {
  return finalizeEvent(
    {
      kind: template.kind ?? 9321,
      created_at: template.created_at ?? 1700000000,
      tags:
        template.tags ??
        [
          ['p', RECIPIENT],
          ['u', 'https://mint.example'],
          ['proof', JSON.stringify({ id: '00aa', amount: 21, secret: 's1', C: 'c1' })],
        ],
      content: template.content ?? 'thanks',
    },
    hexToBytes(HEX),
  ) as RawNostrEvent;
}

function nutzapEvent(overrides: Partial<RawNostrEvent> = {}): RawNostrEvent {
  const signed = signNutzap({});
  // Only NON-security-relevant fields may be overridden post-signing;
  // structural overrides go through signNutzap instead.
  return { ...signed, ...overrides };
}

describe('parseMine', () => {
  it('parses a nutzap addressed to us', () => {
    const p = parseMine(nutzapEvent(), RECIPIENT);
    expect(p).not.toBeNull();
    expect(p!.recipient).toBe(RECIPIENT);
    expect(p!.sender).toBe(SENDER);
    expect(p!.amount).toBe(21);
    expect(p!.proofs).toHaveLength(1);
  });

  it('rejects nutzaps addressed to someone else', () => {
    // Event addressed to RECIPIENT must not match wallet key OTHER:
    expect(parseMine(signNutzap({}), OTHER)).toBeNull();
    // And one addressed to OTHER matches OTHER's wallet:
    const toOther = signNutzap({ tags: [['p', OTHER], ['u', 'https://mint.example'], ['proof', JSON.stringify({ id: 'x', amount: 1, secret: 's', C: 'c' })]] });
    expect(parseMine(toOther, OTHER)).not.toBeNull();
    expect(parseMine(toOther, RECIPIENT)).toBeNull();
  });

  it('rejects non-9321 kinds and malformed proofs', () => {
    expect(parseMine(signNutzap({ kind: 7 }), RECIPIENT)).toBeNull();
    const bad = signNutzap({ tags: [['p', RECIPIENT], ['u', 'https://mint.example'], ['proof', '{oops']] });
    expect(parseMine(bad, RECIPIENT)).toBeNull();
  });

  it('rejects events without an id', () => {
    expect(parseMine(nutzapEvent({ id: '' }), RECIPIENT)).toBeNull();
  });
});

describe('claimed-id persistence', () => {
  beforeEach(() => localStorage.removeItem(CLAIMED_KEY));

  it('starts empty, persists marks, caps the list', () => {
    expect(loadClaimedIds().size).toBe(0);
    markClaimedIds(['a', 'b']);
    expect(loadClaimedIds()).toEqual(new Set(['a', 'b']));
    markClaimedIds(Array.from({ length: 600 }, (_, i) => `id${i}`));
    expect(loadClaimedIds().size).toBeLessThanOrEqual(500);
  });
});

describe('claimNutzaps loop', () => {
  beforeEach(() => localStorage.removeItem(CLAIMED_KEY));

  function makeDeps(events: RawNostrEvent[], opts: { mint?: string; failFirst?: boolean } = {}) {
    const receivedTokens: string[] = [];
    const merged: number[] = [];
    const deps = {
      calls: 0,
      query: async () => events,
      walletPubkey: RECIPIENT,
      activeMint: opts.mint ?? 'https://mint.example',
      receive: async (tokenStr: string) => {
        if (opts.failFirst && deps.calls === 0) {
          deps.calls += 1;
          throw new Error('mint down');
        }
        receivedTokens.push(tokenStr);
        return [{ id: '00bb', amount: 21, secret: 'new', C: 'C2' }];
      },
      mergeProofs: async (received: unknown[]) => {
        merged.push(received.length);
      },
      receivedTokens,
      merged,
    };
    return deps;
  }

  it('claims a fresh same-mint nutzap end-to-end', async () => {
    const ev = nutzapEvent();
    const d = makeDeps([ev]);
    const res = await claimNutzaps(d);
    expect(res.claimed).toBe(1);
    expect(res.sats).toBe(21);
    expect(d.receivedTokens).toHaveLength(1);
    expect(d.merged).toEqual([1]);
    expect(loadClaimedIds().has(ev.id)).toBe(true);
  });

  it('is idempotent - second run skips claimed ids', async () => {
    const d = makeDeps([nutzapEvent()]);
    await claimNutzaps(d);
    const res2 = await claimNutzaps(d);
    expect(res2.claimed).toBe(0);
    expect(res2.alreadyClaimed).toBe(1);
    expect(d.receivedTokens).toHaveLength(1); // no double-receive
  });

  it('skips other-mint nutzaps and counts them', async () => {
    const d = makeDeps([nutzapEvent()], { mint: 'https://other.example' });
    const res = await claimNutzaps(d);
    expect(res.claimed).toBe(0);
    expect(res.skippedOtherMint).toBe(1);
    expect(d.receivedTokens).toHaveLength(0);
  });

  it('leaves a failed claim unmarked so it retries', async () => {
    // Build the event FIRST so we know its real signed id:
    const signedEv = nutzapEvent();
    const evId = signedEv.id;
    const d2 = makeDeps([signedEv], { failFirst: true });
    await expect(claimNutzaps(d2)).rejects.toThrow(/mint down/);
    expect(loadClaimedIds().has(evId)).toBe(false);
  });

  it('ignores nutzaps addressed to other people', async () => {
    const d = makeDeps([nutzapEvent({ tags: [['p', OTHER]] })]);
    const res = await claimNutzaps(d);
    expect(res.claimed).toBe(0);
    expect(d.receivedTokens).toHaveLength(0);
  });
});
