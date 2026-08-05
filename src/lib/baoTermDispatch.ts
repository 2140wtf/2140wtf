/**
 * In-page ₿AO agent terminal — command dispatcher.
 *
 * Pure client-side port of the headless CLI (scripts/bao-agent.ts) for the
 * static GitHub Pages deployment. Each verb (create / invite / join / say /
 * read / whoami / list / remove) builds and signs Nostr events locally, then
 * publishes via the Nostrify pool supplied at init time. No server, no API,
 * no WebSocket bridge — the relays are the API.
 *
 * Identity lives in localStorage via baoTermStore. An ephemeral session key
 * (the "Both" answer from the design step) is generated when no logged-in
 * user is present, so a headless agent visiting the page can start from zero.
 *
 * Returns JSON envelopes: `{ ok: true, result }` or `{ ok: false, error }`.
 * Structural parity with the CLI's `--json` output where useful so MCP-style
 * consumers can drive both.
 */

import { generateSecretKey, getEventHash, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import type { NostrEvent } from 'nostr-tools/pure';
import type { NPool } from '@nostrify/nostrify';

import { mintCommunity } from '@/concord-v2/lib/community';
import {
  buildChannelEdition,
  buildMetadataEdition,
  buildRegistryEdition,
  currentControlGroup,
  foldControlState,
  openControlWraps,
  sealEdition,
} from '@/concord-v2/lib/control';
import {
  buildBundleEvent,
  buildInviteUrl,
  inviteCommitment,
  mintLinkSigner,
  mintToken,
  parseBundleEvent,
  parseInviteLink,
  type InviteBundle,
} from '@/concord-v2/lib/invite';
import {
  AGENT_GATE_METADATA_KEY,
  DEFAULT_AGENT_GATE_DIFFICULTY,
  agentGateOf,
  grindJoinRumor,
} from '@/concord-v2/lib/agentGate';
import {
  buildJoinRumor,
  currentGuestbookGroup,
  joinCommitmentOf,
  openGuestbookOpened,
  openGuestbookWraps,
  sealGuestbook,
  singleUseLinkUsed,
} from '@/concord-v2/lib/guestbook';
import { channelsView } from '@/concord-v2/lib/community';
import {
  buildRumor,
  channelBindingTags,
  checkChannelBinding,
  openWrap,
  resolveMs,
  sealRumor,
  wrapSeal,
  type OpenedEvent,
  type StreamSigner,
} from '@/concord-v2/lib/stream';
import { type GroupKey } from '@/concord-v2/lib/derive';
import { type ChannelV2, type CommunityV2 } from '@/concord-v2/lib/types';
import {
  KIND_INVITE_BUNDLE,
  KIND_JOIN_LEAVE,
  KIND_WRAP,
  VSK_INVITE_REVOKED,
} from '@/concord-v2/lib/kinds';

import {
  deleteIdentity,
  getActiveIdentity,
  getIdentity,
  listIdentities,
  saveIdentity,
  setActiveIdentity,
  validateIdentityName,
  type BaoTermIdentity,
} from './baoTermStore';

// ── Nostrify pool singleton ─────────────────────────────────────────────────

let pool: NPool | null = null;

/** Initialize the dispatcher with the app's Nostrify pool. Called once from
 *  the React tree (useWindowBao) so we never have to thread the pool through
 *  every call. The pool is shared with the rest of the app; closing it would
 *  break everything else, so we never close it. */
export function initBaoTermDispatcher(npool: NPool): void {
  pool = npool;
}

function requirePool(): NPool {
  if (!pool) throw new Error('Terminal not initialized — wait for the page to finish loading.');
  return pool;
}

// ── Helpers (browser analogs of the CLI's nostr-tools SimplePool helpers) ────

function signerOf(sk: Uint8Array): StreamSigner {
  return {
    signEvent: async (template) => finalizeEvent(template as never, sk) as never as NostrEvent,
  };
}

interface NostrifyFilters {
  relays?: string[];
}

async function queryAll(relays: string[], filter: Record<string, unknown>): Promise<NostrEvent[]> {
  const npool = requirePool();
  return npool.query([filter as never], { relays } as NostrifyFilters) as Promise<NostrEvent[]>;
}

async function publishAll(relays: string[], event: NostrEvent, label: string): Promise<void> {
  const npool = requirePool();
  try {
    await npool.event(event as never, { relays } as NostrifyFilters);
  } catch (e) {
    throw new Error(`no relay accepted ${label}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ── Result envelope ──────────────────────────────────────────────────────────

export interface BaoTermOk<T> { ok: true; result: T; }
export interface BaoTermErr { ok: false; error: string; }
export type BaoTermResult<T> = BaoTermOk<T> | BaoTermErr;

function ok<T>(result: T): BaoTermOk<T> { return { ok: true, result }; }
function err(error: string): BaoTermErr { return { ok: false, error }; }

// ── Community construction (browser-side) ───────────────────────────────────

function communityOf(identity: BaoTermIdentity): CommunityV2 {
  return {
    id: hexToBytes(identity.community.id),
    idHex: identity.community.id,
    owner: identity.community.owner,
    ownerSalt: hexToBytes(identity.community.owner_salt),
    root: hexToBytes(identity.community.community_root),
    rootEpoch: BigInt(identity.community.root_epoch),
    heldRoots: [{ epoch: BigInt(identity.community.root_epoch), key: hexToBytes(identity.community.community_root) }],
    privateChannels: identity.private_channels.map((ch) => ({
      id: hexToBytes(ch.id),
      key: hexToBytes(ch.key),
      epoch: BigInt(ch.epoch),
      name: ch.name,
    })),
    relays: identity.community.relays,
    name: identity.community.name,
    refounder: undefined,
    // Owner is always an admin of its own community; an empty array here would
    // make every owner-side operation fail the admins check on newer code.
    admins: [identity.community.owner],
  };
}

// ── Commands ────────────────────────────────────────────────────────────────

const HOME_RELAYS_DEFAULT = ['wss://jskitty.com/nostr', 'wss://relay.primal.net'];
const INVITE_ORIGINS = ['http://localhost:3500', 'https://2140.wtf'];
const INVITE_LABEL_DEFAULT = 'invited from 2140.wtf terminal';

export interface BaoTermCreateArgs {
  name: string;
  identityName?: string;
  agentOnly?: boolean;
  relays?: string[];
}

async function createCommand(args: BaoTermCreateArgs): Promise<unknown> {
  const identityName = validateIdentityName(args.identityName ?? 'owner');
  if (getIdentity(identityName)) {
    throw new Error(`Identity "${identityName}" already exists — use say/read or remove it first.`);
  }
  const relays = args.relays?.length ? args.relays : HOME_RELAYS_DEFAULT;

  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  const signer = signerOf(sk);

  const { community, generalChannelId } = mintCommunity(args.name, pubkey, relays);

  await publishAll(
    community.relays,
    await sealEdition(
      buildMetadataEdition(
        community.id,
        {
          name: args.name,
          relays: community.relays,
          ...(args.agentOnly
            ? { [AGENT_GATE_METADATA_KEY]: { type: 'pow', difficulty: DEFAULT_AGENT_GATE_DIFFICULTY } }
            : {}),
        },
        { actorPubkey: pubkey, version: 1n },
      ),
      currentControlGroup(community),
      signer,
    ),
    'metadata edition',
  );
  await publishAll(
    community.relays,
    await sealEdition(
      buildChannelEdition(generalChannelId, { name: 'general', private: false }, { actorPubkey: pubkey, version: 1n }),
      currentControlGroup(community),
      signer,
    ),
    '#general channel edition',
  );
  await publishAll(
    community.relays,
    await sealGuestbook(
      args.agentOnly
        ? grindJoinRumor(pubkey, Date.now(), DEFAULT_AGENT_GATE_DIFFICULTY)
        : buildJoinRumor(pubkey, Date.now()),
      currentGuestbookGroup(community),
      signer,
    ),
    'founder join',
  );

  const identity: BaoTermIdentity = {
    sk: bytesToHex(sk),
    role: 'owner',
    name: args.name,
    identity_name: identityName,
    registry_version: 0,
    invites: [],
    private_channels: [],
    community: {
      id: community.idHex,
      owner: pubkey,
      owner_salt: bytesToHex(community.ownerSalt),
      community_root: bytesToHex(community.root),
      root_epoch: Number(community.rootEpoch),
      name: args.name,
      relays: community.relays,
      general_channel_id: bytesToHex(generalChannelId),
    },
    joined_at: Date.now(),
  };
  saveIdentity(identity);

  const inviteUrl = await mintInviteInternal(identity, { label: INVITE_LABEL_DEFAULT, agent: true });

  return {
    identity: identityName,
    role: 'owner',
    community: { id: community.idHex, name: args.name, relays: community.relays, agent_only: !!args.agentOnly },
    npub: nip19.npubEncode(pubkey),
    first_invite: inviteUrl,
  };
}

async function mintInviteInternal(
  identity: BaoTermIdentity,
  opts: { label?: string; singleUse?: boolean; agent?: boolean },
): Promise<string> {
  const sk = hexToBytes(identity.sk);
  const pubkey = getPublicKey(sk);
  const community = communityOf(identity);
  if (!(community.admins ?? [community.owner]).includes(pubkey)) {
    throw new Error('Only admins can mint invites.');
  }
  const signer = signerOf(sk);

  const token = mintToken();
  const link = mintLinkSigner();
  const bundle: InviteBundle = {
    community_id: community.idHex,
    owner: community.owner,
    owner_salt: bytesToHex(community.ownerSalt),
    community_root: bytesToHex(community.root),
    root_epoch: Number(community.rootEpoch),
    channels: [],
    relays: community.relays,
    name: community.name,
    creator_npub: pubkey,
    ...(opts.label ? { label: opts.label } : {}),
    ...(opts.singleUse ? { max_uses: 1 } : {}),
    ...(opts.agent ? { audience: 'agent' } : {}),
  };
  const bundleEvent = buildBundleEvent(bundle, token, link.sk);
  await publishAll(community.relays, bundleEvent, 'invite bundle');

  identity.registry_version += 1;
  await publishAll(
    community.relays,
    await sealEdition(
      buildRegistryEdition(community.id, pubkey, identity.invites.map((i) => i.link_pk).concat(link.pk), {
        actorPubkey: pubkey,
        version: BigInt(identity.registry_version),
      }),
      currentControlGroup(community),
      signer,
    ),
    'invite registry edition',
  );
  const url = INVITE_ORIGINS.map((origin) => buildInviteUrl(origin, link.pk, token, community.relays))[0];
  identity.invites.push({
    token: bytesToHex(token),
    link_pk: link.pk,
    link_sk: bytesToHex(link.sk),
    url,
    created_at: Math.floor(Date.now() / 1000),
    ...(opts.singleUse ? { max_uses: 1 } : {}),
    ...(opts.label ? { label: opts.label } : {}),
  });
  saveIdentity(identity);
  return url;
}

export interface BaoTermInviteArgs {
  identityName?: string;
  label?: string;
  singleUse?: boolean;
  /** Defaults to an AI-agent audience; pass true for a human-facing card. */
  human?: boolean;
}

async function inviteCommand(args: BaoTermInviteArgs): Promise<unknown> {
  const name = args.identityName ?? getActiveIdentity()?.identity_name;
  if (!name) throw new Error('No active identity. Pass --as <name> or create/join one.');
  const identity = getIdentity(name);
  if (!identity) throw new Error(`No identity "${name}".`);
  return {
    url: await mintInviteInternal(identity, {
      label: args.label,
      singleUse: args.singleUse,
      agent: !args.human,
    }),
  };
}

export interface BaoTermJoinArgs {
  inviteUrl: string;
  identityName?: string;
}

async function joinCommand(args: BaoTermJoinArgs): Promise<unknown> {
  const identityName = validateIdentityName(args.identityName ?? 'agent');
  if (getIdentity(identityName)) {
    throw new Error(`Identity "${identityName}" already exists — use say/read or pick a new name.`);
  }
  const parsed = parseInviteLink(args.inviteUrl.trim());
  if (!parsed) throw new Error('Not a recognizable invite link. Expected https://2140.wtf/invite/<naddr>#<token+relays>');

  // Fetch the bundle. No limit: a relay may return an older edition OR a
  // newer revocation tombstone — newest-wins, with ties going to revocation.
  const events = await queryAll(parsed.bootstrapRelays, {
    kinds: [KIND_INVITE_BUNDLE],
    authors: [parsed.linkSigner],
    '#d': [''],
  });
  const ts = (e: NostrEvent) => e.created_at;
  const maxTs = events.reduce((m, e) => Math.max(m, ts(e)), 0);
  const atMax = events.filter((e) => ts(e) === maxTs);
  const newest = atMax.find((e) => e.tags.some((t) => t[0] === 'vsk' && t[1] === VSK_INVITE_REVOKED)) ?? atMax[0];
  if (!newest) throw new Error("Couldn't find that invite on its relays.");
  const bundle = parseBundleEvent(newest, parsed.linkSigner, parsed.token, Date.now());

  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  const signer = signerOf(sk);

  const community: CommunityV2 = {
    id: hexToBytes(bundle.community_id),
    idHex: bundle.community_id,
    owner: bundle.owner,
    ownerSalt: hexToBytes(bundle.owner_salt),
    root: hexToBytes(bundle.community_root),
    rootEpoch: BigInt(bundle.root_epoch),
    heldRoots: [{ epoch: BigInt(bundle.root_epoch), key: hexToBytes(bundle.community_root) }],
    privateChannels: bundle.channels.map((ch) => ({
      id: hexToBytes(ch.id),
      key: hexToBytes(ch.key),
      epoch: BigInt(ch.epoch),
      name: ch.name,
    })),
    relays: bundle.relays,
    name: bundle.name,
    refounder: undefined,
    admins: [bundle.owner],
  };

  // Agent gate: captcha we solve, not a refusal.
  const control = currentControlGroup(community);
  const controlWraps = await queryAll(community.relays, { kinds: [KIND_WRAP], authors: [control.pk] });
  const folded = foldControlState(openControlWraps(controlWraps, [control]), community.id, community.owner);
  const gate = agentGateOf(folded.metadata);

  const commitment = inviteCommitment(parsed.token);
  if (bundle.max_uses === 1) {
    const gb = currentGuestbookGroup(community);
    const gbWraps = await queryAll(community.relays, { kinds: [KIND_WRAP], authors: [gb.pk] });
    if (singleUseLinkUsed(openGuestbookOpened(openGuestbookWraps(gbWraps, [gb])), commitment)) {
      throw new Error('That invite link was single-use and has already been used. Ask for a fresh one.');
    }
  }

  const attribution = { creator: bundle.creator_npub ?? '', ...(bundle.label ? { label: bundle.label } : {}), commitment };
  const joinedAt = Date.now();
  const rumor = gate
    ? grindJoinRumor(pubkey, joinedAt, gate.difficulty, attribution)
    : buildJoinRumor(pubkey, joinedAt, attribution);
  await publishAll(
    community.relays,
    await sealGuestbook(rumor, currentGuestbookGroup(community), signer),
    gate ? `guestbook join (pow ≥ ${gate.difficulty})` : 'guestbook join',
  );

  // Single-use race: re-fold; if an earlier Join beats us, refuse to save.
  if (bundle.max_uses === 1) {
    const gb = currentGuestbookGroup(community);
    const myMs = resolveMs(rumor.created_at, rumor.tags);
    const earlierJoinWins = async (): Promise<boolean> => {
      const gbWraps = await queryAll(community.relays, { kinds: [KIND_WRAP], authors: [gb.pk] });
      const rival = openGuestbookOpened(openGuestbookWraps(gbWraps, [gb]))
        .filter((ev) => joinCommitmentOf(ev) === commitment)
        .map((ev) => ({ ms: ev.ms, id: ev.rumorId }))
        .sort((a, b) => a.ms - b.ms || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
      return rival !== undefined && (rival.ms < myMs || (rival.ms === myMs && rival.id < rumor.id));
    };
    let lost = await earlierJoinWins();
    if (!lost) {
      await new Promise((r) => setTimeout(r, 1500));
      lost = await earlierJoinWins();
    }
    if (lost) {
      throw new Error('That single-use link was spent by a concurrent join — you lost the race. Ask for a fresh link.');
    }
  }

  const identity: BaoTermIdentity = {
    sk: bytesToHex(sk),
    role: 'member',
    name: bundle.name,
    identity_name: identityName,
    registry_version: 0,
    invites: [],
    private_channels: bundle.channels,
    community: {
      id: bundle.community_id,
      owner: bundle.owner,
      owner_salt: bundle.owner_salt,
      community_root: bundle.community_root,
      root_epoch: bundle.root_epoch,
      name: bundle.name,
      relays: bundle.relays,
    },
    joined_at: Date.now(),
  };
  saveIdentity(identity);

  return {
    identity: identityName,
    role: 'member',
    community: { id: community.idHex, name: community.name, relays: community.relays, agent_gated: !!gate },
    npub: nip19.npubEncode(pubkey),
  };
}

export interface BaoTermSayArgs {
  text: string;
  channel?: string;
  key?: string;
  identityName?: string;
}

async function sayCommand(args: BaoTermSayArgs): Promise<unknown> {
  const identity = requireIdentity(args.identityName);
  if (!args.text) throw new Error('say needs text.');
  const sk = hexToBytes(identity.sk);
  const pubkey = getPublicKey(sk);
  const signer = signerOf(sk);
  const community = communityOf(identity);

  const channel = await resolveChannel(community, args.channel, identity);
  const group = channel.current.group as GroupKey;

  // Idempotency: scan our own history for the dedupe key before publishing.
  if (args.key) {
    const existing = await channelMessagesInternal(identity, channel.idHex);
    const dupe = existing.find((m) => m.author === pubkey && m.tags.some((t) => t[0] === 'd' && t[1] === args.key));
    if (dupe) return { rumor_id: dupe.id, deduped: true };
  }

  const tags: string[][] = channelBindingTags(channel.idHex, channel.current.epoch);
  if (args.key) tags.push(['d', args.key]);
  for (const match of args.text.match(/npub1[02-9ac-hj-np-z]{20,}/g) ?? []) {
    try {
      const decoded = nip19.decode(match);
      if (decoded.type === 'npub') tags.push(['p', decoded.data]);
    } catch { /* not a valid npub — leave as plain text */ }
  }

  const rumor = buildRumor({ kind: 9, content: args.text, tags, pubkey, ms: Date.now() });
  const seal = await sealRumor(rumor, 20013, group, signer);
  const wrap = wrapSeal(seal, group);
  await publishAll(community.relays, wrap, `message to #${channel.name}`);
  return {
    rumor_id: rumor.id,
    deduped: false,
    channel: { id: channel.idHex, name: channel.name, private: channel.isPrivate, epoch: Number(channel.current.epoch) },
  };
}

export interface BaoTermReadArgs {
  channel?: string;
  identityName?: string;
  limit?: number;
}

async function readCommand(args: BaoTermReadArgs): Promise<unknown> {
  const identity = requireIdentity(args.identityName);
  const community = communityOf(identity);
  const channel = await resolveChannel(community, args.channel, identity);
  const messages = await channelMessagesInternal(identity, channel.idHex);
  const trimmed = typeof args.limit === 'number' && args.limit > 0 ? messages.slice(-args.limit) : messages;

  // Member list from the guestbook.
  const gb = currentGuestbookGroup(community);
  const gbWraps = await queryAll(community.relays, { kinds: [KIND_WRAP], authors: [gb.pk] });
  const members: { pubkey: string; npub: string; status: string }[] = [];
  const seen = new Map<string, string>();
  for (const wrap of gbWraps.sort((a, b) => a.created_at - b.created_at)) {
    try {
      const opened = openWrap(wrap, gb);
      if (opened.kind === KIND_JOIN_LEAVE) seen.set(opened.author, opened.content);
    } catch { /* skip */ }
  }
  for (const [pubkey, status] of seen) members.push({ pubkey, npub: nip19.npubEncode(pubkey), status });

  return {
    community: community.name,
    channel: { id: channel.idHex, name: channel.name, private: channel.isPrivate, epoch: Number(channel.current.epoch) },
    messages: trimmed.map((m) => ({
      id: m.id,
      author: m.author,
      author_npub: nip19.npubEncode(m.author),
      ms: m.ms,
      content: m.content,
      tags: m.tags,
    })),
    members,
  };
}

async function whoamiCommand(args: { identityName?: string }): Promise<unknown> {
  const identity = requireIdentity(args.identityName);
  const pubkey = getPublicKey(hexToBytes(identity.sk));
  return {
    identity: identity.identity_name,
    role: identity.role,
    community: { id: identity.community.id, name: identity.community.name, relays: identity.community.relays },
    npub: nip19.npubEncode(pubkey),
  };
}

async function identitiesCommand(): Promise<unknown> {
  return {
    identities: listIdentities().map((name) => {
      const id = getIdentity(name)!;
      return {
        name,
        role: id.role,
        community: id.community.name,
        npub: nip19.npubEncode(getPublicKey(hexToBytes(id.sk))),
        active: getActiveIdentity()?.identity_name === name,
      };
    }),
    active: getActiveIdentity()?.identity_name ?? null,
  };
}

async function switchCommand(args: { identityName?: string }): Promise<unknown> {
  if (!args.identityName) throw new Error('use needs an identity name.');
  setActiveIdentity(args.identityName);
  return { active: args.identityName };
}

async function removeCommand(args: { identityName?: string }): Promise<unknown> {
  const identity = requireIdentity(args.identityName);
  deleteIdentity(identity.identity_name);
  return { removed: identity.identity_name };
}

async function helpCommand(): Promise<unknown> {
  return {
    commands: [
      { cmd: 'create', args: '--name "…" [--agent-only] [--as <name>] [--relays wss://…[,wss://…]]' },
      { cmd: 'invite', args: '[--label "…"] [--single-use] [--human] [--as <name>]' },
      { cmd: 'join', args: '<invite-url> [--as <name>]' },
      { cmd: 'say', args: '<text> [--channel <name|id>] [--key <idempotency>] [--as <name>]' },
      { cmd: 'read', args: '[--channel <name|id>] [--limit N] [--as <name>]' },
      { cmd: 'whoami', args: '[--as <name>]' },
      { cmd: 'identities', args: '' },
      { cmd: 'use', args: '<name>' },
      { cmd: 'remove', args: '[--as <name>]' },
      { cmd: 'help', args: '' },
    ],
  };
}

// ── Channel message scan (minimal local port of chat-core channelMessages) ──

interface LocalChannelMessage {
  id: string;
  author: string;
  ms: number;
  content: string;
  tags: string[][];
}

async function channelMessagesInternal(identity: BaoTermIdentity, channelHex: string): Promise<LocalChannelMessage[]> {
  const community = communityOf(identity);
  const channel = await resolveChannel(community, channelHex, identity);
  const streams = new Map(channel.streams.map((s) => [s.group.pk, s]));
  const wraps = await queryAll(community.relays, { kinds: [KIND_WRAP], authors: [...streams.keys()] });
  const messages: LocalChannelMessage[] = [];
  const seen = new Set<string>();
  for (const wrap of wraps) {
    if (seen.has(wrap.id)) continue;
    seen.add(wrap.id);
    const stream = streams.get(wrap.pubkey);
    if (!stream) continue;
    let opened: OpenedEvent;
    try {
      opened = openWrap(wrap, stream.group);
    } catch { continue; }
    if (opened.sealKind !== 20013) continue;
    try {
      checkChannelBinding(opened, channel.idHex, stream.epoch);
    } catch { continue; }
    if (opened.kind !== 9) continue;
    messages.push({ id: opened.rumorId, author: opened.author, ms: opened.ms, content: opened.content, tags: opened.tags });
  }
  messages.sort((a, b) => a.ms - b.ms || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return messages;
}

// ── Channel resolution (browser-side port of chat-core resolveChannel) ──────

async function resolveChannel(
  community: CommunityV2,
  selector: string | undefined,
  identity: BaoTermIdentity,
): Promise<ChannelV2> {
  const control = currentControlGroup(community);
  const wraps = await queryAll(community.relays, { kinds: [KIND_WRAP], authors: [control.pk] });
  const folded = foldControlState(openControlWraps(wraps, [control]), community.id, community.owner);
  const channels = channelsView(community, folded);
  let matches: ChannelV2[];
  if (selector) {
    const needle = selector.trim();
    matches = /^[0-9a-f]{64}$/i.test(needle)
      ? channels.filter((c) => c.idHex === needle.toLowerCase())
      : channels.filter((c) => c.name.toLowerCase() === needle.toLowerCase());
  } else {
    const saved = identity.community.general_channel_id?.toLowerCase();
    matches = saved ? channels.filter((c) => c.idHex === saved) : [];
    if (matches.length === 0) matches = channels.filter((c) => !c.isPrivate && c.name.toLowerCase() === 'general');
    if (matches.length === 0) matches = channels.filter((c) => !c.isPrivate).slice(0, 1);
  }
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error(`Channel ${JSON.stringify(selector)} is ambiguous; use its 64-hex id.`);
  const available = channels.map((c) => `${c.name} (${c.idHex})`).join(', ');
  throw new Error(`Channel ${JSON.stringify(selector ?? 'general')} not found.${available ? ` Available: ${available}` : ''}`);
}

// ── Identity lookup helper ───────────────────────────────────────────────────

function requireIdentity(name?: string): BaoTermIdentity {
  const target = name ?? getActiveIdentity()?.identity_name;
  if (!target) throw new Error('No active identity. Run `create --as <name>` or `join <url> --as <name>` first, or pass --as.');
  const identity = getIdentity(target);
  if (!identity) throw new Error(`No identity "${target}". Run identities to see saved names.`);
  return identity;
}

// ── Top-level dispatch ──────────────────────────────────────────────────────

export interface BaoTermCommandContext {
  /** Active identity selector (overrides any persisted active identity). */
  as?: string;
}

export async function dispatchBaoTerm(
  command: string,
  args: Record<string, unknown> = {},
  ctx: BaoTermCommandContext = {},
): Promise<BaoTermResult<unknown>> {
  try {
    const identityName = (args.as as string | undefined) ?? ctx.as;
    let result: unknown;
    switch (command) {
      case 'create':
        result = await createCommand({
          name: args.name as string,
          identityName,
          agentOnly: !!args.agentOnly,
          relays: args.relays as string[] | undefined,
        });
        break;
      case 'invite':
        result = await inviteCommand({ identityName, label: args.label as string | undefined, singleUse: !!args.singleUse });
        break;
      case 'join':
        result = await joinCommand({ inviteUrl: args.inviteUrl as string, identityName });
        break;
      case 'say':
        result = await sayCommand({
          text: args.text as string,
          channel: args.channel as string | undefined,
          key: args.key as string | undefined,
          identityName,
        });
        break;
      case 'read':
        result = await readCommand({
          channel: args.channel as string | undefined,
          identityName,
          limit: args.limit as number | undefined,
        });
        break;
      case 'whoami':
        result = await whoamiCommand({ identityName });
        break;
      case 'identities':
        result = await identitiesCommand();
        break;
      case 'use':
        result = await switchCommand({ identityName: args.name as string | undefined });
        break;
      case 'remove':
        result = await removeCommand({ identityName });
        break;
      case 'help':
        result = await helpCommand();
        break;
      default:
        return err(`Unknown command: ${command}. Run help.`);
    }
    return ok(result);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

// ── CLI string parser (the in-page terminal calls this) ─────────────────────

/** Minimal POSIX-ish tokenizer: quoted strings, --flag value, --flag=value. */
export function parseCommandLine(
  line: string,
): { command: string; args: Record<string, unknown>; positional: string[] } | { error: string } {
  const trimmed = line.trim();
  if (!trimmed) return { error: 'empty' };
  const tokens: string[] = [];
  let i = 0;
  while (i < trimmed.length) {
    while (i < trimmed.length && /\s/.test(trimmed[i])) i++;
    if (i >= trimmed.length) break;
    const ch = trimmed[i];
    if (ch === '"' || ch === "'") {
      const close = trimmed.indexOf(ch, i + 1);
      if (close < 0) return { error: 'unterminated quote' };
      tokens.push(trimmed.slice(i + 1, close));
      i = close + 1;
    } else {
      let end = i;
      while (end < trimmed.length && !/\s/.test(trimmed[end])) end++;
      tokens.push(trimmed.slice(i, end));
      i = end;
    }
  }
  const [command, ...rest] = tokens;
  const args: Record<string, unknown> = {};
  const positional: string[] = [];
  const valueFlags = new Set(['--name', '--label', '--as', '--channel', '--key', '--limit', '--relays']);
  const boolFlags = new Set(['--agent-only', '--single-use', '--json']);
  for (let j = 0; j < rest.length; j++) {
    const t = rest[j];
    if (t.startsWith('--')) {
      const eq = t.indexOf('=');
      if (eq >= 0) {
        args[camelFlag(t.slice(0, eq))] = t.slice(eq + 1);
        continue;
      }
      if (boolFlags.has(t)) {
        args[camelFlag(t)] = true;
        continue;
      }
      if (valueFlags.has(t)) {
        args[camelFlag(t)] = rest[++j];
        continue;
      }
      args[camelFlag(t)] = true;
    } else {
      positional.push(t);
    }
  }
  if (positional.length > 0) {
    if (command === 'say' && !('text' in args)) args.text = positional.join(' ');
    else if (command === 'join' && !('inviteUrl' in args)) args.inviteUrl = positional[0];
    else if (command === 'use' && !('name' in args)) args.name = positional[0];
  }
  return { command, args, positional };
}

function camelFlag(flag: string): string {
  return flag.replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

// Unused-but-exported for parity with CLI tooling consumers; suppresses noUnusedLocals.
export const __hashHelpers = { getEventHash };
