import { useState, useCallback } from 'react';
import { useEncryptedSecureLocalStorage } from '@/hooks/useEncryptedSecureLocalStorage';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useToast } from '@/hooks/useToast';
import { redactSecrets } from '@/lib/redactSecrets';
import { LN } from '@getalby/sdk';

export interface NWCConnection {
  connectionString: string;
  alias?: string;
  isConnected: boolean;
  client?: LN;
}

export interface NWCInfo {
  alias?: string;
  color?: string;
  pubkey?: string;
  network?: string;
  methods?: string[];
  notifications?: string[];
}

export interface NwcUriParts {
  connectionString: string;
  pubkey: string;
  relay: string;
  secret?: string;
}

/**
 * Validate a Nostr Wallet Connect URI.
 *
 * Accepts both `nostr+walletconnect://` and `nostrwalletconnect://`. Requires
 * the query string to contain non-empty `pubkey` and `relay` parameters. The
 * secret is parsed but never returned in error messages — callers must run any
 * error text through {@link redactSecrets} before displaying it.
 */
export function validateNwcUri(rawUri: string): NwcUriParts | null {
  const uri = rawUri.trim();
  if (!uri) return null;
  let protocol: string;
  try {
    protocol = uri.split('://')[0]?.toLowerCase() || '';
  } catch {
    return null;
  }
  if (protocol !== 'nostr+walletconnect' && protocol !== 'nostrwalletconnect') {
    return null;
  }
  // Reject obvious junk while avoiding logging the secret-bearing URI.
  if (uri.length < 10 || uri.length > 4000) return null;

  const queryIndex = uri.indexOf('?');
  if (queryIndex === -1) return null;
  const params = new URLSearchParams(uri.slice(queryIndex + 1));
  const pubkey = params.get('pubkey')?.trim();
  const relay = params.get('relay')?.trim();
  const secret = params.get('secret')?.trim();
  if (!pubkey || pubkey.length === 0) return null;
  if (!relay || relay.length === 0) return null;

  return { connectionString: uri, pubkey, relay, secret };
}

