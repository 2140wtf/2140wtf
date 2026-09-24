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
 */
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

import { ChatProvider } from "@/baofund/chat/ChatContext";
import { ChatPanel } from "@/baofund/chat/ChatPanel";
import { useLayoutOptions } from "@/contexts/LayoutContext";
import "@/baofund/baoFundChat.css";
import "@/baofund/theme/newspaperTheme.css";
import "@/baofund/theme/appTokens.css";

export function BaoFundChatPage() {
  const navigate = useNavigate();

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
          <h1 className="text-lg font-bold tracking-tight">₿AO Chat</h1>
          <p className="text-xs" style={{ color: "var(--np-muted)" }}>
            Encrypted, un-scrapable community chat — one shared room set across
            bao.fund, app.bao.network and the hub.
          </p>
        </header>
        <ChatProvider>
          <ChatPanel onFundCampaign={handleFundCampaign} />
        </ChatProvider>
      </div>
    </div>
  );
}

export default BaoFundChatPage;
