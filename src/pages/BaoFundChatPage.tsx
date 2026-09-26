/**
 * BaoFundChatPage — the ₿AO Fund chat surface.
 *
 * This is the bao_fund_it chat stack (ChatPanel + useProtocolChat over the
 * pinned @bao/community protocol) ported into 2140.wtf. It replaces the
 * previous 2140 Social / Trollbox group chat at /community.
 *
 * The protocol core is vendored under src/baofund/community (the exact
 * commit pinned by baocommunity/bao_fund_it). Auth is projected from 2140.wtf's
 * Nostrify login via src/baofund/auth/useAuth.
 *
 * The room set comes from the Fund API's public rooms, i.e. the FUND relay
 * (wss://relay.bao.fund) — the same chat as bao.fund, never a different
 * relay's room. Guests see the public landing room (Trollbox) and can post.
 *
 * Deep links from the fund page: `{ defaultRoomName }` lands on a public
 * room; `{ campaignRoomId, title }` imports + opens that campaign's room.
 */
import React, { useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { ChatProvider, useChatContext } from "@/baofund/chat/ChatContext";
import { ChatPanel } from "@/baofund/chat/ChatPanel";
import { useAuth } from "@/baofund/auth/useAuth";
import { createGuestSigner } from "@/baofund/relay/guestIdentity";
import { useLayoutOptions } from "@/contexts/LayoutContext";
import "@/baofund/baoFundChat.css";
import "@/baofund/theme/newspaperTheme.css";
import "@/baofund/theme/appTokens.css";

interface ChatNavState {
  /** Public room to land on (campaign-chat gate). */
  defaultRoomName?: string;
  /** Campaign room to import + open (fund page "Chat" action). */
  campaignRoomId?: string;
  title?: string;
}

/**
 * Imports and opens a campaign's discussion room once, using the signed-in
 * signer (or the guest key for signed-out visitors). The campaign room link is
 * resolved through the Fund API; donor-gated rooms fail closed with the
 * context's own error, never by silently opening another room.
 */
function CampaignRoomOpener({ fundraiserId, title }: { fundraiserId: string; title?: string }) {
  const chat = useChatContext();
  const auth = useAuth();
  const opened = useRef(false);

  useEffect(() => {
    if (opened.current || !fundraiserId) return;
    opened.current = true;
    const signer = auth.signer ?? createGuestSigner();
    void (async () => {
      const meta = await chat.importCampaign(fundraiserId, title || "Campaign", signer);
      if (meta) await chat.selectRoom(meta.roomId);
    })();
  }, [fundraiserId, title, chat, auth.signer]);

  return null;
}

export function BaoFundChatPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const navState = (location.state ?? null) as ChatNavState | null;

  // Full-width chat: collapse both side panels and lift the center column's
  // max-width so the room timeline uses the whole viewport.
  useLayoutOptions({
    collapseLeftSidebar: true,
    rightSidebar: null,
    noMaxWidth: true,
    noOverscroll: true,
    wrapperClassName: "max-w-none w-full",
  });

  // "Fund from the room" (owner priority): open the pledge flow for the
  // room's campaign. The campaign rooms and the fund page share the campaign
  // id, so navigating to the fund surface resolves the same fundraiser.
  const handleFundCampaign = useCallback(
    (fundraiserId: string, title: string) => {
      navigate(`/bao/fund?fundraiser=${encodeURIComponent(fundraiserId)}`, {
        state: { fundraiserId, title },
      });
    },
    [navigate],
  );

  return (
    <div className="bao-fund-chat min-h-screen">
      <div className="w-full px-3 py-4 sm:px-5">
        <header className="mb-4 border-b pb-3" style={{ borderColor: "var(--np-rule)" }}>
          <h1 className="text-lg font-bold tracking-tight">₿AO</h1>
          <p className="text-xs" style={{ color: "var(--np-muted)" }}>
            Encrypted, un-scrapable community chat — one shared room set across
            bao.fund, app.bao.network and the hub.
          </p>
        </header>
        <ChatProvider>
          {navState?.campaignRoomId && (
            <CampaignRoomOpener fundraiserId={navState.campaignRoomId} title={navState.title} />
          )}
          <ChatPanel
            defaultRoomName={navState?.defaultRoomName ?? null}
            onFundCampaign={handleFundCampaign}
          />
        </ChatProvider>
      </div>
    </div>
  );
}

export default BaoFundChatPage;
