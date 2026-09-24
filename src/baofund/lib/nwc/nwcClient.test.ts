/**
 * nwcClient tests: a fake wallet speaks NIP-47 over a fake socket pair, so
 * the client's real signing and NIP-44/NIP-04 crypto are exercised end to end
 * without a relay or a wallet.
 */
import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey, type Event as NostrEvent } from 'nostr-tools/pure';
import { getConversationKey, encrypt as nip44Encrypt, decrypt as nip44Decrypt } from 'nostr-tools/nip44';
import { encrypt as nip04Encrypt, decrypt as nip04Decrypt } from 'nostr-tools/nip04';
import { NwcClient, NwcError, parseNwcUrl, type NwcSocket } from './nwcClient';

class FakeSocket implements NwcSocket {
  peer!: FakeSocket;
  onopen: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  onclose: ((ev?: unknown) => void) | null = null;

  send(data: string): void {
    setTimeout(() => this.peer.onmessage?.({ data }), 0);
  }
  close(): void {
    setTimeout(() => this.peer.onclose?.(), 0);
  }
  open(): void {
    setTimeout(() => this.onopen?.(), 0);
  }
}

function makePair(): [FakeSocket, FakeSocket] {
  const a = new FakeSocket();
  const b = new FakeSocket();
  a.peer = b;
  b.peer = a;
  return [a, b];
}

interface WalletOptions {
  enc?: 'nip44' | 'nip04';
  methods?: string[];
  balanceMsats?: number;
  balanceError?: { code: string; message: string };
  fail?: { code: string; message: string };
  sendInfo?: boolean;
}

function makeWallet(relay: FakeSocket, opts: WalletOptions = {}) {
  const enc = opts.enc ?? 'nip44';
  const walletPriv = generateSecretKey();
  const walletPub = getPublicKey(walletPriv);
  const methods = opts.methods ?? ['get_balance', 'pay_invoice', 'lookup_invoice'];
  let subId: string | null = null;

  const encryptTo = (clientPub: string, plain: string): string => (enc === 'nip44'
    ? nip44Encrypt(plain, getConversationKey(walletPriv, clientPub))
    : nip04Encrypt(walletPriv, clientPub, plain));
  const decryptFrom = (clientPub: string, payload: string): string => (enc === 'nip44'
    ? nip44Decrypt(payload, getConversationKey(walletPriv, clientPub))
    : nip04Decrypt(walletPriv, clientPub, payload));

  relay.onmessage = ({ data }) => {
    const msg = JSON.parse(String(data)) as unknown[];
    if (msg[0] === 'REQ') {
      const sub = msg[1] as string;
      const filter = msg[2] as { kinds?: number[] } | undefined;
      if (filter?.kinds?.includes(13194)) {
        if (opts.sendInfo !== false) {
          const info = finalizeEvent({
            kind: 13194,
            created_at: Math.floor(Date.now() / 1000),
            tags: [['encryption', enc === 'nip44' ? 'nip44_v2' : 'nip04']],
            content: methods.join(' '),
          }, walletPriv);
          relay.send(JSON.stringify(['EVENT', sub, info]));
        }
      } else {
        subId = sub;
      }
      return;
    }
    if (msg[0] === 'EVENT' && subId) {
      const req = msg[1] as NostrEvent;
      const { method } = JSON.parse(decryptFrom(req.pubkey, req.content)) as { method: string };
      const respond = (payload: unknown): void => {
        const res = finalizeEvent({
          kind: 23195,
          created_at: Math.floor(Date.now() / 1000),
          tags: [['p', req.pubkey], ['e', req.id]],
          content: encryptTo(req.pubkey, JSON.stringify(payload)),
        }, walletPriv);
        relay.send(JSON.stringify(['EVENT', subId, res]));
      };
      if (opts.fail && method === 'pay_invoice') {
        respond({ result_type: method, error: opts.fail, result: null });
        return;
      }
      if (opts.balanceError && method === 'get_balance') {
        respond({ result_type: method, error: opts.balanceError, result: null });
        return;
      }
      const result: Record<string, unknown> = method === 'pay_invoice'
        ? { preimage: 'ab'.repeat(32) }
        : method === 'get_balance'
          ? { balance: opts.balanceMsats ?? 21_000 }
          : method === 'lookup_invoice'
            ? { state: 'settled' }
            : {};
      respond({ result_type: method, error: null, result });
    }
  };

  return { walletPub, walletPriv };
}

function connectionFor(walletPub: string): string {
  return `nostr+walletconnect://${walletPub}?relay=wss://relay.example&secret=${'11'.repeat(32)}`;
}

function clientFor(walletPub: string, socket: FakeSocket): NwcClient {
  return new NwcClient({
    connection: connectionFor(walletPub),
    socketFactory: () => socket,
    timeoutMs: 2_000,
    infoTimeoutMs: 500,
  });
}

