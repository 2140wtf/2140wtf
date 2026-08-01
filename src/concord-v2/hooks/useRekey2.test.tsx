/**
 * Rotation handling at the hook level (CORD-05 §2/§4, CORD-06 §2/§3):
 *
 *   - `useRekeyWatch2`'s ADOPT branch re-posts the adopting member's OWN live
 *     links at the fresh keys — only each creator holds a link's `signer_sk`
 *     (CORD-05 §4), so the Refounder alone can't refresh everyone's — while a
 *     link revoked on one device is never resurrected by another device's
 *     stale-but-newer Invite List copy (tombstones win terminally).
 *
 *   - `useChannelRekeyWatch2` receives channel-scoped rotations (CORD-06 §2):
 *     adopts a fresh channel key from an authorized rotator, drops a channel
 *     it was removed from, and ignores an unauthorized rotator outright.
 *
 *   - `useRefound2` rotates every held Private Channel (CORD-06 §3), sealed
 *     under the PRIOR root, delivering blobs to the keep-set only, and vends
 *     the post-rotation keys through its list snapshot and bundle refresh.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { getConversationKey } from "nostr-tools/nip44";
import { decrypt as nip44Decrypt, encrypt as nip44Encrypt } from "nostr-tools/nip44";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { EventTemplate, NostrEvent } from "nostr-tools/pure";
import { describe, expect, it, vi } from "vitest";

import type { ReactNode } from "react";

import { mintCommunity } from "@/concord-v2/lib/community";
import { adminRole } from "@/concord-v2/lib/roles";
import {
  baseRekeyGroupKey,
  bytesToHex,
  channelRekeyGroupKey,
  epochKeyCommitment,
  random32,
} from "@/concord-v2/lib/derive";
import {
  mintLinkSigner,
  mintToken,
  parseBundleEvent,
  type InviteBundle,
} from "@/concord-v2/lib/invite";
import { KIND_INVITE_LIST, KIND_SEAL_ENCRYPTED } from "@/concord-v2/lib/kinds";
import {
  base64ToBytes,
  buildRekeyRumors,
  bytesToBase64,
  decodeWrappedKey,
  encodeWrappedKey,
  findBlob,
  groupRotations,
  myLocator,
  parseRekey,
  type RekeyBlob,
} from "@/concord-v2/lib/rekey";
import { openWrap, sealRumor, wrapSeal } from "@/concord-v2/lib/stream";
import type { CommunityListEntry, JoinMaterial } from "@/concord-v2/lib/communityList";
import type { CommunityV2, PrivateChannelKey } from "@/concord-v2/lib/types";

import { useChannelRekeyWatch2, useLinkRefreshWatch2, useRefound2, useRekeyWatch2 } from "./useRekey2";

import type { NUser } from "@nostrify/react/login";

// ── Module mocks ─────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  pool: undefined as unknown,
  user: undefined as unknown,
  folded: undefined as unknown,
  entry: undefined as unknown,
  updateList: undefined as unknown,
}));

vi.mock("@nostrify/react", () => ({
  useNostr: () => ({ nostr: h.pool }),
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: h.user }),
}));
vi.mock("@/concord-v2/hooks/useControlPlane2", () => ({
  useControlFold2: () => ({ data: h.folded }),
  useDissolved2: () => ({ data: undefined }),
  citationFor: () => undefined,
  invalidateControl2: () => undefined,
  publishEdition2: async () => undefined,
}));
vi.mock("@/concord-v2/hooks/useCommunityList2", () => ({
  useCommunityEntry2: () => h.entry,
  useUpdateCommunityList2: () => ({ mutateAsync: h.updateList }),
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

const RELAY = "wss://relay.test";

interface Filter {
  kinds?: number[];
  authors?: string[];
  since?: number;
  until?: number;
  limit?: number;
}

class FakeRelay {
  events: NostrEvent[] = [];
  published: NostrEvent[] = [];
  queries: Filter[] = [];

  async query(filters: Filter[]): Promise<NostrEvent[]> {
    this.queries.push(...filters);
    const out = new Map<string, NostrEvent>();
    for (const f of filters) {
      for (const ev of this.events) {
        const ok =
          (!f.kinds || f.kinds.includes(ev.kind)) &&
          (!f.authors || f.authors.includes(ev.pubkey)) &&
          (f.since === undefined || ev.created_at >= f.since) &&
          (f.until === undefined || ev.created_at <= f.until);
        if (ok) out.set(ev.id, ev);
      }
    }
    return [...out.values()].sort((a, b) => b.created_at - a.created_at).slice(0, filters[0]?.limit);
  }

  async event(ev: NostrEvent): Promise<void> {
    this.published.push(ev);
    this.events.push(ev);
  }
}

function member(sk = generateSecretKey()) {
  return {
    sk,
    pubkey: getPublicKey(sk),
    signEvent: async (t: EventTemplate) => finalizeEvent(t, sk),
    nip44encrypt: (counterparty: string, plaintext: string) =>
      nip44Encrypt(plaintext, getConversationKey(sk, counterparty)),
    nip44decrypt: (counterparty: string, ciphertext: string) =>
      nip44Decrypt(ciphertext, getConversationKey(sk, counterparty)),
  };
}

function asNUser(m: ReturnType<typeof member>): NUser {
  return {
    pubkey: m.pubkey,
    signer: {
      signEvent: m.signEvent,
      nip44: {
        encrypt: async (pk: string, pt: string) => m.nip44encrypt(pk, pt),
        decrypt: async (pk: string, ct: string) => m.nip44decrypt(pk, ct),
      },
    },
  } as unknown as NUser;
}

const nowSecs = () => Math.floor(Date.now() / 1000);

function jmOf(c: CommunityV2, ownerPk: string): JoinMaterial {
  return {
    community_id: c.idHex,
    owner: ownerPk,
    owner_salt: bytesToHex(c.ownerSalt),
    community_root: bytesToHex(c.root),
    root_epoch: Number(c.rootEpoch),
    channels: c.privateChannels.map((ch) => ({
      id: bytesToHex(ch.id),
      key: bytesToHex(ch.key),
      epoch: Number(ch.epoch),
      name: ch.name,
    })),
    relays: c.relays,
    name: c.name,
  };
}

/** A complete, authorized, continuity-valid base rotation to the next epoch. */
async function rotationWraps(
  rotator: ReturnType<typeof member>,
  c: CommunityV2, // at the PRIOR epoch
  newRoot: Uint8Array,
  recipients: string[],
  publishMs: number,
): Promise<NostrEvent[]> {
  const newEpoch = c.rootEpoch + 1n;
  const address = baseRekeyGroupKey(c.root, c.id, newEpoch);
  const prevCommit = bytesToHex(epochKeyCommitment(c.rootEpoch, c.root));
  const plain = bytesToBase64(encodeWrappedKey(new Uint8Array(32), newEpoch, newRoot));
  const blobs: RekeyBlob[] = recipients.map((pk) => ({
    locator: myLocator(rotator.pubkey, pk, "0".repeat(64), newEpoch),
    wrapped: rotator.nip44encrypt(pk, plain),
  }));
  const wraps: NostrEvent[] = [];
  for (const rumor of buildRekeyRumors(
    rotator.pubkey,
    { scope: { kind: "root" }, newEpoch, prevEpoch: c.rootEpoch, prevCommit },
    blobs,
    publishMs,
  )) {
    wraps.push(wrapSeal(await sealRumor(rumor, KIND_SEAL_ENCRYPTED, address, rotator), address));
  }
  return wraps;
}

