/**
 * Concord V2 community assembly — genesis (CORD-02 §1), the runtime channel
 * view (CORD-03), and the classifier the Add wizard uses to tell a V2 invite
 * from everything else.
 */

import {
  bytesToHex,
  channelGroupKey,
  communityIdOf,
  hex32,
  random32,
  voiceGroupKey,
  voiceMediaKey,
} from "@/concord-v2/lib/derive";
import { parseInviteLink, type ParsedInviteLink } from "@/concord-v2/lib/invite";
import type { FoldedControl } from "@/concord-v2/lib/control";
import { capRelays, type ChannelV2, type CommunityV2, type VoiceKeys } from "@/concord-v2/lib/types";

/**
 * Mint a brand-new community: a random `owner_salt` commits the owner into the
 * self-certifying `community_id`, and an independent random `community_root`
 * is the access key (deliberately NOT derived from the id, so access can
 * rotate while identity stays fixed).
 *
 * Genesis publishes exactly two owner-signed editions — the metadata and one
 * public `#general` Channel — which the caller builds; this mints the secrets
 * and the runtime shape.
 */
export function mintCommunity(name: string, ownerPubkeyHex: string, relays: string[]): {
  community: CommunityV2;
  generalChannelId: Uint8Array;
} {
  const ownerSalt = random32();
  const owner = ownerPubkeyHex.toLowerCase();
  const id = communityIdOf(hex32(owner), ownerSalt);
  const root = random32();
  const generalChannelId = random32();
  return {
    community: {
      id,
      idHex: bytesToHex(id),
      owner,
      ownerSalt,
      root,
      rootEpoch: 0n,
      heldRoots: [{ epoch: 0n, key: root }],
      privateChannels: [],
      relays: capRelays(relays),
      name,
    },
    generalChannelId,
  };
}

/**
 * Assemble the channels the member can actually read from the Control fold +
 * held keys:
 *
 *   - a PUBLIC channel derives its stream from the community_root per held
 *     root epoch (readable by every member, rotates with the base for free);
 *   - a PRIVATE channel needs its independent key from the member's bundle —
 *     lacking it, the channel is omitted (its ciphertext is unreadable anyway);
 *   - deleted channels are dropped from display (history stays decryptable to
 *     anyone who held the keys, but that's a future "archive" view).
 *
 * Ordered by name for a stable sidebar.
 */
export function channelsView(community: CommunityV2, folded: FoldedControl | undefined): ChannelV2[] {
  const out: ChannelV2[] = [];
  const seen = new Set<string>();

  const privateKeysById = new Map(community.privateChannels.map((ch) => [bytesToHex(ch.id), ch]));

  // Every Channel is callable: its call coordinates derive from the same
  // (secret, epoch) that addresses its CURRENT Chat Plane (CORD-07 §1), so the
  // room name and media root roll with the Channel's key on a rekey.
  const voiceKeys = (secret: Uint8Array, id: Uint8Array, epoch: bigint): VoiceKeys => ({
    room: voiceGroupKey(secret, id, epoch),
    mediaKey: voiceMediaKey(secret, id, epoch),
  });

  for (const def of folded?.channels.values() ?? []) {
    if (def.deleted) continue;
    seen.add(def.channelIdHex);
    const id = hex32(def.channelIdHex);

    if (!def.isPrivate) {
      const streams = community.heldRoots.map((r) => ({
        epoch: r.epoch,
        group: channelGroupKey(r.key, id, r.epoch),
      }));
      out.push({
        id,
        idHex: def.channelIdHex,
        name: def.name,
        isPrivate: false,
        voice: voiceKeys(community.root, id, community.rootEpoch),
        streams,
        current: streams[0],
      });
      continue;
    }

    const held = privateKeysById.get(def.channelIdHex);
    if (!held) continue; // no key → cannot read; omit rather than tease
    const stream = { epoch: held.epoch, group: channelGroupKey(held.key, id, held.epoch) };
    out.push({
      id,
      idHex: def.channelIdHex,
      name: def.name,
      isPrivate: true,
      voice: voiceKeys(held.key, id, held.epoch),
      streams: [stream],
      current: stream,
    });
  }

  // Private channels held in the bundle but not (yet) folded from the Control
  // Plane still render (the fold may lag a fresh join); the fold's name wins
  // once it lands.
  for (const held of community.privateChannels) {
    const idHex = bytesToHex(held.id);
    if (seen.has(idHex)) continue;
    const stream = { epoch: held.epoch, group: channelGroupKey(held.key, held.id, held.epoch) };
    out.push({
      id: held.id,
      idHex,
      name: held.name || idHex.slice(0, 8),
      isPrivate: true,
      voice: voiceKeys(held.key, held.id, held.epoch),
      streams: [stream],
      current: stream,
    });
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// ── Add-wizard classification ────────────────────────────────────────────────

/** What a pasted "add" input classifies to, V2-aware. */
export type AddInputV2 = { kind: "concord-v2"; invite: ParsedInviteLink } | { kind: "other" };

/** Classify a pasted string as a Concord V2 invite, or leave it for other classifiers. */
export function classifyV2Invite(input: string): AddInputV2 {
  const invite = parseInviteLink(input);
  return invite ? { kind: "concord-v2", invite } : { kind: "other" };
}
