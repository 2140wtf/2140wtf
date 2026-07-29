import { useNostr } from "@nostrify/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { BannedFromCommunityError, bundleToEntry, fetchControlFold } from "@/concord-v2/hooks/useCommunityActions2";
import { useCommunityList2, useUpdateCommunityList2 } from "@/concord-v2/hooks/useCommunityList2";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  directInviteExpired,
  parseDirectInviteRumor,
  unwrapDirectInvite,
} from "@/concord-v2/lib/directInvite";
import { buildJoinRumor, currentGuestbookGroup, sealGuestbook } from "@/concord-v2/lib/guestbook";
import { agentGateOf, grindJoinRumor } from "@/concord-v2/lib/agentGate";
import {
  advanceInviteInboxCursor,
  inviteInboxSince,
  queryStoredInvites,
  writeStoredInvites,
} from "@/concord-v2/lib/inviteInbox";
import { liveEntries, rehydrateCommunity } from "@/concord-v2/lib/communityList";
import { inviteDeliveryRelays, recipientInboxRelays } from "@/concord-v2/lib/inviteRelays";
import { getDecryptConsent } from "@/lib/decryptConsent";
import { signerNeedsApproval } from "@/lib/bulkDecryptGate";
import { useDecryptConsent } from "@/hooks/useDecryptConsent";
import type { InviteBundle } from "@/concord-v2/lib/invite";
import { KIND_DIRECT_INVITE, KIND_WRAP } from "@/concord-v2/lib/kinds";

import type { NostrEvent } from "@nostrify/nostrify";

/** A direct invite received over a gift wrap, awaiting the user's consent. */
export interface ParkedInvite2 {
  /** Gift-wrap event id (stable key + dedup). */
  wrapId: string;
  /** The inviter's pubkey (the seal author, verified). */
  sender: string;
  /** The decrypted, validated invite bundle. */
  bundle: InviteBundle;
  communityId: string;
  name: string;
  /**
   * True when this invite is for a community I'm ALREADY in, but carries a
   * higher `root_epoch` than I currently hold — an admin healing me forward
   * after I was stranded on an old epoch (CORD-05/06). The accept path merges
   * it forward only; a lower/equal epoch never parks as a catch-up.
   */
  catchUp?: boolean;
}

/**
 * Scan the direct-invite inbox: the indexed CORD-05 §6 lookup
 * `{ kinds: [1059], "#p": [me], "#k": ["3313"] }` — exactly this user's
 * invites, never the whole giftwrap backlog. Each wrap is decrypted once,
 * persisted (inviteInbox), and **parked** — consent comes first: a received
 * invite never auto-joins, no relay connection or Join happens until the user
 * accepts. Already-joined or tombstoned communities are filtered out so the
 * prompt doesn't re-nag.
 */