function foldedFor(ownerPk: string, icon?: InviteBundle["icon"], creatorPk?: string) {
  // Optionally grant a non-owner CREATE_INVITE (an admin role), so a link
  // creator's own bundle refresh is authorized — the honest-client gate on
  // useLinkRefreshWatch2 requires positive authority, not mere link possession.
  const roleId = "aa".repeat(32);
  const roster = creatorPk
    ? { roles: [adminRole(roleId)], grants: [{ member: creatorPk, roleIds: [roleId] }] }
    : { roles: [], grants: [] };
  return {
    ownerHex: ownerPk,
    banned: new Set<string>(),
    roster,
    metadata: { name: "Fleet", relays: [], ...(icon ? { icon } : {}) },
    headEditions: new Map(),
  } as unknown;
}

/** A complete channel-scoped rotation (CORD-06 §2/§3), sealed under `root`. */
async function channelRotationWraps(
  rotator: ReturnType<typeof member>,
  root: Uint8Array, // the community_root the rekey is sealed under (the PRIOR one for a Refounding)
  ch: Pick<PrivateChannelKey, "id" | "key" | "epoch">,
  newKey: Uint8Array,
  recipients: string[],
  publishMs: number,
): Promise<NostrEvent[]> {
  const chNext = ch.epoch + 1n;
  const address = channelRekeyGroupKey(root, ch.id, chNext);
  const chIdHex = bytesToHex(ch.id);
  const plain = bytesToBase64(encodeWrappedKey(ch.id, chNext, newKey));
  const blobs: RekeyBlob[] = recipients.map((pk) => ({
    locator: myLocator(rotator.pubkey, pk, chIdHex, chNext),
    wrapped: rotator.nip44encrypt(pk, plain),
  }));
  const wraps: NostrEvent[] = [];
  for (const rumor of buildRekeyRumors(
    rotator.pubkey,
    {
      scope: { kind: "channel", channelId: ch.id },
      newEpoch: chNext,
      prevEpoch: ch.epoch,
      prevCommit: bytesToHex(epochKeyCommitment(ch.epoch, ch.key)),
    },
    blobs,
    publishMs,
  )) {
    wraps.push(wrapSeal(await sealRumor(rumor, KIND_SEAL_ENCRYPTED, address, rotator), address));
  }
  return wraps;
}

function makeWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

// ── useRekeyWatch2: creator-side bundle refresh on adoption ─────────────────

describe("useRekeyWatch2 (CORD-05 §2 / CORD-06 §2)", () => {
  it(
    "adopting a rotation re-posts the member's OWN live links at the fresh keys — never a revoked one",
    { timeout: 30_000 },
    async () => {
      const owner = member();
      const me = member(); // a link-creating member, NOT the Refounder
      const { community } = mintCommunity("Fleet", owner.pubkey, [RELAY]);
      const newRoot = random32();
      const wraps = await rotationWraps(owner, community, newRoot, [owner.pubkey, me.pubkey], Date.now());

      // My Invite List, two device copies: device 1 revoked link B (tombstone,
      // older copy); device 2 — offline since before the revocation — wrote a
      // NEWER copy still listing B live. The refresh must post A and never B
      // (tombstones union and win terminally, CORD-05 §4).
      const linkA = mintLinkSigner();
      const linkB = mintLinkSigner();
      const tokenA = mintToken();
      const tokenB = mintToken();
      const listEntry = (token: Uint8Array, link: { sk: Uint8Array }) => ({
        token: bytesToHex(token),
        signer_sk: bytesToHex(link.sk),
        community_id: community.idHex,
        url: "",
        created_at: 1,
      });
      const listCopy = (list: object, createdAt: number) =>
        finalizeEvent(
          {
            kind: KIND_INVITE_LIST,
            content: nip44Encrypt(JSON.stringify(list), getConversationKey(me.sk, me.pubkey)),
            tags: [],
            created_at: createdAt,
          },
          me.sk,
        );
      const older = listCopy(
        { entries: [listEntry(tokenA, linkA)], tombstones: [{ token: bytesToHex(tokenB), community_id: community.idHex }] },
        nowSecs() - 100,
      );
      const newer = listCopy(
        { entries: [listEntry(tokenA, linkA), listEntry(tokenB, linkB)], tombstones: [] },
        nowSecs() - 50,
      );

      const relay = new FakeRelay();
      relay.events = [...wraps];
      h.pool = {
        relay: () => relay,
        query: async (filters: Filter[]) =>
          filters.some((f) => f.kinds?.includes(KIND_INVITE_LIST)) ? [newer, older] : [],
      };
      h.user = asNUser(me);
      const icon = { url: "https://cdn.example/icon.png", key: "6b".repeat(32), nonce: "6e".repeat(16), hash: "68".repeat(32) };
      h.folded = foldedFor(owner.pubkey, icon);
      h.updateList = vi.fn(async () => {});
      const jm = jmOf(community, owner.pubkey);
      h.entry = { community_id: community.idHex, seed: jm, current: jm, added_at: 1 } satisfies CommunityListEntry;

      const { wrapper } = makeWrapper();
      renderHook(() => useRekeyWatch2(community), { wrapper });

      // My blob is in the rotation: I adopt the new epoch…
      await waitFor(
        () =>
          expect(h.updateList).toHaveBeenCalledWith(
            expect.objectContaining({
              type: "refresh-current",
              current: expect.objectContaining({ root_epoch: 1, community_root: bytesToHex(newRoot) }),
            }),
          ),
        { timeout: 10_000 },
      );

      // …and my live link's coordinate receives the refreshed bundle vending
      // the CURRENT keys — with the community icon intact (a refresh must not
      // degrade the link preview).
      await waitFor(() => expect(relay.published.some((e) => e.pubkey === linkA.pk)).toBe(true), {
        timeout: 10_000,
      });
      const refreshed = relay.published.find((e) => e.pubkey === linkA.pk)!;
      const vended = parseBundleEvent(refreshed, linkA.pk, tokenA, Date.now());
      expect(vended.root_epoch).toBe(1);
      expect(vended.community_root).toBe(bytesToHex(newRoot));
      expect(vended.icon).toEqual(icon);

      // The revoked link stays dead even though the NEWEST list copy carried
      // it live — a stale device can never resurrect a revoked link.
      await new Promise((r) => setTimeout(r, 150));
      expect(relay.published.some((e) => e.pubkey === linkB.pk)).toBe(false);
    },
  );
});

