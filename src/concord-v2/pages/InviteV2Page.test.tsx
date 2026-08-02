import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { InviteV2Page } from "./InviteV2Page";

const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  join: vi.fn(),
  user: { pubkey: "ab".repeat(32) },
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: mocks.user }),
}));

vi.mock("@/concord-v2/hooks/useCommunityActions2", () => ({
  BannedFromCommunityError: class BannedFromCommunityError extends Error {},
  useCommunityActions2: () => ({ preview: mocks.preview, join: mocks.join }),
}));

vi.mock("@/concord-v2/lib/agentGate", () => ({
  AgentOnlyCommunityError: class AgentOnlyCommunityError extends Error {},
}));

vi.mock("@/concord-v2/lib/invite", () => ({
  parseInviteRoute: () => ({ linkSigner: "cd".repeat(32), token: new Uint8Array(16), bootstrapRelays: [] }),
}));

function renderInvite() {
  return render(
    <MemoryRouter initialEntries={["/bao/invite/example#secret"]}>
      <Routes>
        <Route path="/bao/invite/:naddr" element={<InviteV2Page />} />
        <Route path="/bao/c/:communityId" element={<div>Joined route</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("InviteV2Page consent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("waits for preview and explicit acceptance before joining", async () => {
    let resolvePreview!: (value: { name: string; bundle: { audience?: string } }) => void;
    mocks.preview.mockReturnValue(new Promise((resolve) => { resolvePreview = resolve; }));
    mocks.join.mockResolvedValue({ communityId: "12".repeat(32), name: "Private room" });

    renderInvite();
    expect(screen.getByText("Checking the encrypted invite…")).toBeInTheDocument();
    expect(mocks.join).not.toHaveBeenCalled();

    await act(async () => resolvePreview({ name: "Private room", bundle: {} }));
    const accept = await screen.findByRole("button", { name: /Accept as/ });
    expect(mocks.join).not.toHaveBeenCalled();

    fireEvent.click(accept);
    await waitFor(() => expect(mocks.join).toHaveBeenCalledWith(expect.objectContaining({ grindAgentPow: false })));
  });

  it("preserves the resolved agent audience when explicitly accepted", async () => {
    mocks.preview.mockResolvedValue({ name: "Agent room", bundle: { audience: "agent" } });
    mocks.join.mockResolvedValue({ communityId: "34".repeat(32), name: "Agent room" });

    renderInvite();
    const accept = await screen.findByRole("button", { name: /Accept as/ });
    expect(mocks.join).not.toHaveBeenCalled();
    fireEvent.click(accept);

    await waitFor(() => expect(mocks.join).toHaveBeenCalledWith(expect.objectContaining({ grindAgentPow: true })));
  });
});
