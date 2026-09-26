import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const discoverMints = vi.fn(async (_opts?: unknown): Promise<unknown[]> => []);
const fetchFollowPubkeys = vi.fn(async (_pubkey?: string): Promise<string[]> => []);
const buildMintRecommendationEvent = vi.fn((input: Record<string, unknown>) => ({
  kind: 38000,
  created_at: 1_700_000_000,
  tags: [['d', String(input.mintId ?? input.mintUrl)], ['k', '38172'], ['u', String(input.mintUrl)], ...(input.rating ? [['rating', String(input.rating)]] : [])],
  content: String(input.content ?? ''),
}));
const publishMintRecommendation = vi.fn(async (_relays: unknown, _event: unknown): Promise<number> => 2);
const upsertRecommendation = vi.fn((mints: unknown[], _rec?: unknown) => mints);
const rememberPublishedReview = vi.fn((..._args: unknown[]) => undefined);
const cooldown = { ms: 0 };
const auth = { pubkey: null as string | null, signer: null as unknown };

vi.mock('./mintDiscovery', () => ({
  discoverMints: (opts?: unknown) => discoverMints(opts),
  fetchFollowPubkeys: (pubkey?: string) => fetchFollowPubkeys(pubkey),
  fetchMintInfo: vi.fn(async () => null),
  fetchMintAudit: vi.fn(async () => null),
  buildMintRecommendationEvent: (input: Record<string, unknown>) => buildMintRecommendationEvent(input),
  parseDiscoveryRelays: () => ['wss://relay.discovery.example'],
  parseMintRecommendation: (event: { content: string; pubkey: string; created_at: number; id: string; tags: string[][] }) => ({
    eventId: event.id,
    createdAt: event.created_at,
    author: event.pubkey,
    mintId: event.tags.find((t) => t[0] === 'd')?.[1] ?? '',
    mintUrls: event.tags.filter((t) => t[0] === 'u').map((t) => t[1]),
    rating: Number(event.tags.find((t) => t[0] === 'rating')?.[1] ?? 0) || undefined,
    content: event.content,
  }),
  publishMintRecommendation: (relays: unknown, event: unknown) => publishMintRecommendation(relays, event),
  upsertRecommendation: (mints: unknown[], rec: unknown) => upsertRecommendation(mints, rec),
  rememberPublishedReview: (...args: unknown[]) => rememberPublishedReview(...args),
  getPublishedReview: () => null,
  reviewCooldownRemainingMs: () => cooldown.ms,
}));
vi.mock('../auth/useAuth', () => ({
  useAuth: () => auth,
}));

import { MintDiscovery } from './MintDiscovery';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  discoverMints.mockReset();
  fetchFollowPubkeys.mockClear();
  buildMintRecommendationEvent.mockClear();
  publishMintRecommendation.mockReset();
  publishMintRecommendation.mockResolvedValue(2);
  upsertRecommendation.mockClear();
  rememberPublishedReview.mockClear();
  cooldown.ms = 0;
  auth.pubkey = null;
  auth.signer = null;
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(props: React.ComponentProps<typeof MintDiscovery>): Promise<void> {
  await act(async () => root.render(<MintDiscovery {...props} />));
}

const MINT = {
  url: 'https://mint.example.com',
  name: 'Example Mint',
  network: 'mainnet' as const,
  nuts: [4, 5, 7],
  recommendations: [{ eventId: 'r1', author: 'a', mintId: 'm', mintUrls: ['https://mint.example.com'], rating: 5, content: '' }],
  avgRating: 5,
  score: 4,
};