// ── useRekeyWatch2: stranded-joiner detection (CORD-05 §2 / CORD-06 §2) ──────

describe("useRekeyWatch2 stranded detection", () => {
  it(
    "a rotation PAST my epoch that predates my join and holds no blob for me marks me stranded",
    { timeout: 30_000 },
    async () => {
      const owner = member();
      const me = member();
      const { community } = mintCommunity("Fleet", owner.pubkey, [RELAY]);
      // A complete `0→1` rotation carrying a blob ONLY for the owner, published
      // LONG before I joined — I landed on epoch 0 via a stale link. It advances
      // past the epoch I hold (0), so I'm stranded, not excluded.
      const staleMs = Date.now() - 60 * 60_000;
      const wraps = await rotationWraps(owner, community, random32(), [owner.pubkey], staleMs);

      const relay = new FakeRelay();
      relay.events = [...wraps];
      h.pool = { relay: () => relay, query: async () => [] };
      h.user = asNUser(me);
      h.folded = foldedFor(owner.pubkey);
      h.updateList = vi.fn(async () => {});
      const jm = jmOf(community, owner.pubkey);
      // I joined AFTER the rotation was published (stale-invite drop).
      h.entry = { community_id: community.idHex, seed: jm, current: jm, added_at: Date.now() } satisfies CommunityListEntry;

      const { wrapper } = makeWrapper();
      const { result } = renderHook(() => useRekeyWatch2(community), { wrapper });

      await waitFor(() => expect(result.current.stranded).toBe(true), { timeout: 10_000 });
      // Stranding is NOT exclusion: the entry is never marked excluded/removed.
      expect(h.updateList).not.toHaveBeenCalledWith(expect.objectContaining({ type: "exclude" }));
    },
  );
});

// ── useRekeyWatch2: exclusion → re-inclusion convergence (CORD-06 §2) ───────

