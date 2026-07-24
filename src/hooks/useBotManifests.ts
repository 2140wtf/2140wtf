import { useNostr } from "@nostrify/react";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { useAppContext } from "@/hooks/useAppContext";
import { useEventStore } from "@/hooks/useEventStore";
import { BOT_MANIFEST_KIND, parseBotManifest, type BotCommandEntry } from "@/lib/botCommands";

import type { NostrEvent } from "@nostrify/nostrify";

/**
 * Widely-indexed relays queried for manifests alongside the conversation's own
 * and the app's.
 *
 * Neither end of that union is sufficient alone. A conversation's relay may drop
 * events from non-members, and in practice it also lags: a bot that republishes
 * its interface can land on the indexers while its community relay still serves
 * the retired one. But a bot may equally publish its manifest ONLY to the
 * community it serves, and no indexer would ever see it. Reading the union and
 * taking the newest per author resolves the manifest whichever way it was
 * published, and whichever relay is behind.
 */
export const BOT_DISCOVERY_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://purplepag.es",
  "wss://relay.nostr.band",
];

/** Relays cap how many authors one filter may name; stay well inside that. */
const AUTHOR_CHUNK = 50;

/** The bits of a participant's profile the picker renders. */
export interface BotRosterProfile {
  name?: string;
  picture?: string;
}

export interface BotManifestsResult {
  /** Every command of every bot present, flattened and ready to render or parse. */
  entries: BotCommandEntry[];
  /** Hex pubkeys of the bots in this conversation, whether or not they publish a manifest. */
  bots: string[];
  /**
   * Profiles of everyone in the conversation, a by-product of the bot sweep.
   * Surfaced so a `user` argument's member picker can search by name and show
   * faces without a second lookup.
   */
  profiles: Record<string, BotRosterProfile>;
  /** Nothing known yet and a fetch is in flight. */
  isLoading: boolean;
  /** A refresh is in flight behind data we already have. */
  isFetching: boolean;
}

const EMPTY: string[] = [];

/** Query `kinds` for `authors` in author-sized chunks, over an explicit relay set. */
async function queryChunked(
  query: (filters: { kinds: number[]; authors: string[] }[], opts: { signal: AbortSignal }) => Promise<NostrEvent[]>,
  kinds: number[],
  authors: string[],
  signal: AbortSignal,
): Promise<NostrEvent[]> {
  const out: NostrEvent[] = [];
  for (let i = 0; i < authors.length; i += AUTHOR_CHUNK) {
    const chunk = authors.slice(i, i + AUTHOR_CHUNK);
    out.push(...(await query([{ kinds, authors: chunk }], { signal })));
  }
  return out;
}

/**
 * The newest event of `kind` per author. A relay may answer with whatever it
 * likes, so both the kind and the author are re-checked here rather than trusted
 * from the filter: a bot's manifest is newer than its profile, so a relay
 * returning the manifest to a kind-0 query would otherwise win the
 * newest-per-author race and make the bot look like it has no `bot` flag at all.
 */
function newestPerAuthor(events: NostrEvent[], asked: Set<string>, kind: number): Map<string, NostrEvent> {
  const best = new Map<string, NostrEvent>();
  for (const ev of events) {
    if (ev.kind !== kind || !asked.has(ev.pubkey)) continue;
    const held = best.get(ev.pubkey);
    if (!held || ev.created_at > held.created_at) best.set(ev.pubkey, ev);
  }
  return best;
}

/**
 * Resolve the bot commands available in a conversation.
 *
 * Discovery is two-stage, which is what keeps it cheap in a large room. First the
 * participants' `kind:0` metadata says which of them are bots (NIP-24's `bot`
 * flag — the same signal the Bot pill renders from). Only those few get a
 * manifest query, so a 500-member channel costs one profile sweep and a lookup
 * for the handful of bots, not five hundred lookups.
 *
 * A manifest is untrusted: one that fails validation is ignored entirely rather
 * than partially rendered, and a bot with no valid manifest simply contributes
 * no commands.
 *
 * Discovery warms when the conversation opens rather than when a `/` is typed:
 * the composer has to know whether any bot is present before the user types
 * anything, in order to decide whether to offer Commands at all. Warming here
 * also means the `/` menu is already populated by the time it is opened. A
 * conversation with no roster (a plain DM) fetches nothing.
 *
 * `conversationRelays` are the relays this conversation's own traffic uses (a
 * community's relays, a NIP-29 host). They are searched alongside the app's and
 * the public indexers, because a bot may have published its manifest to only one
 * of the three.
 */
