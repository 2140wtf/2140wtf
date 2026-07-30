import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Balance, Movement, OnchainBalance, SendRequest } from '@secondts/barkd';

import { getBarkdApis, withFriendlyBarkdErrors } from '@/lib/barkd';

/**
 * Data hooks for a connected barkd server. All of them are keyed by server URL
 * and only enabled while `useBarkdConnection` reports a live session. Every
 * generated-client call goes through `withFriendlyBarkdErrors` so the UI
 * never shows the OpenAPI client's raw "Response returned an error code".
 */

export function useBarkdBalance(serverUrl: string | null, enabled: boolean) {
  return useQuery<Balance>({
    queryKey: ['barkd', 'balance', serverUrl],
    queryFn: () => withFriendlyBarkdErrors(getBarkdApis(serverUrl!).wallet.balance()),
    enabled: enabled && !!serverUrl,
    refetchInterval: 15_000,
  });
}

/** Movement history, returned by the server newest-first. */
export function useBarkdMovements(serverUrl: string | null, enabled: boolean) {
  return useQuery<Movement[]>({
    queryKey: ['barkd', 'movements', serverUrl],
    queryFn: () => withFriendlyBarkdErrors(getBarkdApis(serverUrl!).history.list({})),
    enabled: enabled && !!serverUrl,
    refetchInterval: 30_000,
  });
}

export function useBarkdOnchainBalance(serverUrl: string | null, enabled: boolean) {
  return useQuery<OnchainBalance>({
    queryKey: ['barkd', 'onchain-balance', serverUrl],
    queryFn: () => withFriendlyBarkdErrors(getBarkdApis(serverUrl!).onchain.onchainBalance()),
    enabled: enabled && !!serverUrl,
    refetchInterval: 30_000,
  });
}

/**
 * Receive addresses are MUTATIONS, not queries: every `address()` /
 * `onchainAddress()` call derives the next unused address from the wallet's
 * HD keychain, so auto-refetching would burn keychain indexes and swap the
 * displayed QR out from under the user. Call once on demand, show the result
 * until the user explicitly asks for a new one.
 */
export function useBarkdArkAddress(serverUrl: string) {
  return useMutation({
    mutationFn: async () =>
      withFriendlyBarkdErrors(getBarkdApis(serverUrl).wallet.address()).then((r) => r.address),
  });
}

export function useBarkdOnchainAddress(serverUrl: string) {
  return useMutation({
    mutationFn: async () =>
      withFriendlyBarkdErrors(getBarkdApis(serverUrl).onchain.onchainAddress()).then(
        (r) => r.address,
      ),
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
  });
}

/** Estimated Ark-server fee for a Lightning send of `amountSat` sats. */
export function useBarkdLightningSendFee(serverUrl: string, amountSat: number | undefined) {
  return useQuery({
    queryKey: ['barkd', 'lightning-send-fee', serverUrl, amountSat],
    queryFn: () =>
      withFriendlyBarkdErrors(getBarkdApis(serverUrl).fees.lightningSendFee({ amountSat: amountSat! })),
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
  });
}

/** Force the daemon to sync, then refresh all wallet data. */
export function useBarkdRefresh(serverUrl: string) {
  const queryClient = useQueryClient();
  return async () => {
    await withFriendlyBarkdErrors(getBarkdApis(serverUrl).wallet.sync()).catch(() => {
      // Sync is best-effort; refetch regardless so the user sees current state.
    });
    await queryClient.invalidateQueries({ queryKey: ['barkd'] });
  };
}
