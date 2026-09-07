import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { bech32 } from '@scure/base';

import { useGammaPayment } from './useGammaPayment';
import { useNWCInternal } from './useNWC';
import type { NWCConnection } from './useNWC';

// ── bolt11 crafting (attacker model: checksum-valid invoices — round 27b) ──
function bytesToWords(bytes: Uint8Array): number[] {
  const words: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      words.push((acc >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) words.push((acc << (5 - bits)) & 31);
  return words;
}

function hexToWords(hex: string): number[] {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytesToWords(out);
}

function craftInvoice(hrp: string, tsSec = 1_700_000_000): string {
  const words: number[] = [];
  for (let i = 6; i >= 0; i--) words.push(Math.floor(tsSec / 2 ** (5 * i)) & 31);
  const ph = hexToWords('15'.repeat(32));
  words.push(1, ph.length >> 5, ph.length & 31, ...ph);
  const sigAndRecovery = new Uint8Array(65);
  sigAndRecovery.fill(0x42, 0, 64);
  sigAndRecovery[64] = 0x01;
  words.push(...bytesToWords(sigAndRecovery));
  return bech32.encode(hrp, words, Number.MAX_SAFE_INTEGER);
}

const invoiceForSats = (sats: number) => craftInvoice(`lnbc${String(sats * 10)}n`);

// ── controllable mocks ──
const { toastMock, nwcSendPayment, walletState, storageBags } = vi.hoisted(() => ({
  toastMock: vi.fn(),
  nwcSendPayment: vi.fn(),
  walletState: {
    hasNWC: false,
    webln: null as { sendPayment: ReturnType<typeof vi.fn> } | null,
    activeNWC: null as NWCConnection | null,
  },
  storageBags: {
    connections: [[], vi.fn(), true] as [unknown, ReturnType<typeof vi.fn>, boolean],
    active: [null, vi.fn(), true] as [unknown, ReturnType<typeof vi.fn>, boolean],
  },
}));

vi.mock('@/hooks/useEncryptedSecureLocalStorage', () => ({
  useEncryptedSecureLocalStorage: vi.fn((key: string, _defaultValue: unknown) => {
    if (key.startsWith('nwc-connections:')) return storageBags.connections;
    return storageBags.active;
  }),
}));

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: vi.fn(() => ({ user: null })),
}));

vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ toast: toastMock }) }));

vi.mock('@getalby/sdk', () => ({ LN: vi.fn() }));

vi.mock('@/hooks/useNWCContext', () => ({
  useNWC: () => ({ sendPayment: nwcSendPayment }),
}));

vi.mock('@/hooks/useWallet', () => ({
  useWallet: () => ({
    hasNWC: walletState.hasNWC,
    webln: walletState.webln,
    activeNWC: walletState.activeNWC,
    activeConnection: walletState.activeNWC,
    preferredMethod: walletState.activeNWC ? 'nwc' : walletState.webln ? 'webln' : 'manual',
    payWithNWC: vi.fn(),
  }),
}));

vi.mock('@/hooks/useCashuWalletContext', () => ({
  useCashuWalletContext: () => ({ seedAvailable: false, payInvoice: vi.fn(), payBolt12: vi.fn() }),
}));

function activeConn(): NWCConnection {
  return {
    connectionString: 'nostr+walletconnect://x?pubkey=' + 'c'.repeat(64) + '&relay=wss://r&secret=s',
    alias: 'TestWallet',
    isConnected: true,
  };
}

beforeEach(() => {
  nwcSendPayment.mockReset();
  nwcSendPayment.mockResolvedValue({ preimage: 'ff'.repeat(32) });
  walletState.hasNWC = false;
  walletState.webln = null;
  walletState.activeNWC = null;
});

describe('useGammaPayment — round 29 amount-substitution defense', () => {
  it('refuses a bolt11 option whose invoice encodes a different amount (NWC path)', async () => {
    walletState.activeNWC = activeConn();
    walletState.hasNWC = true;
    const { result } = renderHook(() => useGammaPayment());

    // Listing says 1,000 sats; the supplied invoice encodes 10,000 sats.
    await act(async () => {
      await expect(
        result.current.pay({ medium: 'lightning', reference: 'order-test', value: invoiceForSats(10_000) }, 1_000),
      ).rejects.toThrow(/does not match the confirmed amount/);
    });
    expect(nwcSendPayment).not.toHaveBeenCalled();
  });

  it('refuses an unparseable invoice instead of paying blindly', async () => {
    walletState.activeNWC = activeConn();
    const { result } = renderHook(() => useGammaPayment());
    await act(async () => {
      await expect(
        result.current.pay({ medium: 'lightning', reference: 'order-test', value: 'not-an-invoice' }, 500),
      ).rejects.toThrow(/does not match the confirmed amount/);
    });
    expect(nwcSendPayment).not.toHaveBeenCalled();
  });

  it('pays when the invoice amount matches the confirmed amount', async () => {
    walletState.activeNWC = activeConn();
    walletState.hasNWC = true;
    const { result } = renderHook(() => useGammaPayment());
    let out: Awaited<ReturnType<ReturnType<typeof useGammaPayment>['pay']>> | undefined;
    await act(async () => {
      out = await result.current.pay({ medium: 'lightning', reference: 'order-test', value: invoiceForSats(2_500) }, 2_500);
    });
    expect(out?.success).toBe(true);
    expect(nwcSendPayment).toHaveBeenCalledTimes(1);
  });

  it('WebLN path is guarded by the same amount check', async () => {
    walletState.webln = { sendPayment: vi.fn(async () => ({ preimage: 'x' })) };
    const { result } = renderHook(() => useGammaPayment());
    await act(async () => {
      await expect(
        result.current.pay({ medium: 'lightning', reference: 'order-test', value: invoiceForSats(99_000) }, 1_000),
      ).rejects.toThrow(/does not match the confirmed amount/);
    });
    expect(walletState.webln.sendPayment).not.toHaveBeenCalled();
  });
});

describe('useNWCInternal.getActiveConnection — round 29 purity', () => {
  it('returns null when nothing is active WITHOUT writing state (no render-phase setState)', () => {
    storageBags.connections = [[activeConn()], vi.fn(), true];
    storageBags.active = [null, vi.fn(), true];
    const setActive = storageBags.active[1];

    const { result } = renderHook(() => useNWCInternal('user-pubkey'));
    const before = setActive.mock.calls.length;
    let conn: NWCConnection | null = null;
    act(() => {
      conn = result.current.getActiveConnection();
    });
    expect(conn).toBeNull();
    // The function itself performed zero writes (the auto-select effect may
    // have written once during mount — that is its job now).
    expect(setActive.mock.calls.length).toBe(before);
  });

  it('returns the active connection when set and present', () => {
    const conn = activeConn();
    storageBags.connections = [[conn], vi.fn(), true];
    storageBags.active = [conn.connectionString, vi.fn(), true];

    const { result } = renderHook(() => useNWCInternal('user-pubkey'));
    const conn2 = result.current.getActiveConnection();
    expect(conn2?.connectionString).toBe(conn.connectionString);
  });

  it('returns null (not a phantom auto-heal) when the stored active id is stale', () => {
    storageBags.connections = [[], vi.fn(), true];
    storageBags.active = ['nostr+walletconnect://gone', vi.fn(), true];

    const { result } = renderHook(() => useNWCInternal('user-pubkey'));
    let conn: NWCConnection | null = null;
    act(() => {
      conn = result.current.getActiveConnection();
    });
    expect(conn).toBeNull();
  });
});