export function useBotManifests(
  memberPubkeys: string[] | undefined,
  conversationRelays?: string[],
): BotManifestsResult {
  const { nostr } = useNostr();
  const { config } = useAppContext();
  const eventStore = useEventStore();

  // Sorted + joined so the query key is stable under member-list reordering, and
  // changes the moment the participant set actually changes.
  const members = useMemo(
    () => (memberPubkeys ? [...new Set(memberPubkeys)].sort() : EMPTY),
    [memberPubkeys],
  );
  const membersKey = members.join(",");

  // Both sweeps search the same union: the conversation's own relays (a Concord
  // bot's profile AND manifest live on its community relay), the app relays, and
  // the public indexers. Bot detection has to look where the bot actually is —
  // querying only the pool misses a bot whose kind-0 never reached it, even
  // though its member row shows a Bot pill (the pill reads the local cache,
  // filled from the community relay on join).
  const relays = useMemo(
    () =>
      [...new Set([...(conversationRelays ?? []), ...config.appRelays, ...BOT_DISCOVERY_RELAYS])].sort(),
    [conversationRelays, config.appRelays],
  );
  const relayKey = relays.join(",");

  const botsQuery = useQuery({
    queryKey: ["bot-flags", membersKey, relayKey],
    queryFn: async ({ signal }) => {
      const asked = new Set(members);
      // Merge the local cache with the network. The cache is what a member's Bot
      // pill already reads (via useAuthor), so reading it here makes detection
      // agree with what the user sees, even when a fresh relay query is slow,
      // auth-gated, or simply lacks a profile the client synced on join.
      const store = await eventStore;
      const [cached, network] = await Promise.all([
        store.query([{ kinds: [0], authors: members }]) as Promise<NostrEvent[]>,
        queryChunked((filters, opts) => nostr.group(relays).query(filters, opts), [0], members, signal),
      ]);
      const events = [...cached, ...network];
      const bots: string[] = [];
      const profiles: Record<string, BotRosterProfile> = {};
      for (const [pubkey, ev] of newestPerAuthor(events, asked, 0)) {
        let meta: { bot?: unknown; name?: unknown; display_name?: unknown; picture?: unknown };
        try {
          meta = JSON.parse(ev.content);
        } catch {
          continue; // A profile we cannot parse is simply not a bot.
        }
        if (meta?.bot === true) bots.push(pubkey);
        profiles[pubkey] = {
          name: typeof meta?.name === "string"
            ? meta.name
            : typeof meta?.display_name === "string"
              ? meta.display_name
              : undefined,
          picture: typeof meta?.picture === "string" ? meta.picture : undefined,
        };
      }
      return { bots: bots.sort(), profiles };
    },
    enabled: members.length > 0,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const bots = botsQuery.data?.bots ?? EMPTY;
  const botsKey = bots.join(",");

  const manifestsQuery = useQuery({
    // The relay set is part of the identity of this result: querying a different
    // set can legitimately yield a different (newer) manifest, so a relay change
    // must invalidate rather than serve a cached answer from the old set.
    queryKey: ["bot-manifests", botsKey, relayKey],
    queryFn: async ({ signal }) => {
      const asked = new Set(bots);
      const events = await queryChunked(
        (filters, opts) => nostr.group(relays).query(filters, opts),
        [BOT_MANIFEST_KIND],
        bots,
        signal,
      );
      const entries: BotCommandEntry[] = [];
      for (const [pubkey, ev] of newestPerAuthor(events, asked, BOT_MANIFEST_KIND)) {
        // The newest manifest is the only one that counts: a bot that breaks its
        // own latest edition has no interface, rather than falling back to a
        // stale one it has already retired.
        const manifest = parseBotManifest(ev.content);
        if (!manifest) continue;
        for (const command of manifest.commands) entries.push({ bot: pubkey, command });
      }
      return entries;
    },
    enabled: bots.length > 0,
    // Republishing is the one mechanism a bot has to change its interface, so a
    // cached manifest must not be assumed current for the whole session. Bounded
    // rather than live: this refetches on the next mount past the window, and
    // never polls a bot that has no manifest at all.
    staleTime: 5 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  return {
    entries: manifestsQuery.data ?? [],
    bots,
    profiles: botsQuery.data?.profiles ?? {},
    isLoading:
      (botsQuery.isLoading && botsQuery.fetchStatus !== "idle") ||
      (manifestsQuery.isLoading && manifestsQuery.fetchStatus !== "idle"),
    isFetching: botsQuery.isFetching || manifestsQuery.isFetching,
  };
}
