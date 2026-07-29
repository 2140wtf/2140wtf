import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useChasePayout } from './useChasePayout';
import { CHASE_FIAT_COST } from './types';

const PUBKEY = '0000000000000000000000000000000000000000000000000000000000000001';

const mocks = vi.hoisted(() => ({
  publishEvent: vi.fn(),
  updateNostrPetProfile: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: PUBKEY } }),
}));

vi.mock('@nostrify/react', () => ({
  useNostr: () => ({ nostr: {} }),
}));

vi.mock('@/hooks/useAppContext', () => ({
  useAppContext: () => ({ config: {} }),
}));

vi.mock('@/pets/core/hooks/usePetsNostrPublish', () => ({
  usePetsNostrPublish: () => ({ mutateAsync: mocks.publishEvent, petsEnabled: true }),
}));

vi.mock('@/hooks/useToast', () => ({
  toast: mocks.toast,
}));

vi.mock('@/pets/core/lib/profile-sats', () => ({
  updateNostrPetProfile: mocks.updateNostrPetProfile,
}));

vi.mock('@/pets/core/lib/missions', () => ({
  serializeProfileContent: (prev: unknown) => JSON.stringify(prev ?? {}),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

interface CapturedUpdate {
  tags: string[][];
  meta: Record<string, unknown>;
}

/**
 * Runs the fiat-mode update callback the way the real updateNostrPetProfile
 * would: with a fresh relay profile carrying `coins`, and captures what the
 * callback asked to publish.
 */
function arrangeFiatProfile(coins: number) {
  const captured: { update?: CapturedUpdate } = {};
  mocks.updateNostrPetProfile.mockImplementation(
    async (_nostr: unknown, _publish: unknown, _pubkey: string, cb: (fresh: unknown, prevTags: string[][], prevContent: unknown) => Promise<CapturedUpdate>) => {
      const freshProfile = {
        coins,
        sats: 0,
        event: { tags: [['d', 'profile-d'], ['coins', String(coins)]], content: '{}' },
      };
      const update = await cb(freshProfile, freshProfile.event.tags, {});
      captured.update = update;
      return {
        event: { kind: 11125, tags: update.tags, content: '{}' },
        meta: update.meta,
        profile: { coins, sats: 0 },
      };
    },
  );
  return captured;
}

describe('useChasePayout fiat settle (hunt regression [17])', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deducts the run cost AND credits winnings on the published coins tag', async () => {
    // Regression: the fiat branch used to republish the UNMODIFIED tag list,
    // so the 10-coin run cost was never deducted and winnings never landed —
    // runs were free and coins vanished.
    const startCoins = 100;
    const winnings = 7;
    const captured = arrangeFiatProfile(startCoins);
    const updateProfileEvent = vi.fn();

    const { result } = renderHook(() => useChasePayout(updateProfileEvent), { wrapper });
    result.current.mutate({ satsWon: 0, coinsCollected: winnings, mode: 'fiat' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const expectedTotal = startCoins - CHASE_FIAT_COST + winnings;
    expect(captured.update?.tags.find((t) => t[0] === 'coins')?.[1]).toBe(String(expectedTotal));
    expect(result.current.data?.newCoinsTotal).toBe(expectedTotal);
    expect(result.current.data?.amountAwarded).toBe(winnings);

    // The caller's local profile cache receives the updated event too.
    const published = updateProfileEvent.mock.calls[0]?.[0] as { tags: string[][] } | undefined;
    expect(published?.tags.find((t) => t[0] === 'coins')?.[1]).toBe(String(expectedTotal));
  });

  it('records a net loss when the run collects nothing', async () => {
    const startCoins = 100;
    const captured = arrangeFiatProfile(startCoins);

    const { result } = renderHook(() => useChasePayout(vi.fn()), { wrapper });
    result.current.mutate({ satsWon: 0, coinsCollected: 0, mode: 'fiat' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(captured.update?.tags.find((t) => t[0] === 'coins')?.[1]).toBe(String(startCoins - CHASE_FIAT_COST));
  });

  it('refuses the settle when the profile cannot cover the run cost', async () => {
    arrangeFiatProfile(CHASE_FIAT_COST - 1);

    const { result } = renderHook(() => useChasePayout(vi.fn()), { wrapper });
    result.current.mutate({ satsWon: 0, coinsCollected: 50, mode: 'fiat' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toContain('Insufficient coins');
  });
});
