import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { nip19 } from "nostr-tools";
import { describe, expect, it } from "vitest";

import {
  latestProjectStatuses,
  parseAuthoritativeStatus,
  parseProjectArtifact,
  parseRepoNaddr,
  parseRepositoryEvent,
  repositoryMaintainers,
} from "@/lib/nip34Project";

const ownerSk = generateSecretKey();
const owner = getPublicKey(ownerSk);
const maintainerSk = generateSecretKey();
const maintainer = getPublicKey(maintainerSk);
const contributorSk = generateSecretKey();
const attackerSk = generateSecretKey();

function event(sk: Uint8Array, kind: number, tags: string[][], content = "") {
  return finalizeEvent({ kind, tags, content, created_at: 100 }, sk);
}

const rawPointer = nip19.naddrEncode({
  kind: 30617,
  pubkey: owner,
  identifier: "bao-core",
  relays: ["wss://relay.example.com/", "ws://localhost:7777"],
});

describe("NIP-34 repository pointers", () => {
  it("canonicalizes a kind-30617 naddr and drops unsafe relay hints", () => {
    const pointer = parseRepoNaddr(rawPointer)!;
    expect(pointer.coordinate).toBe(`30617:${owner}:bao-core`);
    expect(pointer.relays).toEqual(["wss://relay.example.com"]);
    expect(parseRepoNaddr(pointer.naddr)).toEqual(pointer);
  });

  it("rejects other addressable kinds and malformed identifiers", () => {
    expect(parseRepoNaddr(nip19.naddrEncode({ kind: 30023, pubkey: owner, identifier: "article" }))).toBeUndefined();
    expect(parseRepoNaddr("not-an-naddr")).toBeUndefined();
  });
});

describe("NIP-34 project trust boundaries", () => {
  const pointer = parseRepoNaddr(rawPointer)!;
  const repo = event(ownerSk, 30617, [["d", "bao-core"], ["maintainers", maintainer, "bad"]]);

  it("requires the repository coordinate's declared author and identifier", () => {
    expect(parseRepositoryEvent(repo, pointer)).toBe(repo);
    expect(parseRepositoryEvent(event(attackerSk, 30617, [["d", "bao-core"]]), pointer)).toBeUndefined();
    expect(parseRepositoryEvent(event(ownerSk, 30617, [["d", "other"]]), pointer)).toBeUndefined();
    expect(repositoryMaintainers(repo, pointer)).toEqual(new Set([owner, maintainer]));
  });

  it("ignores forged statuses and deterministically chooses the latest authority", () => {
    const issueEvent = event(contributorSk, 1621, [["a", pointer.coordinate], ["p", owner], ["subject", "Fix privacy"]], "details");
    const issue = parseProjectArtifact(issueEvent, pointer)!;
    const artifacts = new Map([[issueEvent.id, issue]]);
    const maintainers = repositoryMaintainers(repo, pointer);
    const forged = event(attackerSk, 1631, [["e", issueEvent.id, "", "root"]]);
    expect(parseAuthoritativeStatus(forged, artifacts, maintainers)).toBeUndefined();

    const byAuthor = parseAuthoritativeStatus(event(contributorSk, 1630, [["e", issueEvent.id, "", "root"]]), artifacts, maintainers)!;
    const byMaintainerEvent = finalizeEvent({ kind: 1631, tags: [["e", issueEvent.id, "", "root"]], content: "", created_at: 101 }, maintainerSk);
    const byMaintainer = parseAuthoritativeStatus(byMaintainerEvent, artifacts, maintainers)!;
    expect(latestProjectStatuses([byMaintainer, byAuthor]).get(issueEvent.id)?.status).toBe("applied");
  });
});