export function useDirectInvites2() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { data: list, isFetched: listFetched } = useCommunityList2();
  const { consent } = useDecryptConsent();

  const known = new Set(list ? liveEntries(list.list).map((e) => e.community_id) : []);
  // Newest tombstone time (ms) per community. A tombstone suppresses only
  // invites SENT BEFORE it — a leave/decline/ban buries the invites it knew
  // about, never a fresh re-invite (someone chose to ask again).
  const tombstonedAt = new Map<string, number>();
  for (const t of list?.list.tombstones ?? []) {
    const prev = tombstonedAt.get(t.community_id);
    if (prev === undefined || t.removed_at > prev) tombstonedAt.set(t.community_id, t.removed_at);
  }

  // Don't scan until the membership list is trustworthy: an UNDECRYPTABLE read
  // (remote/bunker signer not ready) yields an untrusted empty list — treating
  // it as ready would re-park invites for communities we're already in and
  // spam the prompt on launch. A decrypt-failed list is explicitly NOT ready.
  const decryptFailed = Boolean(list?.decryptFailed);
  const listReady = !decryptFailed && (list !== undefined || listFetched);

  return useQuery<ParkedInvite2[]>({
    queryKey: [
      "concord2",
      "direct-invites",
      user?.pubkey,
      consent,
      [...known].sort().join(","),
      [...tombstonedAt.entries()].map(([id, at]) => `${id}@${at}`).sort().join(","),
    ],
    enabled: Boolean(user?.signer.nip44) && listReady,
    staleTime: 30_000,
    // Invites aren't latency-critical (the user consents whenever they get to
    // it) and the cursor means a longer gap just delays discovery, never drops
    // one. Poll slowly and only while the tab is visible.
    refetchInterval: 5 * 60_000,
    refetchIntervalInBackground: false,
    queryFn: async ({ signal }) => {
      const pubkey = user!.pubkey;

      // Fetch only wraps newer than the cursor (rewound by NIP-59's backdate
      // window — direct-invite wraps DO tweak their timestamps into the past).
      // Decrypt just the ones not already stored, persist, advance the cursor.
      const since = await inviteInboxSince(pubkey);
      const filter: { kinds: number[]; "#p": string[]; "#k": string[]; limit: number; since?: number } = {
        kinds: [KIND_WRAP],
        "#p": [pubkey],
        "#k": [String(KIND_DIRECT_INVITE)],
        limit: 200,
      };
      if (since > 0) filter.since = since;
      // Scan exactly where senders deliver (CORD-05 §6): my own published inbox,
      // or the stock interop floor when I've published none — the same set the
      // sender resolves for me. A listless member is otherwise unreachable by a
      // sender who doesn't share their app-relay defaults (e.g. another client).
      const myInbox = await recipientInboxRelays(nostr, pubkey);
      let wraps: NostrEvent[] = [];
      // A FAILED lookup of my OWN inbox is not "no list": scanning stock on
      // uncertainty would leak my `#p` REQ to the public stock relays. Skip the
      // network fetch this round (parked invites still render below); the poll
      // retries once the lookup succeeds.
      if (myInbox !== null) {
        const scanRelays = inviteDeliveryRelays(myInbox);
        const perRelay = await Promise.all(
          scanRelays.map((url) =>
            nostr
              .relay(url)
              .query([filter], { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) })
              .catch(() => [] as NostrEvent[]),
          ),
        );
        const seenWrap = new Set<string>();
        wraps = perRelay.flat().filter((e) => (seenWrap.has(e.id) ? false : seenWrap.add(e.id)));
      }

      if (wraps.length > 0) {
        const stored = new Set((await queryStoredInvites({ signal })).map((i) => i.wrapId));

        // Consent gate: opening each fresh wrap is two nip-44 signer decrypts —
        // a bunker/extension storm on a cold inbox. This is a BACKGROUND poller,
        // so it never opens the one-time prompt itself (the interactive DM/room
        // path does); it just holds off decrypting NEW wraps until consent is
        // granted. A local nsec has no approval to gate, so it always decrypts.
        // Already-stored invites are still read back below with no decrypt, so a
        // declined user's existing invites stay visible. Advancing the cursor is
        // likewise deferred so a later "allow" re-scans them.
        const mayDecrypt = !signerNeedsApproval(user!.method) || getDecryptConsent() === "allowed";
        const fresh: { wrap: NostrEvent; unwrapped: NonNullable<Awaited<ReturnType<typeof unwrapDirectInvite>>> }[] = [];
        let newestWrap = 0;
        if (mayDecrypt) {
          for (const wrap of wraps) {
            if (wrap.created_at > newestWrap) newestWrap = wrap.created_at;
            if (stored.has(wrap.id)) continue;
            const unwrapped = await unwrapDirectInvite(wrap, user!.signer);
            if (!unwrapped) continue;
            fresh.push({ wrap, unwrapped });
          }
          writeStoredInvites(fresh);
          if (newestWrap > 0) await advanceInviteInboxCursor(pubkey, newestWrap);
        }
      }

      // The epoch each already-joined community currently holds, so a fresher
      // bundle (an admin healing a stranded member: CORD-05 §6 re-handoff) is
      // recognised as a CATCH-UP rather than skipped as "already a member".
      const heldEpoch = new Map<string, number>();
      if (list) {
        for (const e of liveEntries(list.list)) {
          heldEpoch.set(e.community_id, e.current.root_epoch);
        }
      }

      // Read the parked set back from the store (no re-decrypt), then apply
      // the consent filters against the current membership list.
      const parked = new Map<string, ParkedInvite2>();
      for (const record of await queryStoredInvites({ signal })) {
        // The outer `k` tag was a hint; the rumor's kind + validation are the
        // authority (bounds, self-certifying owner — a forged bundle drops).
        const bundle = parseDirectInviteRumor(record.rumor.kind, record.rumor.content);
        if (!bundle) continue;
        // A dead handoff isn't worth a prompt: expired invites never park.
        if (directInviteExpired(bundle)) continue;
        // A left/declined community suppresses only the invites that predate
        // the tombstone (rumor time is the sender's word, which is fine: the
        // gate is anti-nag, not authority).
        const buriedAt = tombstonedAt.get(bundle.community_id);
        if (buriedAt !== undefined && record.rumor.created_at * 1000 <= buriedAt) continue;
        const held = heldEpoch.get(bundle.community_id);
        const catchUp = held !== undefined && bundle.root_epoch > held;
        // Skip an already-joined community UNLESS the bundle is strictly fresher
        // (higher epoch) — that's a key catch-up for a stranded member, and the
        // accept path merges it forward (never backward).
        if (known.has(bundle.community_id) && !catchUp) continue;
        parked.set(record.wrapId, {
          wrapId: record.wrapId,
          sender: record.sender,
          bundle,
          communityId: bundle.community_id,
          name: bundle.name,
          catchUp,
        });
      }
      return [...parked.values()];
    },
  });
}

