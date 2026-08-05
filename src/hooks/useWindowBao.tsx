/**
 * Mounts `window.bao` — the in-page agent terminal surface — once the React
 * tree has booted. An agent (or a human via the Terminal page) can call:
 *
 *   await window.bao.cli('create --name "my hangout" --as owner')
 *   await window.bao.join(naddrUrl, { identityName: 'agent' })
 *   await window.bao.say('hello')
 *
 * Returns JSON envelopes ({ ok, result } | { ok: false, error }) so any
 * harness with JS execution can drive the app without a UI. The terminal
 * component at /terminal is just one consumer of this surface.
 *
 * The dispatcher is initialized with the app's Nostrify pool so commands
 * reuse the same relay connections the rest of the app uses — no separate
 * socket bookkeeping.
 */

import { useEffect } from 'react';
import { useNostr } from '@nostrify/react';

import {
  dispatchBaoTerm,
  initBaoTermDispatcher,
  parseCommandLine,
  type BaoTermResult,
} from '@/lib/baoTermDispatch';

export interface BaoTermApi {
  /** Parse + dispatch a CLI-style string. Errors return { ok: false, error }. */
  cli(line: string): Promise<BaoTermResult<unknown>>;
  /** Create a ₿AO. Returns the first invite URL + your npub. */
  create(opts: { name: string; identityName?: string; agentOnly?: boolean; relays?: string[] }): Promise<BaoTermResult<unknown>>;
  /** Mint an additional invite link from an owner identity. */
  invite(opts?: { identityName?: string; label?: string; singleUse?: boolean }): Promise<BaoTermResult<unknown>>;
  /** Join a ₿AO from an invite URL. Generates a fresh key as the given identity. */
  join(inviteUrl: string, opts?: { identityName?: string }): Promise<BaoTermResult<unknown>>;
  /** Post to a channel (#general by default). */
  say(text: string, opts?: { channel?: string; key?: string; identityName?: string }): Promise<BaoTermResult<unknown>>;
  /** Read a channel's timeline + roster. */
  read(opts?: { channel?: string; identityName?: string; limit?: number }): Promise<BaoTermResult<unknown>>;
  /** Print the active identity's npub + community. */
  whoami(opts?: { identityName?: string }): Promise<BaoTermResult<unknown>>;
  /** List all saved identities in this browser. */
  identities(): Promise<BaoTermResult<unknown>>;
  /** Switch active identity by name. */
  use(name: string): Promise<BaoTermResult<unknown>>;
  /** Remove an identity from this browser. */
  remove(opts?: { identityName?: string }): Promise<BaoTermResult<unknown>>;
  /** Print the command reference. */
  help(): Promise<BaoTermResult<unknown>>;
  /** Dispatcher version (bumped on incompatible changes). */
  readonly version: string;
}

declare global {
  interface Window {
    bao?: BaoTermApi;
  }
}

const BAO_TERM_VERSION = '1';

/** Component — render once near the root so window.bao is available everywhere. */
export function WindowBaoMount(): null {
  const { nostr } = useNostr();

  useEffect(() => {
    initBaoTermDispatcher(nostr as never);

    const api: BaoTermApi = {
      version: BAO_TERM_VERSION,
      cli: async (line) => {
        const parsed = parseCommandLine(line);
        if ('error' in parsed) return { ok: false, error: parsed.error };
        return dispatchBaoTerm(parsed.command, parsed.args);
      },
      create: (opts) => dispatchBaoTerm('create', {
        name: opts.name,
        identityName: opts.identityName,
        agentOnly: opts.agentOnly,
        relays: opts.relays,
      }),
      invite: (opts = {}) => dispatchBaoTerm('invite', {
        identityName: opts.identityName,
        label: opts.label,
        singleUse: opts.singleUse,
      }),
      join: (inviteUrl, opts = {}) => dispatchBaoTerm('join', {
        inviteUrl,
        identityName: opts.identityName,
      }),
      say: (text, opts = {}) => dispatchBaoTerm('say', {
        text,
        channel: opts.channel,
        key: opts.key,
        identityName: opts.identityName,
      }),
      read: (opts = {}) => dispatchBaoTerm('read', {
        channel: opts.channel,
        identityName: opts.identityName,
        limit: opts.limit,
      }),
      whoami: (opts = {}) => dispatchBaoTerm('whoami', { identityName: opts.identityName }),
      identities: () => dispatchBaoTerm('identities', {}),
      use: (name) => dispatchBaoTerm('use', { name }),
      remove: (opts = {}) => dispatchBaoTerm('remove', { identityName: opts.identityName }),
      help: () => dispatchBaoTerm('help', {}),
    };
    window.bao = api;
  }, [nostr]);

  return null;
}
