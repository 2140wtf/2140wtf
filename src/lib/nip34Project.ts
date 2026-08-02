import type { NostrEvent } from "@nostrify/nostrify";
import { nip19 } from "nostr-tools";
import { verifyEvent } from "nostr-tools/pure";

import { capRelays, utf8Len } from "@/concord-v2/lib/types";
import { isNostrId } from "@/lib/nostrId";

export const NIP34_REPOSITORY_KIND = 30617;
export const NIP34_REPOSITORY_STATE_KIND = 30618;
export const NIP34_PATCH_KIND = 1617;
export const NIP34_PULL_REQUEST_KIND = 1618;
export const NIP34_PULL_REQUEST_UPDATE_KIND = 1619;
export const NIP34_ISSUE_KIND = 1621;
export const NIP34_STATUS_KINDS = [1630, 1631, 1632, 1633] as const;

const MAX_REPO_IDENTIFIER_BYTES = 256;
export const MAX_REPO_NADDR_BYTES = 2048;
export const MAX_REPOSITORY_MAINTAINERS = 100;

export interface Nip34RepoPointer {
  owner: string;
  identifier: string;
  relays: string[];
  coordinate: string;
  naddr: string;
}

export interface Nip34Artifact {
  event: NostrEvent;
  kind: typeof NIP34_PATCH_KIND | typeof NIP34_PULL_REQUEST_KIND | typeof NIP34_ISSUE_KIND;
  subject: string;
  labels: string[];
  /** Issues/PRs and root patches can carry an authoritative NIP-34 status. */
  statusRoot: boolean;
}

export interface Nip34Status {
  event: NostrEvent;
  targetId: string;
  status: "open" | "applied" | "closed" | "draft";
}

function singleTag(event: NostrEvent, name: string): string | undefined {
  const values = event.tags.filter(([tag]) => tag === name);
  return values.length === 1 ? values[0][1] : undefined;
}

/** Decode and canonicalize an addressable NIP-34 repository pointer. */
export function parseRepoNaddr(raw: unknown): Nip34RepoPointer | undefined {
  if (typeof raw !== "string" || utf8Len(raw) > MAX_REPO_NADDR_BYTES) return undefined;
  const value = raw.trim();
  if (!value) return undefined;
  try {
    const decoded = nip19.decode(value);
    if (decoded.type !== "naddr" || decoded.data.kind !== NIP34_REPOSITORY_KIND) return undefined;
    const owner = decoded.data.pubkey.toLowerCase();
    const identifier = decoded.data.identifier;
    if (!isNostrId(owner) || !identifier || utf8Len(identifier) > MAX_REPO_IDENTIFIER_BYTES) return undefined;
    const relays = capRelays(decoded.data.relays ?? []);
    return {
      owner,
      identifier,
      relays,
      coordinate: `${NIP34_REPOSITORY_KIND}:${owner}:${identifier}`,
      naddr: nip19.naddrEncode({ kind: NIP34_REPOSITORY_KIND, pubkey: owner, identifier, relays }),
    };
  } catch {
    return undefined;
  }
}

/** Strictly validate the repository announcement named by a trusted pointer. */
export function parseRepositoryEvent(event: NostrEvent, pointer: Nip34RepoPointer): NostrEvent | undefined {
  if (
    event.kind !== NIP34_REPOSITORY_KIND ||
    event.pubkey !== pointer.owner ||
    singleTag(event, "d") !== pointer.identifier ||
    !verifyEvent(event)
  ) return undefined;
  return event;
}

/** NIP-34 uses one `maintainers` tag whose remaining values are pubkeys. */
export function repositoryMaintainers(event: NostrEvent, pointer: Nip34RepoPointer): Set<string> {
  const maintainers = new Set<string>([pointer.owner]);
  for (const tag of event.tags.filter(([name]) => name === "maintainers")) {
    for (const pubkey of tag.slice(1)) {
      if (maintainers.size >= MAX_REPOSITORY_MAINTAINERS) return maintainers;
      if (isNostrId(pubkey)) maintainers.add(pubkey.toLowerCase());
    }
  }
  return maintainers;
}

/** Artifact relays declared by the repository announcement. */
export function repositoryRelays(event: NostrEvent): string[] {
  return capRelays(event.tags.filter(([name]) => name === "relays").flatMap((tag) => tag.slice(1)));
}

