import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Balance, Movement, OnchainBalance, SendRequest } from '@secondts/barkd';

import { BARKD_ERROR_CODES, getBarkdApis, isBarkdError, withFriendlyBarkdErrors } from '@/lib/barkd';

/**
 * Data hooks for a connected barkd server. All of them are keyed by server URL
 * and only enabled while `useBarkdConnection` reports a live session. Every
 * generated-client call goes through `withFriendlyBarkdErrors` so the UI
 * never shows the OpenAPI client's raw "Response returned an error code".
 */

/**
 * When a mutation hits a 401-mapped error, revalidate the session query so
 * the app drops back to the connect form (or silently re-logs-in) right away
 * instead of leaving a "reconnect" instruction on screen with nowhere to go.
 */
function revalidateSessionOnAuthError(queryClient: QueryClient, error: unknown) {
  if (isBarkdError(error, BARKD_ERROR_CODES.sessionExpired)) {
    queryClient.invalidateQueries({ queryKey: ['barkd', 'session'] });
  }
}

/** queryFn wrapper: friendly errors + session revalidation on a 401. */
function barkdQuery<T>(queryClient: QueryClient, fn: () => Promise<T>): () => Promise<T> {
  return async () => {
    try {
      return await withFriendlyBarkdErrors(fn());
    } catch (error) {
      revalidateSessionOnAuthError(queryClient, error);
      throw error;
    }
  };
}

export function useBarkdBalance(serverUrl: string, enabled: boolean) {
  const queryClient = useQueryClient();
  return useQuery<Balance>({
    queryKey: ['barkd', 'balance', serverUrl],
    queryFn: barkdQuery(queryClient, () => getBarkdApis(serverUrl).wallet.balance()),
    enabled,
    refetchInterval: 15_000,
  });
}

/** Movement history, returned by the server newest-first. */
export function useBarkdMovements(serverUrl: string, enabled: boolean) {
  const queryClient = useQueryClient();
  return useQuery<Movement[]>({
    queryKey: ['barkd', 'movements', serverUrl],
    queryFn: barkdQuery(queryClient, () => getBarkdApis(serverUrl).history.list({})),
    enabled,
    refetchInterval: 30_000,
  });
}

export function useBarkdOnchainBalance(serverUrl: string, enabled: boolean) {
  const queryClient = useQueryClient();
  return useQuery<OnchainBalance>({
    queryKey: ['barkd', 'onchain-balance', serverUrl],
    queryFn: barkdQuery(queryClient, () => getBarkdApis(serverUrl).onchain.onchainBalance()),
    enabled,
    refetchInterval: 30_000,
  });
}

/**
 * Reactive read of a cached generated receive address. Populated by the
 * address mutations below via setQueryData; `enabled: false` means it never
 * fetches on its own — it just re-renders when the cache entry changes. The
 * cache survives component unmounts, so navigating between wallet tabs does
 * NOT burn fresh HD keychain indexes.
 */
export function useBarkdCachedAddress(serverUrl: string, kind: 'ark' | 'onchain') {
  return useQuery<string>({
    queryKey: ['barkd', `${kind}-address`, serverUrl],
    enabled: false,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

/**
 * Receive addresses are MUTATIONS, not polling queries: every `address()` /
 * `onchainAddress()` call derives the next unused address from the wallet's
 * HD keychain, so auto-refetching would burn keychain indexes and swap the
 * displayed QR out from under the user. Results are written into the query
 * cache (see useBarkdCachedAddress); only mutate when the cache is empty or
 * the user explicitly asks for a fresh address.
 */
export function useBarkdArkAddress(serverUrl: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      withFriendlyBarkdErrors(getBarkdApis(serverUrl).wallet.address()).then((r) => r.address),
    onSuccess: (address) => {
      queryClient.setQueryData(['barkd', 'ark-address', serverUrl], address);
    },
    onError: (error) => revalidateSessionOnAuthError(queryClient, error),
  });
}

export function useBarkdOnchainAddress(serverUrl: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      withFriendlyBarkdErrors(getBarkdApis(serverUrl).onchain.onchainAddress()).then(
        (r) => r.address,
      ),
    onSuccess: (address) => {
      queryClient.setQueryData(['barkd', 'onchain-address', serverUrl], address);
    },
    onError: (error) => revalidateSessionOnAuthError(queryClient, error),
  });
}