/**
 * Accept a parked direct invite: keep the keys — record the entry in the
 * Community List vault — then announce with a self-signed Guestbook Join
 * echoing the invite's attribution (CORD-05 §6 accepts exactly like a §1
 * link acceptance).
 *
 * A CATCH-UP invite (`invite.catchUp`) is for a community I'm already in that
 * arrived on a HIGHER epoch than I hold — an admin healing me forward after I
 * was stranded on a stale epoch. It routes through the same `add`, whose
 * deterministic list merge (`mergeEntry`/`freshest`) is epoch-monotonic: the
 * higher-epoch bundle becomes `current` while `seed` keeps my earliest root, so
 * the merge only ever moves me FORWARD — a lower/equal epoch could never reach
 * here (the scan only parks a strictly-fresher catch-up) and could not lower
 * `current` even if it did. No Guestbook Join is re-sent for a catch-up (I'm
 * already a member); only a fresh join announces.
 */
export function useAcceptDirectInvite2() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { mutateAsync: updateList } = useUpdateCommunityList2();
  const queryClient = useQueryClient();

  return useMutation<{ communityId: string; name: string }, Error, { invite: ParkedInvite2 }>({
    mutationFn: async ({ invite }) => {
      if (!user) throw new Error("Sign in to accept an invite.");
      const { bundle } = invite;
      if (directInviteExpired(bundle)) throw new Error("This invite has expired.");

      const entry = bundleToEntry(bundle);
      // A banned npub must not accept an invite either (CORD-04 §4) — a catch-up
      // (already a member, healing forward) skips the check, since a still-valid
      // member folding a fresher bundle isn't "joining".
      // The agent gate does NOT refuse here: a direct invite is owner-vetted.
      // Instead the app clears the gate FOR the invitee — grinds the Join's
      // proof-of-work itself so the roster fold admits them.
      let gateDifficulty: number | undefined;
      if (!invite.catchUp) {
        const community = rehydrateCommunity(entry);
        if (community) {
          const folded = await fetchControlFold(nostr, community);
          if (folded.banned.has(user.pubkey)) throw new BannedFromCommunityError();
          gateDifficulty = agentGateOf(folded.metadata)?.difficulty;
        }
      }
      // `add` → mergeCommunityLists → mergeEntry → freshest: epoch-monotonic, so
      // this both onboards a new member and heals an existing one FORWARD, never
      // backward (a stale bundle can't lower `current.root_epoch`).
      await updateList({ type: "add", entry });

      // A catch-up is not a new membership: I'm already announced. Re-sending a
      // Guestbook Join would be noise. Only a genuine first join announces.
      if (!invite.catchUp) {
        // Best-effort Join, attributed to the inviter (the seal-verified sender
        // beats an unverified creator_npub claim) — coalesce self-heals if it
        // never lands.
        void (async () => {
          const community = rehydrateCommunity(entry);
          if (!community) return;
          const attribution = { creator: invite.sender, label: bundle.label };
          const rumor = gateDifficulty
            ? grindJoinRumor(user.pubkey, Date.now(), gateDifficulty, attribution)
            : buildJoinRumor(user.pubkey, Date.now(), attribution);
          const wrap = await sealGuestbook(rumor, currentGuestbookGroup(community), user.signer);
          await Promise.allSettled(
            community.relays.map((url) => nostr.relay(url).event(wrap, { signal: AbortSignal.timeout(8000) })),
          );
        })().catch(() => undefined);
      }

      return { communityId: bundle.community_id, name: bundle.name };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["concord2", "direct-invites"] });
      queryClient.invalidateQueries({ queryKey: ["concord2", "list"] });
    },
  });
}

/** Decline a parked invite: tombstone the community so it stops re-nagging. */
export function useDeclineDirectInvite2() {
  const { mutateAsync: updateList } = useUpdateCommunityList2();
  const queryClient = useQueryClient();

  return useMutation<void, Error, { communityId: string }>({
    mutationFn: async ({ communityId }) => {
      await updateList({ type: "remove", communityId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["concord2", "direct-invites"] });
    },
  });
}