it('loads discovered mints on open and adds one', async () => {
  discoverMints.mockResolvedValue([MINT]);
  const onAdd = vi.fn(async () => undefined);
  await render({ addedUrls: new Set<string>(), onAdd });

  await act(async () => {
    container.querySelector('[data-testid=mint-discovery-toggle]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await vi.waitFor(() => {
    expect(container.querySelectorAll('[data-testid=mint-discovery-item]').length).toBe(1);
  }, { timeout: 5000 });

  expect(discoverMints).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain('Example Mint');
  expect(container.textContent).toContain('mainnet');
  expect(container.textContent).toContain('NUT-4');

  await act(async () => {
    container.querySelector('[data-testid="mint-add-https://mint.example.com"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  expect(onAdd).toHaveBeenCalledWith('https://mint.example.com');
});

it('marks already-added mints and filters by search', async () => {
  discoverMints.mockResolvedValue([
    MINT,
    { ...MINT, url: 'https://other.example.com', name: 'Other Mint', network: 'signet' as const, recommendations: [], avgRating: undefined, score: 1 },
  ]);
  await render({ addedUrls: new Set(['https://mint.example.com']), onAdd: vi.fn(async () => undefined) });
  await act(async () => {
    container.querySelector('[data-testid=mint-discovery-toggle]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await vi.waitFor(() => {
    expect(container.querySelectorAll('[data-testid=mint-discovery-item]').length).toBe(2);
  }, { timeout: 5000 });

  const added = container.querySelector('[data-testid="mint-add-https://mint.example.com"]') as HTMLButtonElement;
  expect(added.textContent).toContain('Added');
  expect(added.disabled).toBe(true);

  await act(async () => {
    const input = container.querySelector('[data-testid=mint-discovery-search]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, 'other');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(container.querySelectorAll('[data-testid=mint-discovery-item]').length).toBe(1);
  expect(container.textContent).toContain('Other Mint');
});

const PUB = 'a'.repeat(64);

it('publishes a review with the signed-in key, echoes it locally and arms the cooldown', async () => {
  discoverMints.mockResolvedValue([MINT]);
  auth.pubkey = PUB;
  const signEvent = vi.fn(async (template: Record<string, unknown>) => ({
    ...template,
    id: 'signed-review',
    pubkey: PUB,
    sig: 'f'.repeat(128),
  }));
  auth.signer = { signEvent };
  publishMintRecommendation.mockImplementation(async () => {
    cooldown.ms = 120_000; // the next render must show the guard
    return 2;
  });

  await render({ addedUrls: new Set<string>(), onAdd: vi.fn(async () => undefined) });
  await act(async () => {
    container.querySelector('[data-testid=mint-discovery-toggle]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await vi.waitFor(() => {
    expect(container.querySelectorAll('[data-testid=mint-discovery-item]').length).toBe(1);
  }, { timeout: 5000 });

  await act(async () => {
    container.querySelector('[data-testid="mint-details-https://mint.example.com"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await vi.waitFor(() => {
    expect(container.querySelector('[data-testid="mint-review-https://mint.example.com"]')).toBeTruthy();
  }, { timeout: 5000 });

  await act(async () => {
    container.querySelector('[data-testid="mint-review-star-https://mint.example.com-4"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const text = container.querySelector('[data-testid="mint-review-text-https://mint.example.com"]') as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(text, 'nice mint');
    text.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    container.querySelector('[data-testid="mint-review-publish-https://mint.example.com"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  expect(buildMintRecommendationEvent).toHaveBeenCalledWith({
    mintUrl: 'https://mint.example.com',
    mintId: undefined,
    rating: 4,
    content: 'nice mint',
  });
  expect(signEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: 38000 }));
  expect(publishMintRecommendation).toHaveBeenCalledWith(
    ['wss://relay.discovery.example'],
    expect.objectContaining({ id: 'signed-review' }),
  );
  expect(upsertRecommendation).toHaveBeenCalledTimes(1);
  expect(rememberPublishedReview).toHaveBeenCalledWith(PUB, 'https://mint.example.com', { rating: 4, content: 'nice mint' });
  expect(container.textContent).toContain('Review published to 2 relays');

  const publishBtn = container.querySelector('[data-testid="mint-review-publish-https://mint.example.com"]') as HTMLButtonElement;
  expect(publishBtn.disabled).toBe(true);
  expect(publishBtn.textContent).toContain('Update in 2 min');
});

it('hides the review composer while signed out', async () => {
  discoverMints.mockResolvedValue([MINT]);
  await render({ addedUrls: new Set<string>(), onAdd: vi.fn(async () => undefined) });
  await act(async () => {
    container.querySelector('[data-testid=mint-discovery-toggle]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await vi.waitFor(() => {
    expect(container.querySelectorAll('[data-testid=mint-discovery-item]').length).toBe(1);
  }, { timeout: 5000 });
  await act(async () => {
    container.querySelector('[data-testid="mint-details-https://mint.example.com"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await vi.waitFor(() => {
    expect(container.textContent).toContain('no independent audit observations');
  }, { timeout: 5000 });
  expect(container.querySelector('[data-testid="mint-review-https://mint.example.com"]')).toBeNull();
});