export function useNWCInternal(userPubkey?: string) {
  const { toast } = useToast();
  const { user } = useCurrentUser();
  // Scope wallet connections per user so switching accounts doesn't leak wallets.
  // When no user is logged in, use a 'global' fallback key (connections won't
  // be accessible without a user anyway since zap actions require login).
  const pubkey = userPubkey ?? user?.pubkey ?? '';
  const nip44 = user?.signer?.nip44;
  const storagePrefix = pubkey ? `nwc-connections:${pubkey}` : 'nwc-connections';
  const activePrefix = pubkey ? `nwc-active-connection:${pubkey}` : 'nwc-active-connection';
  // NWC connection strings embed a secret that authorizes Lightning payments.
  // On native platforms they land in Keychain/KeyStore via secureStorage; on
  // web they are encrypted at rest with NIP-44 self-encryption before being
  // written to localStorage.
  const [connections, setConnections] = useEncryptedSecureLocalStorage<NWCConnection[]>(storagePrefix, [], nip44, pubkey);
  const [activeConnection, setActiveConnection] = useEncryptedSecureLocalStorage<string | null>(activePrefix, null, nip44, pubkey);
  const [connectionInfo, setConnectionInfo] = useState<Record<string, NWCInfo>>({});

  // Add new connection
  const addConnection = async (uri: string, alias?: string): Promise<boolean> => {
    const parsed = validateNwcUri(uri);
    if (!parsed) {
      toast({
        title: 'Invalid NWC URI',
        description: 'Please check the connection string and try again.',
        variant: 'destructive',
      });
      return false;
    }

    const existingConnection = connections.find(c => c.connectionString === parsed.connectionString);
    if (existingConnection) {
      toast({
        title: 'Connection already exists',
        description: 'This wallet is already connected.',
        variant: 'destructive',
      });
      return false;
    }

    try {
      let timeoutId: NodeJS.Timeout | undefined;
      const testPromise = new Promise((resolve, reject) => {
        try {
          const client = new LN(parsed.connectionString);
          resolve(client);
        } catch (error) {
          reject(error);
        }
      });
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Connection test timeout')), 10000);
      });

      try {
        await Promise.race([testPromise, timeoutPromise]) as LN;
        if (timeoutId) clearTimeout(timeoutId);
      } catch (error) {
        if (timeoutId) clearTimeout(timeoutId);
        throw error;
      }

      const connection: NWCConnection = {
        connectionString: parsed.connectionString,
        alias: alias || 'NWC Wallet',
        isConnected: true,
      };

      setConnectionInfo(prev => ({
        ...prev,
        [parsed.connectionString]: {
          alias: connection.alias,
          methods: ['pay_invoice'],
        },
      }));

      const newConnections = [...connections, connection];
      setConnections(newConnections);

      if (connections.length === 0 || !activeConnection)
        setActiveConnection(parsed.connectionString);

      toast({
        title: 'Wallet connected',
        description: `Successfully connected to ${connection.alias}.`,
      });

      return true;
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      console.error('NWC connection failed:', redactSecrets(rawMessage));
      const errorMessage = redactSecrets(rawMessage);

      toast({
        title: 'Connection failed',
        description: `Could not connect to the wallet: ${errorMessage}`,
        variant: 'destructive',
      });
      return false;
    }
  };

  // Remove connection
  const removeConnection = (connectionString: string) => {
    const filtered = connections.filter(c => c.connectionString !== connectionString);
    setConnections(filtered);

    if (activeConnection === connectionString) {
      const newActive = filtered.length > 0 ? filtered[0].connectionString : null;
      setActiveConnection(newActive);
    }

    setConnectionInfo(prev => {
      const newInfo = { ...prev };
      delete newInfo[connectionString];
      return newInfo;
    });

    toast({
      title: 'Wallet disconnected',
      description: 'The wallet connection has been removed.',
    });
  };

  // Get active connection
  const getActiveConnection = useCallback((): NWCConnection | null => {
    if (!activeConnection && connections.length > 0) {
      setActiveConnection(connections[0].connectionString);
      return connections[0];
    }

    if (!activeConnection) return null;

    const found = connections.find(c => c.connectionString === activeConnection);
    return found || null;
  }, [activeConnection, connections, setActiveConnection]);

  // Send payment using the SDK
  const sendPayment = useCallback(async (
    connection: NWCConnection,
    invoice: string
  ): Promise<{ preimage: string }> => {
    if (!connection.connectionString) {
      throw new Error('Invalid connection: missing connection string');
    }

    let client: LN;
    try {
      let clientTimeoutId: NodeJS.Timeout | undefined;
      const clientPromise = new Promise<LN>((resolve, reject) => {
        try {
          resolve(new LN(connection.connectionString));
        } catch (error) {
          reject(error);
        }
      });
      const clientTimeoutPromise = new Promise<never>((_, reject) => {
        clientTimeoutId = setTimeout(() => reject(new Error('NWC client creation timeout')), 5000);
      });
      try {
        client = await Promise.race([clientPromise, clientTimeoutPromise]);
        if (clientTimeoutId) clearTimeout(clientTimeoutId);
      } catch (error) {
        if (clientTimeoutId) clearTimeout(clientTimeoutId);
        throw error;
      }
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Failed to create NWC client:', redactSecrets(rawMessage));
      throw new Error(`Failed to create NWC client: ${redactSecrets(rawMessage)}`);
    }

    try {
      let timeoutId: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Payment timeout after 15 seconds')), 15000);
      });

      const paymentPromise = client.pay(invoice);

      try {
        const response = await Promise.race([paymentPromise, timeoutPromise]) as { preimage: string };
        if (timeoutId) clearTimeout(timeoutId);
        return response;
      } catch (error) {
        if (timeoutId) clearTimeout(timeoutId);
        throw error;
      }
    } catch (error) {
      if (error instanceof Error) {
        console.error('NWC payment failed:', redactSecrets(error.message));
        // Avoid echoing the secret connection string back to the user if the
        // SDK ever includes it in an error message.
        const safeMessage = redactSecrets(error.message);
        if (safeMessage.includes('timeout')) {
          throw new Error('Payment timed out. Please try again.');
        } else if (safeMessage.includes('insufficient')) {
          throw new Error('Insufficient balance in connected wallet.');
        } else if (safeMessage.includes('invalid')) {
          throw new Error('Invalid invoice or connection. Please check your wallet.');
        } else {
          throw new Error(`Payment failed: ${safeMessage}`);
        }
      }

      throw new Error('Payment failed with unknown error');
    }
  }, []);

  return {
    connections,
    activeConnection,
    connectionInfo,
    addConnection,
    removeConnection,
    setActiveConnection,
    getActiveConnection,
    sendPayment,
  };
}