describe("useRekeyWatch2 exclusion → re-inclusion convergence", () => {
  it(
    "a same-epoch re-including rotation arriving AFTER an exclusion is still adopted (racing Refoundings converge)",
    { timeout: 30_000 },
    async () => {
      const owner = member(); // rotator A: refounds WITHOUT me
      const admin = member(); // rotator B: racing Refounding that re-includes me (holds BAN)
      const me = member();
      const { community } = mintCommunity("Fleet", owner.pubkey, [RELAY]);
      // A's rotation: 0→1, no blob for me, published after I joined → exclusion.
      const wrapsA = await rotationWraps(owner, community, random32(), [owner.pubkey, admin.pubkey], Date.now());

      const relay = new FakeRelay();
      relay.events = [...wrapsA];
      h.pool = { relay: () => relay, query: async () => [] };
      h.user = asNUser(me);
      h.folded = foldedFor(owner.pubkey, undefined, admin.pubkey); // admin holds an admin role (BAN)
      h.updateList = vi.fn(async () => {});
      const jm = jmOf(community, owner.pubkey);
      h.entry = { community_id: community.idHex, seed: jm, current: jm, added_at: 1 } satisfies CommunityListEntry;

      const { queryClient, wrapper } = makeWrapper();
      renderHook(() => useRekeyWatch2(community), { wrapper });

      // The exclusion is marked…
      await waitFor(
        () =>
          expect(h.updateList).toHaveBeenCalledWith(
            expect.objectContaining({ type: "exclude", communityId: community.idHex, epoch: 1 }),
          ),
        { timeout: 10_000 },
      );

      // …then the racing Refounding that RE-INCLUDES me lands — same epoch, a
      // later poll. The watcher must still adopt it: refreshCurrent is what
      // clears the spent exclusion marker (communityList.ts).
      const rootB = random32();
      const wrapsB = await rotationWraps(admin, community, rootB, [owner.pubkey, admin.pubkey, me.pubkey], Date.now());
      relay.events.push(...wrapsB);
      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: ["concord2", "rekey"] });
      });

      await waitFor(
        () =>
          expect(h.updateList).toHaveBeenCalledWith(
            expect.objectContaining({
              type: "refresh-current",
              current: expect.objectContaining({ root_epoch: 1, community_root: bytesToHex(rootB) }),
            }),
          ),
        { timeout: 10_000 },
      );
    },
  );
});

// ── useLinkRefreshWatch2: creator-side stale-link roll-forward (CORD-05 §2) ──

describe("useLinkRefreshWatch2", () => {
  it(
    "a creator opening a community re-posts their live links at the current epoch",
    { timeout: 30_000 },
    async () => {
      const owner = member();
      const me = member(); // holds a live link, opened the community on a fresh device
      // The community is ALREADY on epoch 2 locally (e.g. rotated on another
      // device): the bundle the link vends must catch up to it.
      const { community: base } = mintCommunity("Fleet", owner.pubkey, [RELAY]);
      const rotatedRoot = random32();
      const community: CommunityV2 = { ...base, root: rotatedRoot, rootEpoch: 2n };

      const link = mintLinkSigner();
      const token = mintToken();
      const listEvent = finalizeEvent(
        {
          kind: KIND_INVITE_LIST,
          content: nip44Encrypt(
            JSON.stringify({
              entries: [
                { token: bytesToHex(token), signer_sk: bytesToHex(link.sk), community_id: community.idHex, url: "", created_at: 1 },
              ],
              tombstones: [],
            }),
            getConversationKey(me.sk, me.pubkey),
          ),
          tags: [],
          created_at: nowSecs() - 10,
        },
        me.sk,
      );

      const relay = new FakeRelay();
      h.pool = {
        relay: () => relay,
        query: async (filters: Filter[]) =>
          filters.some((f) => f.kinds?.includes(KIND_INVITE_LIST)) ? [listEvent] : [],
      };
      h.user = asNUser(me);
      h.folded = foldedFor(owner.pubkey, undefined, me.pubkey); // me holds CREATE_INVITE

      const { wrapper } = makeWrapper();
      renderHook(() => useLinkRefreshWatch2(community), { wrapper });

      await waitFor(() => expect(relay.published.some((e) => e.pubkey === link.pk)).toBe(true), {
        timeout: 10_000,
      });
      const refreshed = relay.published.find((e) => e.pubkey === link.pk)!;
      const vended = parseBundleEvent(refreshed, link.pk, token, Date.now());
      // The link now vends the CURRENT epoch (2) and the rotated root — not the
      // dead epoch it was minted at.
      expect(vended.root_epoch).toBe(2);
      expect(vended.community_root).toBe(bytesToHex(rotatedRoot));
    },
  );
});

