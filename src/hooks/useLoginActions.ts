import { useNostr } from '@nostrify/react';
import {
  NLogin,
  type NLoginType,
  type NostrConnectParams,
  type NostrConnectStatus,
  useNostrLogin,
} from '@nostrify/react/login';
import { BunkerURI, NSecSigner } from '@nostrify/nostrify';
import { generateSecretKey, nip19 } from 'nostr-tools';
import { useAppContext } from '@/hooks/useAppContext';
import { APP_RELAYS } from '@/lib/appRelays';
import { NConnectSignerBtc } from '@/lib/bitcoin-signers';
import { purgeConcordStorage } from '@/lib/purgeConcordStorage';

// NOTE: This file should not be edited except for adding new login methods.

export type { NostrConnectParams, NostrConnectStatus };
export { generateNostrConnectParams } from '@nostrify/react/login';

/**
 * Permissions requested from a NIP-46 remote signer (e.g. Amber) during login.
 *
 * NIP-46 signers use this list to decide which operations can be auto-approved
 * instead of prompting the user for every single action. `sign_event` without a
 * kind number means "all event kinds" — this is the only practical choice for a
 * general-purpose client that publishes many kinds.
 */
const NOSTR_CONNECT_PERMS = [
  'get_public_key',
  'sign_event',
  'nip04_encrypt',
  'nip04_decrypt',
  'nip44_encrypt',
  'nip44_decrypt',
].join(',');

/** Options for generating a nostrconnect:// URI. */
export interface NostrConnectURIOptions {
  /** Application name to include in the URI. */
  name?: string;
  /** Callback URL for mobile signer apps to redirect back to. */
  callback?: string;
  /** Permissions to request from the signer. Defaults to {@link NOSTR_CONNECT_PERMS}. */
  perms?: string;
}

/** Generate a nostrconnect:// URI from the given parameters. */
export function generateNostrConnectURI(
  params: NostrConnectParams,
  opts?: NostrConnectURIOptions,
): string {
  const searchParams = new URLSearchParams();

  for (const relay of params.relays) {
    searchParams.append('relay', relay);
  }
  searchParams.set('secret', params.secret);
  searchParams.set('perms', opts?.perms ?? NOSTR_CONNECT_PERMS);

  if (opts?.name) {
    searchParams.set('name', opts.name);
  }
  if (opts?.callback) {
    searchParams.set('callback', opts.callback);
  }

  return `nostrconnect://${params.clientPubkey}?${searchParams.toString()}`;
}

/** Access the TypeScript-private `cmd` method on an NConnectSigner at runtime. */
function getNConnectCmd(
  signer: NConnectSignerBtc,
): (method: string, params: string[]) => Promise<string> {
  return (signer as unknown as { cmd(method: string, params: string[]): Promise<string> }).cmd;
}

/**
 * Establish a NIP-46 bunker session, requesting broad permissions so the signer
 * can auto-approve subsequent operations. Falls back to a plain connect handshake
 * if the signer rejects the perms argument.
 */
async function establishBunkerSession(
  signer: NConnectSignerBtc,
  bunkerPubkey: string,
  secret?: string,
): Promise<void> {
  const cmd = getNConnectCmd(signer);
  const baseParams = [bunkerPubkey];
  if (secret) baseParams.push(secret);

  try {
    await cmd.call(signer, 'connect', [...baseParams, NOSTR_CONNECT_PERMS]);
  } catch (error) {
    // Some older/simpler signers don't accept a third `perms` argument on
    // `connect`. Retry without it so login still works.
    console.warn('[bunker] connect with perms failed, retrying without perms:', error);
    await cmd.call(signer, 'connect', baseParams);
  }
}

export function useLoginActions() {
  const { nostr } = useNostr();
  const { logins, addLogin, setLogin, removeLogin } = useNostrLogin();
  const { config } = useAppContext();

  // Add a login and promote it to be the current user. Without the
  // setLogin call the new login is appended to the end of the array,
  // leaving the prior account as logins[0] — which is what
  // useCurrentUser / useLoggedInAccounts treat as the active user.
  // Promoting here makes "Add another account" actually switch.
  const addAndActivate = (login: NLoginType) => {
    addLogin(login);
    setLogin(login.id);
  };

  return {
    // Login with a Nostr secret key
    nsec(nsec: string): void {
      const login = NLogin.fromNsec(nsec);
      addAndActivate(login);
    },
    // Login with a NIP-46 "bunker://" URI
    async bunker(uri: string): Promise<void> {
      const { pubkey: bunkerPubkey, secret, relays } = new BunkerURI(uri);

      if (!relays.length) {
        throw new Error('No relay provided');
      }

      const clientSk = generateSecretKey();
      const clientSigner = new NSecSigner(clientSk);

      const signer = new NConnectSignerBtc({
        relay: nostr.group(relays),
        pubkey: bunkerPubkey,
        signer: clientSigner,
        timeout: 60_000,
      });

      await establishBunkerSession(signer, bunkerPubkey, secret);
      const pubkey = await signer.getPublicKey();

      const login = new NLogin('bunker', pubkey, {
        bunkerPubkey,
        clientNsec: nip19.nsecEncode(clientSk),
        relays,
      });

      addAndActivate(login);
    },
    // Login with a NIP-07 browser extension
    async extension(): Promise<void> {
      const login = await NLogin.fromExtension();
      addAndActivate(login);
    },
    // Login via nostrconnect:// (client-initiated NIP-46)
    // The client displays a QR code and waits for the remote signer to connect.
    //
    // `onStatus` is forwarded from @nostrify/react so the UI can render
    // live progress through the handshake phases — see NostrConnectStatus.
    async nostrconnect(
      params: NostrConnectParams,
      signal?: AbortSignal,
      onStatus?: (status: NostrConnectStatus) => void,
    ): Promise<void> {
      const login = await NLogin.fromNostrConnect(params, nostr, { signal, onStatus });
      addAndActivate(login);
    },
    // Get the relay URLs for NIP-46 nostrconnect communication
    getRelayUrls(): string[] {
      const relays = config.relayMetadata.relays
        .filter((r) => r.write)
        .map((r) => r.url);
      // Fall back to the app default relays if the user has none configured
      return relays.length > 0
        ? relays
        : APP_RELAYS.relays.filter((r) => r.write).map((r) => r.url);
    },
    // Log out the current user
    async logout(): Promise<void> {
      const login = logins[0];
      if (login) {
        removeLogin(login.id);
      }
      // Final logout: wipe the decrypted-at-rest Concord stores (channel
      // rumors, fold snapshots with stream-key material, pending wraps,
      // invites, wire cursors, decrypt consent) so the next identity on this
      // device can't read the previous account's decrypted ₿AO chat. When
      // other accounts remain, their data stays.
      if (logins.length <= 1) {
        await purgeConcordStorage();
      }
    }
  };
}
