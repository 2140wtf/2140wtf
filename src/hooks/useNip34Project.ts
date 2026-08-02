import { useNostr } from "@nostrify/react";
import type { NostrEvent } from "@nostrify/nostrify";
import { useQuery } from "@tanstack/react-query";

import {
  NIP34_ISSUE_KIND,
  NIP34_PATCH_KIND,
  NIP34_PULL_REQUEST_KIND,
  NIP34_PULL_REQUEST_UPDATE_KIND,
  NIP34_REPOSITORY_KIND,
  NIP34_REPOSITORY_STATE_KIND,
  NIP34_STATUS_KINDS,
  latestProjectStatuses,
  parseAuthoritativeStatus,
  parseProjectArtifact,
  parsePullRequestUpdate,
  parseRepoNaddr,
  parseRepositoryEvent,
  parseRepositoryState,
  repositoryMaintainers,
  repositoryRelays,
  type Nip34Artifact,
  type Nip34RepoPointer,
  type Nip34Status,
} from "@/lib/nip34Project";

export interface Nip34Project {
  pointer: Nip34RepoPointer;
  repository: NostrEvent;
  repositoryStates: NostrEvent[];
  maintainers: Set<string>;
  artifactRelays: string[];
  issues: Nip34Artifact[];
  patches: Nip34Artifact[];
  pullRequests: Nip34Artifact[];
  pullRequestUpdates: NostrEvent[];
  activity: Array<Nip34Artifact | { event: NostrEvent; kind: "pr-update" } | Nip34Status>;
  statusByArtifact: Map<string, Nip34Status>;
  warnings: string[];
}

function newestFirst(a: { event: NostrEvent }, b: { event: NostrEvent }): number {
  return b.event.created_at - a.event.created_at || b.event.id.localeCompare(a.event.id);
}

/** Public NIP-34 project data for one canonical repository coordinate. */
export function useNip34Project(repoNaddr: string | undefined) {
  const { nostr } = useNostr();
  const pointer = parseRepoNaddr(repoNaddr);

  return useQuery({
    queryKey: ["nip34-project", pointer?.coordinate ?? null, ...(pointer?.relays ?? []).slice().sort()],
    enabled: !!pointer,
    queryFn: async ({ signal }): Promise<Nip34Project> => {
      const p = pointer!;
      const discovery = p.relays.length > 0 ? nostr.group(p.relays) : nostr;
      const repoEvents = await discovery.query([{
        kinds: [NIP34_REPOSITORY_KIND],
        authors: [p.owner],
        "#d": [p.identifier],
        limit: 1,
      }], { signal });
      const warnings: string[] = [];
      const repository = repoEvents.map((event) => parseRepositoryEvent(event, p)).filter((event): event is NostrEvent => !!event)
        .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))[0];
      if (!repository) throw new Error("The NIP-34 repository announcement was not found or failed validation.");

      const maintainers = repositoryMaintainers(repository, p);
      const artifactRelays = repositoryRelays(repository);
      const artifactSource = artifactRelays.length > 0 ? nostr.group(artifactRelays) : discovery;
      const artifactEvents = await artifactSource.query([
        {
          kinds: [NIP34_REPOSITORY_STATE_KIND],
          authors: [...maintainers],
          "#d": [p.identifier],
          limit: Math.max(1, maintainers.size),
        },
        {
          kinds: [NIP34_PATCH_KIND, NIP34_PULL_REQUEST_KIND, NIP34_PULL_REQUEST_UPDATE_KIND, NIP34_ISSUE_KIND],
          "#a": [p.coordinate],
          limit: 300,
        },
      ], { signal });

      const stateCandidates = artifactEvents
        .map((event) => parseRepositoryState(event, p, maintainers))
        .filter((event): event is NostrEvent => !!event)
        .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id));
      const statesByAuthor = new Map<string, NostrEvent>();
      for (const state of stateCandidates) if (!statesByAuthor.has(state.pubkey)) statesByAuthor.set(state.pubkey, state);
      const repositoryStates = [...statesByAuthor.values()];
      const artifacts = artifactEvents
        .map((event) => parseProjectArtifact(event, p))
        .filter((artifact): artifact is Nip34Artifact => !!artifact);
      const artifactsById = new Map(artifacts.map((artifact) => [artifact.event.id, artifact]));
      const pullRequestUpdates = artifactEvents
        .map((event) => parsePullRequestUpdate(event, p, artifactsById))
        .filter((event): event is NostrEvent => !!event);

      const ids = artifacts.filter((artifact) => artifact.statusRoot).map((artifact) => artifact.event.id);
      const statusAuthors = [...new Set([...maintainers, ...artifacts.filter((artifact) => artifact.statusRoot).map((artifact) => artifact.event.pubkey)])];
      const statusFilters: Array<{ kinds: number[]; authors: string[]; "#e": string[]; limit: number }> = [];
      for (let index = 0; index < ids.length; index += 100) {
        statusFilters.push({
          kinds: [...NIP34_STATUS_KINDS],
          authors: statusAuthors,
          "#e": ids.slice(index, index + 100),
          limit: Math.min(500, Math.max(1, ids.slice(index, index + 100).length * 4)),
        });
      }
      const statusEvents = statusFilters.length > 0 ? await artifactSource.query(statusFilters, { signal }) : [];
      const statuses = statusEvents
        .map((event) => parseAuthoritativeStatus(event, artifactsById, maintainers))
        .filter((status): status is Nip34Status => !!status);
      const statusByArtifact = latestProjectStatuses(statuses);

      const issues = artifacts.filter((artifact) => artifact.kind === NIP34_ISSUE_KIND).sort(newestFirst);
      const patches = artifacts.filter((artifact) => artifact.kind === NIP34_PATCH_KIND).sort(newestFirst);
      const pullRequests = artifacts.filter((artifact) => artifact.kind === NIP34_PULL_REQUEST_KIND).sort(newestFirst);
      const activity: Nip34Project["activity"] = [
        ...artifacts,
        ...pullRequestUpdates.map((event) => ({ event, kind: "pr-update" as const })),
        ...statuses,
      ].sort(newestFirst);

      return { pointer: p, repository, repositoryStates, maintainers, artifactRelays, issues, patches, pullRequests, pullRequestUpdates, activity, statusByArtifact, warnings };
    },
    staleTime: 30_000,
  });
}