// ── useChannelRekeyWatch2: per-channel adoption + removal (CORD-06 §2) ───────

describe("useChannelRekeyWatch2 (CORD-06 §2 channel rotations)", () => {
  function setupChannel() {
    const owner = member();
    const me = member();
    const { community: base } = mintCommunity("Fleet", owner.pubkey, [RELAY]);
    const ch: PrivateChannelKey = { id: random32(), key: random32(), epoch: 0n, name: "sec" };
    const community: CommunityV2 = { ...base, privateChannels: [ch] };
    return { owner, me, community, ch };
  }

  it(
    "adopts a channel rotation carrying my blob: the channel moves to the fresh key at the next epoch",
    { timeout: 30_000 },
    async () => {
      const { owner, me, community, ch } = setupChannel();
      const newChKey = random32();
      const wraps = await channelRotationWraps(owner, community.root, ch, newChKey, [owner.pubkey, me.pubkey], Date.now());

      const relay = new FakeRelay();
      relay.events = [...wraps];
      h.pool = { relay: () => relay, query: async () => [] };
      h.user = asNUser(me);
      h.folded = foldedFor(owner.pubkey);
      h.updateList = vi.fn(async () => {});
      const jm = jmOf(community, owner.pubkey);
      h.entry = { community_id: community.idHex, seed: jm, current: jm, added_at: 1 } satisfies CommunityListEntry;

      const { wrapper } = makeWrapper();
      renderHook(() => useChannelRekeyWatch2(community), { wrapper });

      await waitFor(
        () =>
          expect(h.updateList).toHaveBeenCalledWith(
            expect.objectContaining({
              type: "refresh-channels",
              communityId: community.idHex,
              channels: [
                expect.objectContaining({
                  id: bytesToHex(ch.id),
                  key: bytesToHex(newChKey),
                  epoch: 1,
                  name: "sec",
                }),
              ],
            }),
          ),
        { timeout: 10_000 },
      );
    },
  );

  it(
    "a complete channel rotation with NO blob for me (at/after my join) removes the channel from current",
    { timeout: 30_000 },
    async () => {
      const { owner, me, community, ch } = setupChannel();
      // Rotated AWAY from me: blob for the owner only, published after I joined.
      const wraps = await channelRotationWraps(owner, community.root, ch, random32(), [owner.pubkey], Date.now());

      const relay = new FakeRelay();
      relay.events = [...wraps];
      h.pool = { relay: () => relay, query: async () => [] };
      h.user = asNUser(me);
      h.folded = foldedFor(owner.pubkey);
      h.updateList = vi.fn(async () => {});
      const jm = jmOf(community, owner.pubkey);
      h.entry = { community_id: community.idHex, seed: jm, current: jm, added_at: 1 } satisfies CommunityListEntry;

      const { wrapper } = makeWrapper();
      renderHook(() => useChannelRekeyWatch2(community), { wrapper });

      // Visible removal (§2): the channel drops out of `current`; `seed`
      // retains the original key (refreshChannels never touches it).
      await waitFor(
        () =>
          expect(h.updateList).toHaveBeenCalledWith(
            expect.objectContaining({
              type: "refresh-channels",
              communityId: community.idHex,
              channels: [],
            }),
          ),
        { timeout: 10_000 },
      );
    },
  );

  it(
    "a failed refresh-channels publish rolls the handled marks back so the next rotation data retries",
    { timeout: 30_000 },
    async () => {
      const { owner, me, community, ch } = setupChannel();
      const key1 = random32();
      const wraps1 = await channelRotationWraps(owner, community.root, ch, key1, [owner.pubkey, me.pubkey], Date.now());

      const relay = new FakeRelay();
      relay.events = [...wraps1];
      h.pool = { relay: () => relay, query: async () => [] };
      h.user = asNUser(me);
      h.folded = foldedFor(owner.pubkey);
      // The FIRST publish fails (transient); the retry must happen and succeed.
      h.updateList = vi.fn().mockRejectedValueOnce(new Error("relay down")).mockResolvedValue(undefined);
      const jm = jmOf(community, owner.pubkey);
      h.entry = { community_id: community.idHex, seed: jm, current: jm, added_at: 1 } satisfies CommunityListEntry;

      const { queryClient, wrapper } = makeWrapper();
      renderHook(() => useChannelRekeyWatch2(community), { wrapper });

      await waitFor(() => expect(h.updateList).toHaveBeenCalledTimes(1), { timeout: 10_000 });

      // New rotation data arrives (a racing second rotation for the same
      // channel epoch): the failed adoption must be retried — converging on
      // the lower of the two keys.
      const key2 = random32();
      const wraps2 = await channelRotationWraps(owner, community.root, ch, key2, [owner.pubkey, me.pubkey], Date.now());
      relay.events.push(...wraps2);
      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: ["concord2", "chrekey"] });
      });

      const expectedHex = [bytesToHex(key1), bytesToHex(key2)].sort()[0];
      await waitFor(
        () =>
          expect(h.updateList).toHaveBeenCalledWith(
            expect.objectContaining({
              type: "refresh-channels",
              communityId: community.idHex,
              channels: [expect.objectContaining({ id: bytesToHex(ch.id), key: expectedHex, epoch: 1 })],
            }),
          ),
        { timeout: 10_000 },
      );
    },
  );

  it(
    "an unauthorized rotator's channel rotation is ignored (key possession is never authority)",
    { timeout: 30_000 },
    async () => {
      const { owner, me, community, ch } = setupChannel();
      const mallory = member(); // holds the channel key, holds NO role
      const wraps = await channelRotationWraps(mallory, community.root, ch, random32(), [mallory.pubkey, me.pubkey], Date.now());

      const relay = new FakeRelay();
      relay.events = [...wraps];
      h.pool = { relay: () => relay, query: async () => [] };
      h.user = asNUser(me);
      h.folded = foldedFor(owner.pubkey); // mallory is neither owner nor BAN/MANAGE_CHANNELS holder
      h.updateList = vi.fn(async () => {});
      const jm = jmOf(community, owner.pubkey);
      h.entry = { community_id: community.idHex, seed: jm, current: jm, added_at: 1 } satisfies CommunityListEntry;

      const { wrapper } = makeWrapper();
      renderHook(() => useChannelRekeyWatch2(community), { wrapper });

      // Give the (unwanted) adoption a chance to fire.
      await waitFor(
        () => expect(relay.queries.some((f) => f.kinds?.includes(1059))).toBe(true),
        { timeout: 10_000 },
      );
      await new Promise((r) => setTimeout(r, 200));
      expect(h.updateList).not.toHaveBeenCalled();
    },
  );
});