describe('parseNwcUrl', () => {
  it('parses pubkey, relay and secret', () => {
    const pub = 'a'.repeat(64);
    const parsed = parseNwcUrl(connectionFor(pub));
    expect(parsed.walletPubkey).toBe(pub);
    expect(parsed.relays).toEqual(['wss://relay.example']);
    expect(parsed.secret).toBe('11'.repeat(32));
  });

  it('rejects strings that are not NWC connections', () => {
    expect(() => parseNwcUrl('https://example.com')).toThrow(NwcError);
    expect(() => parseNwcUrl('')).toThrow(NwcError);
  });
});

describe('NwcClient', () => {
  it('connects, learns the wallet info, reads balance and pays', async () => {
    const [clientSocket, relaySocket] = makePair();
    const { walletPub } = makeWallet(relaySocket, { balanceMsats: 123_000 });
    const client = clientFor(walletPub, clientSocket);

    const connecting = client.connect();
    clientSocket.open();
    await connecting;
    expect(client.encryptionVersion).toBe('nip44');

    const info = await client.getInfo();
    expect(info.methods).toContain('pay_invoice');
    expect(info.encryptions).toContain('nip44_v2');

    expect(await client.getBalance()).toBe(123_000);
    const { preimage } = await client.payInvoice('lnbc1test');
    expect(preimage).toBe('ab'.repeat(32));
    expect(await client.lookupInvoice({ payment_hash: 'ff'.repeat(32) })).toMatchObject({ state: 'settled' });
    client.close();
  });

  it('downgrades to NIP-04 when the wallet only advertises it', async () => {
    const [clientSocket, relaySocket] = makePair();
    const { walletPub } = makeWallet(relaySocket, { enc: 'nip04', balanceMsats: 5_000 });
    const client = clientFor(walletPub, clientSocket);

    const connecting = client.connect();
    clientSocket.open();
    await connecting;
    const info = await client.getInfo();
    expect(info.encryptions).toEqual(['nip04']);
    expect(client.encryptionVersion).toBe('nip04');
    expect(await client.getBalance()).toBe(5_000);
    client.close();
  });

  it('returns null when the wallet does not implement get_balance', async () => {
    const [clientSocket, relaySocket] = makePair();
    const { walletPub } = makeWallet(relaySocket, {
      balanceError: { code: 'NOT_IMPLEMENTED', message: 'get_balance not implemented' },
    });
    const client = clientFor(walletPub, clientSocket);

    const connecting = client.connect();
    clientSocket.open();
    await connecting;
    expect(await client.getBalance()).toBeNull();
    client.close();
  });

  it('rejects with the wallet error code on payment failure', async () => {
    const [clientSocket, relaySocket] = makePair();
    const { walletPub } = makeWallet(relaySocket, {
      fail: { code: 'INSUFFICIENT_BALANCE', message: 'not enough sats' },
    });
    const client = clientFor(walletPub, clientSocket);

    const connecting = client.connect();
    clientSocket.open();
    await connecting;
    await expect(client.payInvoice('lnbc1test')).rejects.toMatchObject({
      name: 'NwcError',
      code: 'INSUFFICIENT_BALANCE',
      message: 'not enough sats',
    });
    client.close();
  });

  it('self-heals to NIP-04 for responses when no info event is published', async () => {
    const [clientSocket, relaySocket] = makePair();
    // Wallet speaks NIP-04 but never announces it. The client sends its first
    // request with the NIP-44 default; this fake wallet answers both ways, so
    // the point under test is the response fallback path.
    const walletPriv = generateSecretKey();
    const walletPub = getPublicKey(walletPriv);
    let subId: string | null = null;
    relaySocket.onmessage = ({ data }) => {
      const msg = JSON.parse(String(data)) as unknown[];
      if (msg[0] === 'REQ') {
        const filter = msg[2] as { kinds?: number[] } | undefined;
        if (!filter?.kinds?.includes(13194)) subId = msg[1] as string;
        return;
      }
      if (msg[0] !== 'EVENT' || !subId) return;
      const req = msg[1] as NostrEvent;
      const plain = nip44Decrypt(req.content, getConversationKey(walletPriv, req.pubkey));
      const { method } = JSON.parse(plain) as { method: string };
      const res = finalizeEvent({
        kind: 23195,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', req.pubkey], ['e', req.id]],
        content: nip04Encrypt(walletPriv, req.pubkey, JSON.stringify({
          result_type: method,
          error: null,
          result: { balance: 7_000 },
        })),
      }, walletPriv);
      relaySocket.send(JSON.stringify(['EVENT', subId, res]));
    };

    const client = clientFor(walletPub, clientSocket);
    const connecting = client.connect();
    clientSocket.open();
    await connecting;
    expect(await client.getBalance()).toBe(7_000);
    expect(client.encryptionVersion).toBe('nip04');
    client.close();
  });
});
