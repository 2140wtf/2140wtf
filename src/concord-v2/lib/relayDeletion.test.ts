import { describe, expect, it, vi } from "vitest";

import {
  FIRST_PARTY_DELETION_CAPABLE_RELAYS,
  partitionDeletionCapableRelays,
  relayDeletionCapability,
} from "@/concord-v2/lib/relayDeletion";

function relayInfo(supportedNips: number[], ok = true): Response {
  return {
    ok,
    json: vi.fn().mockResolvedValue({ supported_nips: supportedNips }),
  } as unknown as Response;
}

const FIRST_PARTY = FIRST_PARTY_DELETION_CAPABLE_RELAYS[0];

describe("relay deletion capability", () => {
  it("accepts only relays that advertise NIP-09", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(relayInfo([1, 9, 11]))
      .mockResolvedValueOnce(relayInfo([1, 11, 42]));

    await expect(partitionDeletionCapableRelays([
      "wss://delete.example/",
      "wss://keep-forever.example",
    ], fetcher)).resolves.toEqual({
      supported: ["wss://delete.example"],
      excluded: [{
        url: "wss://keep-forever.example",
        supported: false,
        reason: "nip-09-not-advertised",
      }],
    });
  });

  it("fails closed when relay information cannot be verified", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("offline"));

    await expect(relayDeletionCapability("wss://offline.example", fetcher)).resolves.toEqual({
      url: "wss://offline.example",
      supported: false,
      reason: "relay-info-unavailable",
    });
  });

  it("attests first-party relays when the NIP-11 fetch fails (CORS/network)", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(relayDeletionCapability(FIRST_PARTY, fetcher)).resolves.toEqual({
      url: FIRST_PARTY,
      supported: true,
      attestation: "first-party-attested",
    });
  });

  it("attests first-party relays on non-OK NIP-11 responses", async () => {
    const fetcher = vi.fn().mockResolvedValue(relayInfo([], false));

    await expect(relayDeletionCapability(FIRST_PARTY, fetcher)).resolves.toEqual({
      url: FIRST_PARTY,
      supported: true,
      attestation: "first-party-attested",
    });
  });

  it("never lets the attestation override a readable document that omits NIP-09", async () => {
    const fetcher = vi.fn().mockResolvedValue(relayInfo([1, 11, 42]));

    await expect(relayDeletionCapability(FIRST_PARTY, fetcher)).resolves.toEqual({
      url: FIRST_PARTY,
      supported: false,
      reason: "nip-09-not-advertised",
    });
  });

  it("still trusts a readable first-party document that advertises NIP-09", async () => {
    const fetcher = vi.fn().mockResolvedValue(relayInfo([1, 9, 11]));

    await expect(relayDeletionCapability(FIRST_PARTY, fetcher)).resolves.toEqual({
      url: FIRST_PARTY,
      supported: true,
    });
  });

  it("partitions attested first-party relays as supported while keeping others fail-closed", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(partitionDeletionCapableRelays([
      FIRST_PARTY,
      "wss://offline.example",
    ], fetcher)).resolves.toEqual({
      supported: [FIRST_PARTY],
      excluded: [{
        url: "wss://offline.example",
        supported: false,
        reason: "relay-info-unavailable",
      }],
    });
  });
});
