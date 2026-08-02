import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { clearConcordQueryMemory, purgeConcordStorage } from "./purgeConcordStorage";

describe("purgeConcordStorage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects when another tab blocks deletion", async () => {
    const deleteDatabase = vi.fn(() => {
      const request: {
        error: DOMException | null;
        onsuccess: (() => void) | null;
        onerror: (() => void) | null;
        onblocked: (() => void) | null;
      } = { error: null, onsuccess: null, onerror: null, onblocked: null };
      queueMicrotask(() => request.onblocked?.());
      return request;
    });
    vi.stubGlobal("indexedDB", { deleteDatabase });

    await expect(purgeConcordStorage()).rejects.toThrow(/another tab/i);
  });

  it("clears Concord and wire query memory without touching public queries", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["concord2", "channel", "id"], ["plaintext"]);
    queryClient.setQueryData(["wire", "concord2-channels", "sig"], ["secret"]);
    queryClient.setQueryData(["feed"], ["public"]);

    clearConcordQueryMemory(queryClient);

    expect(queryClient.getQueryData(["concord2", "channel", "id"])).toBeUndefined();
    expect(queryClient.getQueryData(["wire", "concord2-channels", "sig"])).toBeUndefined();
    expect(queryClient.getQueryData(["feed"])).toEqual(["public"]);
  });
});
