import { describe, expect, it } from "vitest";

import { capRelays, isImagePointer, isSafeCommunityRelayUrl } from "@/concord-v2/lib/types";

describe("community relay boundaries", () => {
  it("accepts public secure relays", () => {
    expect(isSafeCommunityRelayUrl("wss://relay.example.com/path")).toBe(true);
  });

  it("rejects unsafe schemes, credentials, fragments, and local-network targets", () => {
    const unsafe = [
      "https://relay.example.com",
      "wss://user:pass@relay.example.com",
      "wss://relay.example.com/#secret",
      "wss://localhost",
      "wss://127.0.0.1",
      "wss://192.168.1.10",
      "ws://localhost:7777",
      "ws://relay.example.com",
    ];
    expect(unsafe.every((url) => !isSafeCommunityRelayUrl(url))).toBe(true);
    expect(capRelays([unsafe[0], "wss://relay.example.com/"])).toEqual(["wss://relay.example.com"]);
  });
});

describe("encrypted image pointer validation", () => {
  const valid = { url: "https://cdn.example.com/blob", key: "aa".repeat(32), nonce: "bb".repeat(16), hash: "cc".repeat(32) };

  it("requires exact AES key, nonce, and digest lengths", () => {
    expect(isImagePointer(valid)).toBe(true);
    expect(isImagePointer({ ...valid, key: "aa".repeat(31) })).toBe(false);
    expect(isImagePointer({ ...valid, nonce: "bb".repeat(15) })).toBe(false);
    expect(isImagePointer({ ...valid, hash: "not-hex" })).toBe(false);
  });
});
