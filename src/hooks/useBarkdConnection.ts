import { useCallback, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useEncryptedSecureLocalStorage } from '@/hooks/useEncryptedSecureLocalStorage';
import {
  dropBarkdApis,
  fetchBarkdAuthStatus,
  fetchBarkdConfig,
  getBarkdApis,
  loginBarkd,
  logoutBarkd,
  normalizeBarkdUrl,
  withFriendlyBarkdErrors,
  type BarkdServerConfig,
} from '@/lib/barkd';

/**
 * Manages the connection to a remote bark-web / barkd server (Tier 1 Ark
 * wallet). The server URL is stored per-user in plain localStorage; the
 * optional UI password goes into NIP-44-encrypted secure storage, mirroring
 * how NWC connection strings are handled. (For nsec-in-localStorage logins
 * the NIP-44 key derives from that same nsec, so the encryption only protects
 * against casual inspection — same trade-off as the stored NWC secrets.)
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
  const [password, setPassword, passwordReady] = useEncryptedSecureLocalStorage<string | null>(
    `ark-password:${pubkey}`,
    null,
    user?.signer?.nip44,
    pubkey,
  );
  const [serverConfig, setServerConfig] = useState<BarkdServerConfig | null>(null);

  // URLs whose stored password already failed a login this session — don't
  // hammer the rate-limited /api/login endpoint on every window focus.
  const failedLogins = useRef<Set<string>>(new Set());

  const connect = useMutation({
    mutationFn: async ({ url, password: pw }: { url: string; password: string }) => {
      const baseUrl = normalizeBarkdUrl(url);

      // Probe the API and log in if the server requires it.
      const config = await fetchBarkdConfig(baseUrl);
      const auth = await fetchBarkdAuthStatus(baseUrl);
      let loggedIn = false;
      if (auth.authRequired && !auth.authed) {
        if (!pw) throw new Error('This server requires its UI password.');
        await loginBarkd(baseUrl, pw);
        loggedIn = true;
      }

      // Verify the session actually works against barkd before persisting.
      await withFriendlyBarkdErrors(getBarkdApis(baseUrl).wallet.balance());

      return { baseUrl, config, password: loggedIn ? pw : null };
    },
    onSuccess: ({ baseUrl, config, password: pw }) => {
      failedLogins.current.delete(baseUrl);
      setServerUrl(baseUrl);
      setPassword(pw);
      setServerConfig(config);
      // Seed the session query so the UI flips to connected immediately
      // instead of re-probing (and flashing a skeleton) first.
      queryClient.setQueryData(['barkd', 'session', baseUrl], config);
      // Drop the mutation (and the plaintext password in its variables) from
      // the cache — the password now lives in encrypted storage only.
      connect.reset();
    },
  });

  const disconnect = useCallback(async () => {
    if (serverUrl) {
      await logoutBarkd(serverUrl);
      dropBarkdApis(serverUrl);
    }
    setServerUrl(null);
    setPassword(null);
    setServerConfig(null);
    queryClient.removeQueries({ queryKey: ['barkd'] });
    connect.reset();
  }, [serverUrl, setServerUrl, setPassword, queryClient, connect]);

  // Live session check while a server is configured — if the cookie expired
  // or the server went away, the tab falls back to the connect form. Gated on
  // `passwordReady` so a fresh page load doesn't probe before the stored
  // password has finished decrypting.
  const session = useQuery({
    queryKey: ['barkd', 'session', serverUrl],
    queryFn: async () => {
      if (!serverUrl) return null;
      const auth = await fetchBarkdAuthStatus(serverUrl);
      if (auth.authRequired && !auth.authed) {
        if (!password || failedLogins.current.has(serverUrl)) {
          throw new Error('Session expired — reconnect with your UI password.');
        }
        try {
          await loginBarkd(serverUrl, password);
        } catch (error) {
          failedLogins.current.add(serverUrl);
          throw error;
        }
      }
      const config = await fetchBarkdConfig(serverUrl);
      // Throws when the wallet session is not usable.
      await withFriendlyBarkdErrors(getBarkdApis(serverUrl).wallet.balance());
      return config;
    },
    enabled: !!user && !!serverUrl && passwordReady,
    staleTime: 60_000,
    retry: 1,
  });

  return {
    serverUrl,
    serverConfig: session.data ?? serverConfig,
    connected: !!user && !!serverUrl && session.isSuccess,
    sessionError: serverUrl && session.isError ? session.error : null,
    checkingSession: !!serverUrl && (!passwordReady || session.isPending),
    canSavePassword: !!user?.signer?.nip44,
    connect,
    disconnect,
  };
}
