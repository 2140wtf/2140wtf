import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Balance, Movement, SendRequest } from '@secondts/barkd';

import { getBarkdApis } from '@/lib/barkd';

/**
 * Data hooks for a connected barkd server. All of them are keyed by server URL
 * and only enabled while `useBarkdConnection` reports a live session.
 */

export function useBarkdBalance(serverUrl: string | null, enabled: boolean) {
  return useQuery<Balance>({
    queryKey: ['barkd', 'balance', serverUrl],
    queryFn: () => getBarkdApis(serverUrl!).wallet.balance(),
    enabled: enabled && !!serverUrl,
    refetchInterval: 15_000,
  });
}

export function useBarkdMovements(serverUrl: string | null, enabled: boolean) {
  return useQuery<Movement[]>({
    queryKey: ['barkd', 'movements', serverUrl],
    queryFn: async () => {
      const movements = await getBarkdApis(serverUrl!).wallet.movements();
      return movements.sort(
        (a, b) => new Date(b.time.createdAt).getTime() - new Date(a.time.createdAt).getTime(),
      );
    },
    enabled: enabled && !!serverUrl,
    refetchInterval: 30_000,
  });
}

/** Fresh Ark receive address (registers a new one with the server when needed). */
export function useBarkdArkAddress(serverUrl: string | null, enabled: boolean) {
  return useQuery<string>({
    queryKey: ['barkd', 'ark-address', serverUrl],
    queryFn: async () => (await getBarkdApis(serverUrl!).wallet.address()).address,
    enabled: enabled && !!serverUrl,
    staleTime: 5 * 60_000,
  });
}

export function useBarkdOnchainAddress(serverUrl: string | null, enabled: boolean) {
  return useQuery<string>({
    queryKey: ['barkd', 'onchain-address', serverUrl],
    queryFn: async () => (await getBarkdApis(serverUrl!).onchain.onchainAddress()).address,
    enabled: enabled && !!serverUrl,
    staleTime: 5 * 60_000,
  });
}

export function useBarkdGenerateInvoice(serverUrl: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ amountSat, description }: { amountSat: number; description?: string }) => {
      const info = await getBarkdApis(serverUrl!).lightning.generateInvoice({
        lightningInvoiceRequest: { amountSat, description: description || null },
      });
      return info.invoice;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['barkd', 'balance', serverUrl] });
    },
  });
}

/**
 * Unified send — the barkd `/send` endpoint accepts an Ark address, a BOLT11
 * invoice, an LNURL, or a lightning address as the destination.
 */
export function useBarkdSend(serverUrl: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (request: SendRequest) => {
      return getBarkdApis(serverUrl!).wallet.send({ sendRequest: request });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['barkd', 'balance', serverUrl] });
      queryClient.invalidateQueries({ queryKey: ['barkd', 'movements', serverUrl] });
    },
  });
}
