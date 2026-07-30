import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useEncryptedSecureLocalStorage } from '@/hooks/useEncryptedSecureLocalStorage';
import {
  fetchBarkdAuthStatus,
  fetchBarkdConfig,
  getBarkdApis,
  loginBarkd,
  logoutBarkd,
  normalizeBarkdUrl,
  type BarkdServerConfig,
} from '@/lib/barkd';

/**
 * Manages the connection to a remote bark-web / barkd server (Tier 1 Ark
 * wallet). The server URL is stored per-user in plain localStorage; the
 * optional UI password goes into NIP-44-encrypted secure storage, mirroring
 * how NWC connection strings are handled.
 *
 * Connect flow: normalize URL → probe /api/config → /api/auth/status →
 * /api/login (if the server has UI auth enabled) → verify the session by
 * reading the wallet balance.
 */
export function useBarkdConnection() {
  const { user } = useCurrentUser();
  const pubkey = user?.pubkey ?? '';
  const queryClient = useQueryClient();

  const [serverUrl, setServerUrl] = useLocalStorage<string | null>(`ark-server:${pubkey}`, null);
  const [password, setPassword] = useEncryptedSecureLocalStorage<string | null>(
    `ark-password:${pubkey}`,
    null,
    user?.signer?.nip44,
    pubkey,
  );
  const [serverConfig, setServerConfig] = useState<BarkdServerConfig | null>(null);

  const connect = useMutation({
    mutationFn: async ({ url, password: pw }: { url: string; password: string }) => {
      const baseUrl = normalizeBarkdUrl(url);

      // Probe the API and log in if the server requires it.
      const config = await fetchBarkdConfig(baseUrl);
      const auth = await fetchBarkdAuthStatus(baseUrl);
      if (auth.authRequired && !auth.authed) {
        if (!pw) throw new Error('This server requires its UI password.');
        await loginBarkd(baseUrl, pw);
      }

      // Verify the session actually works against barkd before persisting.
      await getBarkdApis(baseUrl).wallet.balance();

      return { baseUrl, config, password: pw || null };
    },
    onSuccess: ({ baseUrl, config, password: pw }) => {
      setServerUrl(baseUrl);
      setPassword(pw);
      setServerConfig(config);
    },
  });

  const disconnect = useCallback(async () => {
    if (serverUrl) await logoutBarkd(serverUrl);
    setServerUrl(null);
    setPassword(null);
    setServerConfig(null);
    queryClient.removeQueries({ queryKey: ['barkd'] });
  }, [serverUrl, setServerUrl, setPassword, queryClient]);

  // Live session check while a server is configured — if the cookie expired
  // or the server went away, the tab falls back to the connect form.
  const session = useQuery({
    queryKey: ['barkd', 'session', serverUrl],
    queryFn: async () => {
      if (!serverUrl) return null;
      const auth = await fetchBarkdAuthStatus(serverUrl);
      if (auth.authRequired && !auth.authed && password) {
        await loginBarkd(serverUrl, password);
      }
      const config = await fetchBarkdConfig(serverUrl);
      // Throws when the wallet session is not usable.
      await getBarkdApis(serverUrl).wallet.balance();
      return config;
    },
    enabled: !!user && !!serverUrl,
    staleTime: 60_000,
    retry: 1,
  });

  return {
    serverUrl,
    serverConfig: session.data ?? serverConfig,
    connected: !!serverUrl && session.isSuccess,
    sessionError: serverUrl && session.isError ? session.error : null,
    checkingSession: !!serverUrl && session.isPending,
    connect,
    disconnect,
  };
}
