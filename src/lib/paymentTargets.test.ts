import { describe, expect, it } from 'vitest';
import {
  parsePaymentTargets,
  paymentTargetsToTags,
  findBitcoinTarget,
  findLightningTarget,
  findBolt12Target,
  isSilentPaymentLike,
  PAYMENT_TARGETS_KIND,
} from '@/lib/paymentTargets';
import type { NostrEvent } from '@nostrify/nostrify';

function makeEvent(tags: string[][]): NostrEvent {
  return {
    id: '1',
    pubkey: '00',
    kind: PAYMENT_TARGETS_KIND,
    tags,
    content: '',
    created_at: 0,
    sig: '',
  };
}

describe('parsePaymentTargets', () => {
  it('returns empty for non-10133 events', () => {
    expect(parsePaymentTargets({ ...makeEvent([]), kind: 0 })).toEqual([]);
  });

  it('parses bitcoin and lightning targets', () => {
    const event = makeEvent([
      ['payto', 'bitcoin', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'],
      ['payto', 'lightning', 'user@walletofsatoshi.com'],
    ]);
    const targets = parsePaymentTargets(event);
    expect(targets).toHaveLength(2);
    expect(findBitcoinTarget(targets)?.authority).toBe('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq');
    expect(findLightningTarget(targets)?.authority).toBe('user@walletofsatoshi.com');
  });

  it('keeps only the first target per type', () => {
    const event = makeEvent([
      ['payto', 'bitcoin', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'],
      ['payto', 'bitcoin', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'],
    ]);
    const targets = parsePaymentTargets(event);
    expect(targets).toHaveLength(1);
    expect(targets[0].authority).toBe('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq');
  });

  it('drops invalid authorities', () => {
    const event = makeEvent([
      ['payto', 'bitcoin', 'not-an-address'],
      ['payto', 'revolut', 'alice'],
    ]);
    const targets = parsePaymentTargets(event);
    expect(targets.find((t) => t.type === 'bitcoin')).toBeUndefined();
    expect(targets.find((t) => t.type === 'revolut')?.authority).toBe('alice');
  });

  it('normalizes types to lowercase', () => {
    const event = makeEvent([['payto', 'BITCOIN', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq']]);
    const targets = parsePaymentTargets(event);
    expect(targets[0].type).toBe('bitcoin');
  });

  it('drops unrecognized payment types', () => {
    const event = makeEvent([['payto', 'paypal', 'user@example.com']]);
    expect(parsePaymentTargets(event)).toEqual([]);
  });

  it('detects silent payment authorities', () => {
    expect(isSilentPaymentLike('sp1qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqf')).toBe(true);
    expect(isSilentPaymentLike('bc1qexample')).toBe(false);
  });

  it('parses a BOLT12 offer target', () => {
    const offer = 'lno1qgsyxjtl6luzd9t0prj3gf6me7yqhp0stspeq9fe5p2p5vflmxvftemgwpn0v6z7w3pk4epvmyv9e9f8g3h7r';
    const event = makeEvent([['payto', 'bolt12', offer]]);
    const targets = parsePaymentTargets(event);
    expect(targets).toHaveLength(1);
    expect(findBolt12Target(targets)?.authority).toBe(offer);
  });

  it('accepts bolt12: URI scheme and normalizes it away', () => {
    const offer = 'lno1qgsyxjtl6luzd9t0prj3gf6me7yqhp0stspeq9fe5p2p5vflmxvftemgwpn0v6z7w3pk4epvmyv9e9f8g3h7r';
    const tags = paymentTargetsToTags([{ type: 'bolt12', authority: `bolt12:${offer}` }]);
    expect(tags).toEqual([['payto', 'bolt12', offer]]);
  });

  it('drops invalid BOLT12 authorities', () => {
    const event = makeEvent([['payto', 'bolt12', 'not-an-offer']]);
    expect(parsePaymentTargets(event)).toEqual([]);
  });
});

describe('paymentTargetsToTags', () => {
  it('serializes valid targets in registry order', () => {
    const tags = paymentTargetsToTags([
      { type: 'lightning', authority: 'user@walletofsatoshi.com' },
      { type: 'bitcoin', authority: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq' },
    ]);
    expect(tags).toEqual([
      ['payto', 'bitcoin', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'],
      ['payto', 'lightning', 'user@walletofsatoshi.com'],
    ]);
  });

  it('drops invalid and duplicate targets', () => {
    const tags = paymentTargetsToTags([
      { type: 'bitcoin', authority: 'not-an-address' },
      { type: 'bitcoin', authority: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq' },
      { type: 'bitcoin', authority: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa' },
    ]);
    expect(tags).toEqual([['payto', 'bitcoin', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq']]);
  });
});
