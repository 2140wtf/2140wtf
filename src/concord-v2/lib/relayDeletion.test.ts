import { describe, expect, it, vi } from "vitest";

import { partitionDeletionCapableRelays, relayDeletionCapability } from "@/concord-v2/lib/relayDeletion";

function relayInfo(supportedNips: number[], ok = true): Response {
  return {
    ok,
    json: vi.fn().mockResolvedValue({ supported_nips: supportedNips }),
  } as unknown as Response;
}

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

  it("uses the first-party BAO policy attestation when NIP-11 omits NIP-09", async () => {
    await expect(relayDeletionCapability("wss://relay.bao.network", async () => relayInfo([1, 11]))).resolves.toEqual({
      url: "wss://relay.bao.network",
      supported: true,
      attestation: "first-party-attested",
    });
  });
});