// ── useRefound2: the Refounding rotates held Private Channels (CORD-06 §3) ──

describe("useRefound2 (CORD-06 §3 channel rotations)", () => {
  it(
    "a Refounding rekeys every held private channel under the PRIOR root and vends the fresh keys onward",
    { timeout: 30_000 },
    async () => {
      const owner = member();
      const alice = member();
      const mallory = member(); // the banned target
      const { community: base } = mintCommunity("Fleet", owner.pubkey, [RELAY]);
      const ch: PrivateChannelKey = { id: random32(), key: random32(), epoch: 0n, name: "sec" };
      const community: CommunityV2 = { ...base, privateChannels: [ch] };
      const priorRoot = community.root;

      // The refounder owns one live invite link (for the step-3b refresh).
      const link = mintLinkSigner();
      const token = mintToken();
      const listEvent = finalizeEvent(
        {
          kind: KIND_INVITE_LIST,
          content: nip44Encrypt(
            JSON.stringify({
              entries: [
                {
                  token: bytesToHex(token),
                  signer_sk: bytesToHex(link.sk),
                  community_id: community.idHex,
                  url: "",
                  created_at: 1,
                },
              ],
              tombstones: [],
            }),
            getConversationKey(owner.sk, owner.pubkey),
          ),
          tags: [],
          created_at: nowSecs() - 10,
        },
        owner.sk,
      );

      const relay = new FakeRelay();
      h.pool = {
        relay: () => relay,
        query: async (filters: Filter[]) =>
          filters.some((f) => f.kinds?.includes(KIND_INVITE_LIST)) ? [listEvent] : [],
      };
      h.user = asNUser(owner);
      h.folded = foldedFor(owner.pubkey);
      h.updateList = vi.fn(async () => {});
      const jm = jmOf(community, owner.pubkey);
      h.entry = { community_id: community.idHex, seed: jm, current: jm, added_at: 1 } satisfies CommunityListEntry;

      const { wrapper } = makeWrapper();
      const { result } = renderHook(() => useRefound2(community), { wrapper });
      await act(async () => {
        await result.current.refound({ keep: [alice.pubkey], exclude: [mallory.pubkey] });
      });

      // A channel-scoped rotation was published at the channel's next-epoch
      // address, derived from the PRIOR community_root (CORD-06 §3: sealed
      // under the prior root so a base-race loser can still open it).
      const chAddress = channelRekeyGroupKey(priorRoot, ch.id, 1n);
      const chWraps = relay.published.filter((e) => e.pubkey === chAddress.pk);
      expect(chWraps.length).toBeGreaterThan(0);
      const sets = groupRotations(chWraps.map((w) => parseRekey(openWrap(w, chAddress))));
      expect(sets.length).toBe(1);
      const rotation = sets[0];
      expect(rotation.complete).toBe(true);
      expect(rotation.scopeIdHex).toBe(bytesToHex(ch.id));
      expect(rotation.prevCommit).toBe(bytesToHex(epochKeyCommitment(0n, ch.key)));

      // Alice's blob decodes to the fresh channel key — scope-bound inside the
      // ciphertext, so it can never be spliced onto another channel.
      const aliceBlob = findBlob(rotation, myLocator(owner.pubkey, alice.pubkey, bytesToHex(ch.id), 1n))!;
      expect(aliceBlob).toBeDefined();
      const newChKey = decodeWrappedKey(
        base64ToBytes(alice.nip44decrypt(owner.pubkey, aliceBlob.wrapped)),
        ch.id,
        1n,
      );

      // Mallory — the severed member — has NO blob in the rotation.
      expect(findBlob(rotation, myLocator(owner.pubkey, mallory.pubkey, bytesToHex(ch.id), 1n))).toBeUndefined();

      // The refounder's own list snapshot carries the rotated channel…
      expect(h.updateList).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "refresh-current",
          current: expect.objectContaining({
            root_epoch: 1,
            channels: [
              expect.objectContaining({ id: bytesToHex(ch.id), key: bytesToHex(newChKey), epoch: 1 }),
            ],
          }),
        }),
      );

      // …and the refreshed invite bundle vends the POST-rotation channel key,
      // never the severed one (a fresh joiner must not receive keys a
      // Refounding just retired).
      const refreshed = relay.published.filter((e) => e.pubkey === link.pk).at(-1)!;
      expect(refreshed).toBeDefined();
      const vended = parseBundleEvent(refreshed, link.pk, token, Date.now());
      expect(vended.root_epoch).toBe(1);
      expect(vended.channels).toEqual([
        { id: bytesToHex(ch.id), key: bytesToHex(newChKey), epoch: 1, name: "sec" },
      ]);
    },
  );
});
