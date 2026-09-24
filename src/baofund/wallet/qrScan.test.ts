import { afterEach, expect, it } from 'vitest';
import { getEncodedToken } from 'cashu-ts3';
import { QrScanSession, setQrUrDecoderFactory, staticCodeKind } from './qrScan';

afterEach(() => setQrUrDecoderFactory(null));

function makeToken(proofCount = 1): string {
  return getEncodedToken({
    mint: 'https://mint.example.com',
    unit: 'sat',
    proofs: Array.from({ length: proofCount }, (_, i) => ({
      id: '00ad268c6d1f09e6',
      amount: 1,
      secret: `scan-secret-${i}-${'x'.repeat(60)}`,
      C: '02' + String(i + 10).padStart(2, '0').repeat(32),
    })),
  });
}

it('classifies static codes and completes immediately', async () => {
  const session = new QrScanSession();
  const token = makeToken();
  expect(await session.receive(token)).toEqual({ kind: 'code', value: token });
  expect(await session.receive('  lnbc1pqqq  ')).toEqual({ kind: 'code', value: 'lnbc1pqqq' });

  expect(staticCodeKind(token)).toBe('cashu');
  expect(staticCodeKind('LIGHTNING:LNBC1')).toBe('bolt11');
  expect(staticCodeKind('lntb1p')).toBe('bolt11');
  expect(staticCodeKind('https://example.com')).toBe('other');
});

it('reassembles a NUT-16 animated token frame by frame', async () => {
  const token = makeToken(20); // large enough to animate
  const { CashuUrEncoder } = await import('@/baofund/cashu-wallet/lib/cashu/nut16');
  const encoder = new CashuUrEncoder(token);
  const session = new QrScanSession();

  let frames = 0;
  let final: Awaited<ReturnType<QrScanSession['receive']>> | null = null;
  for (let i = 0; i < 5_000; i++) {
    frames += 1;
    final = await session.receive(encoder.nextPart());
    if (final.kind === 'ur-complete') break;
    if (final.kind !== 'ur-progress') throw new Error(`unexpected scan result ${final.kind}`);
    expect(final.progress).toBeGreaterThanOrEqual(0);
  }
  expect(final).toEqual({ kind: 'ur-complete', token });
  expect(frames).toBeGreaterThan(1);
});

it('fails closed when the animated decoder cannot load', async () => {
  setQrUrDecoderFactory(async () => { throw new Error('module unavailable'); });
  const session = new QrScanSession();
  await expect(session.receive('ur:bytes/1-2/abcdef')).rejects.toThrow(/cannot decode animated QR/i);
  // Static codes keep working without the decoder.
  expect((await session.receive(makeToken())).kind).toBe('code');
});

it('rejects empty and malformed frames', async () => {
  const session = new QrScanSession();
  await expect(session.receive('   ')).rejects.toThrow(/Empty scan/);
  await expect(session.receive('ur:bytes/not-a-valid-part')).rejects.toThrow();
});