export function parseProjectArtifact(event: NostrEvent, pointer: Nip34RepoPointer): Nip34Artifact | undefined {
  if (![NIP34_PATCH_KIND, NIP34_PULL_REQUEST_KIND, NIP34_ISSUE_KIND].includes(event.kind) || !verifyEvent(event)) {
    return undefined;
  }
  const repoTags = event.tags.filter(([name]) => name === "a");
  if (repoTags.length !== 1 || repoTags[0][1] !== pointer.coordinate) return undefined;
  const subject = event.tags.find(([name]) => name === "subject")?.[1]?.trim() ||
    (event.kind === NIP34_ISSUE_KIND ? "Untitled issue" : event.kind === NIP34_PULL_REQUEST_KIND ? "Pull request" : "Patch");
  return {
    event,
    kind: event.kind as Nip34Artifact["kind"],
    subject,
    labels: event.tags.filter(([name, value]) => name === "t" && !!value).map(([, value]) => value),
    statusRoot: event.kind !== NIP34_PATCH_KIND || event.tags.some(([name, value]) => name === "t" && value === "root"),
  };
}

export function parseRepositoryState(
  event: NostrEvent,
  pointer: Nip34RepoPointer,
  maintainers: ReadonlySet<string>,
): NostrEvent | undefined {
  if (event.kind !== NIP34_REPOSITORY_STATE_KIND || !maintainers.has(event.pubkey) ||
    singleTag(event, "d") !== pointer.identifier || !verifyEvent(event)) return undefined;
  return event;
}

export function parsePullRequestUpdate(
  event: NostrEvent,
  pointer: Nip34RepoPointer,
  artifacts: ReadonlyMap<string, Nip34Artifact>,
): NostrEvent | undefined {
  if (event.kind !== NIP34_PULL_REQUEST_UPDATE_KIND || !verifyEvent(event)) return undefined;
  const repoTags = event.tags.filter(([name]) => name === "a");
  const roots = event.tags.filter(([name, id]) => name === "E" && isNostrId(id));
  if (repoTags.length !== 1 || repoTags[0][1] !== pointer.coordinate || roots.length !== 1) return undefined;
  const target = artifacts.get(roots[0][1]);
  const rootAuthors = event.tags.filter(([name, pubkey]) => name === "P" && isNostrId(pubkey));
  return target?.kind === NIP34_PULL_REQUEST_KIND && event.pubkey === target.event.pubkey &&
    rootAuthors.length === 1 && rootAuthors[0][1] === target.event.pubkey ? event : undefined;
}

const STATUS_NAMES: Record<number, Nip34Status["status"]> = {
  1630: "open",
  1631: "applied",
  1632: "closed",
  1633: "draft",
};

/** Accept only a status rooted in one loaded artifact and signed by an
 * authority NIP-34 recognizes: its author or a declared maintainer. */
export function parseAuthoritativeStatus(
  event: NostrEvent,
  artifacts: ReadonlyMap<string, Nip34Artifact>,
  maintainers: ReadonlySet<string>,
): Nip34Status | undefined {
  if (!NIP34_STATUS_KINDS.includes(event.kind as (typeof NIP34_STATUS_KINDS)[number]) || !verifyEvent(event)) return undefined;
  const roots = event.tags.filter(([name, id, , marker]) => name === "e" && marker === "root" && isNostrId(id));
  if (roots.length !== 1) return undefined;
  const targetId = roots[0][1].toLowerCase();
  const target = artifacts.get(targetId);
  if (!target?.statusRoot || (!maintainers.has(event.pubkey) && event.pubkey !== target.event.pubkey)) return undefined;
  return { event, targetId, status: STATUS_NAMES[event.kind] };
}

/** Latest valid status per artifact; event id breaks equal-time relay order. */
export function latestProjectStatuses(statuses: Nip34Status[]): Map<string, Nip34Status> {
  const latest = new Map<string, Nip34Status>();
  for (const status of statuses) {
    const prior = latest.get(status.targetId);
    if (!prior || status.event.created_at > prior.event.created_at ||
      (status.event.created_at === prior.event.created_at && status.event.id > prior.event.id)) {
      latest.set(status.targetId, status);
    }
  }
  return latest;
}