/** Board all confirmed on-chain funds into the Ark wallet. */
export function useBarkdBoardAll(serverUrl: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => withFriendlyBarkdErrors(getBarkdApis(serverUrl).boards.boardAll()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['barkd', 'balance', serverUrl] });
      queryClient.invalidateQueries({ queryKey: ['barkd', 'onchain-balance', serverUrl] });
      queryClient.invalidateQueries({ queryKey: ['barkd', 'movements', serverUrl] });
    },
    onError: (error) => revalidateSessionOnAuthError(queryClient, error),
  });
}

/** Estimated Ark protocol fee for boarding (an on-chain tx fee also applies). */
export function useBarkdBoardFee(serverUrl: string, amountSat: number | undefined) {
  return useQuery({
    queryKey: ['barkd', 'board-fee', serverUrl, amountSat],
    queryFn: () =>
      withFriendlyBarkdErrors(getBarkdApis(serverUrl).fees.boardFee({ amountSat: amountSat ?? 0 })),
    enabled: !!amountSat,
    staleTime: 60_000,
    retry: false,
  });
}

export function useBarkdGenerateInvoice(serverUrl: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ amountSat, description }: { amountSat: number; description?: string }) => {
      const info = await withFriendlyBarkdErrors(
        getBarkdApis(serverUrl).lightning.generateInvoice({
          lightningInvoiceRequest: { amountSat, description: description || null },
        }),
      );
      return info.invoice;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['barkd', 'balance', serverUrl] });
    },
    onError: (error) => revalidateSessionOnAuthError(queryClient, error),
  });
}

/** Estimated Ark-server fee for a Lightning send of `amountSat` sats. */
export function useBarkdLightningSendFee(serverUrl: string, amountSat: number | undefined) {
  return useQuery({
    queryKey: ['barkd', 'lightning-send-fee', serverUrl, amountSat],
    queryFn: () =>
      withFriendlyBarkdErrors(
        getBarkdApis(serverUrl).fees.lightningSendFee({ amountSat: amountSat ?? 0 }),
      ),
    enabled: !!amountSat,
    staleTime: 60_000,
    retry: false,
  });
}

/**
 * Unified send — the barkd `/send` endpoint accepts an Ark address, a BOLT11
 * invoice, an LNURL, or a lightning address as the destination.
 */
export function useBarkdSend(serverUrl: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (request: SendRequest) => {
      return withFriendlyBarkdErrors(getBarkdApis(serverUrl).wallet.send({ sendRequest: request }));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['barkd', 'balance', serverUrl] });
      queryClient.invalidateQueries({ queryKey: ['barkd', 'movements', serverUrl] });
    },
    onError: (error) => revalidateSessionOnAuthError(queryClient, error),
  });
}

/**
 * Register all spendable VTXOs for refresh in the next Ark round (funds are
 * locked until the round confirms; an Ark server fee applies). barkd does
 * NOT refresh on its own — this is the maintenance action wallets need when
 * VTXOs approach expiry, e.g. after being offline for a long time.
 */
export function useBarkdRefreshAll(serverUrl: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => withFriendlyBarkdErrors(getBarkdApis(serverUrl).wallet.refreshAll()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['barkd', 'balance', serverUrl] });
      queryClient.invalidateQueries({ queryKey: ['barkd', 'movements', serverUrl] });
    },
    onError: (error) => revalidateSessionOnAuthError(queryClient, error),
  });
}

/**
 * Force the daemon to sync, then refresh wallet DATA queries. The session
 * query is deliberately left alone — it has its own staleness lifecycle, and
 * invalidating it would kick the user to the connect form (unmounting all
 * wallet state) on a single transient probe failure.
 */
export function useBarkdRefresh(serverUrl: string) {
  const queryClient = useQueryClient();
  return async () => {
    await withFriendlyBarkdErrors(getBarkdApis(serverUrl).wallet.sync()).catch(() => {
      // Sync is best-effort; refetch regardless so the user sees current state.
    });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['barkd', 'balance', serverUrl] }),
      queryClient.invalidateQueries({ queryKey: ['barkd', 'movements', serverUrl] }),
      queryClient.invalidateQueries({ queryKey: ['barkd', 'onchain-balance', serverUrl] }),
    ]);
  };
}
