/**
 * BaoFundPage — the ₿AO Fund surface.
 *
 * Ported from bao_fund_it origin/main: relay-first campaign feed, the campaign
 * cards, the milestone breakdown, the pledge flow, campaign creation, and the
 * campaign-chat gate. The chat itself lives at /community (BaoFundChatPage);
 * "open the room" navigates there.
 *
 * The older 2140.wtf src/components/bao-fund fork is replaced by this surface.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "@/baofund/auth/useAuth";
import { FundingCampaignCard, type CampaignCardDraft } from "@/baofund/components/frames/FundingCampaignCard";
import { CreateCampaignModal, type CreateMode } from "@/baofund/components/create/CreateCampaignModal";
import { FundCampaignModal } from "@/baofund/components/fund/FundCampaignModal";
import { PledgeModal } from "@/baofund/components/fund/PledgeModal";
import { CampaignChatGate } from "@/baofund/components/fund/CampaignChatGate";
import { OnchainReleaseSection } from "@/baofund/components/fund/OnchainReleaseSection";
import { MilestoneCourtSection } from "@/baofund/court/MilestoneCourtSection";
import { fundCourtGroupPubkey } from "@/baofund/lib/court/courtGroupPubkey";
import { breakdownFromDrafts, type CampaignBreakdown } from "@/baofund/components/fund/campaignBreakdown";
import { FundFaq, FundIntroCollapsible } from "@/baofund/components/landing/FundLanding";
import { FundMePanel } from "@/baofund/components/landing/FundGuides";
import { gateStripProp, useFundFeed } from "@/baofund/relay/fundFeed";
import { fetchFundraiser } from "@/baofund/lib/baoFundraising";
import "@/baofund/theme/newspaperTheme.css";
import "@/baofund/theme/appTokens.css";

interface PledgeTarget {
  id: string;
  title: string;
  mainnet: boolean;
  ownerPubkey?: string;
  rails?: string[];
  breakdown?: CampaignBreakdown;
}

interface ChatGate {
  title: string;
}

export function BaoFundPage() {
  const navigate = useNavigate();
  const auth = useAuth();
  const feed = useFundFeed(auth.signer ?? undefined);
  const cards = feed.cards;

  const [createMode, setCreateMode] = useState<CreateMode | null>(null);
  const [breakdown, setBreakdown] = useState<CampaignBreakdown | null>(null);
  const [pledgeTarget, setPledgeTarget] = useState<PledgeTarget | null>(null);
  const [chatGate, setChatGate] = useState<ChatGate | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const openChat = useCallback(
    (id: string, title: string, roomAvailable?: boolean) => {
      // The campaign room is joined from the chat surface with the same
      // signer; when the viewer has not contributed yet the API gate answers
      // and we show the graceful public-doors gate instead.
      if (roomAvailable === false) {
        setChatGate({ title });
        return;
      }
      navigate("/community", { state: { campaignRoomId: id, title } });
    },
    [navigate],
  );

  const openBreakdown = useCallback(
    (card: CampaignCardDraft) => {
      setBreakdown(breakdownFromDrafts(cards, card.frId ?? card.id));
    },
    [cards],
  );

  const fundCard = useCallback(
    (card: CampaignCardDraft) => {
      const bd = breakdownFromDrafts(cards, card.frId ?? card.id);
      setPledgeTarget({
        id: card.frId ?? card.id,
        title: card.title,
        mainnet: card.mainnetCashu === true,
        ownerPubkey: card.ownerPubkey,
        rails: card.rail ? [card.rail] : undefined,
        breakdown: bd ?? undefined,
      });
    },
    [cards],
  );

  const location = useLocation();
  const deepLinkFrId =
    (location.state as { fundraiserId?: string } | null)?.fundraiserId ??
    new URLSearchParams(location.search).get("fundraiser") ??
    undefined;
  const deepLinkHandled = useRef(false);

  // "Fund from the room" / deep links: open the pledge flow for the campaign
  // once the feed has loaded (falling back to a direct fetch when the card is
  // not in the current feed page).
  useEffect(() => {
    if (!deepLinkFrId || deepLinkHandled.current || feed.loading) return;
    deepLinkHandled.current = true;
    const card = cards.find((c) => c.frId === deepLinkFrId || c.id === deepLinkFrId);
    if (card) {
      fundCard(card);
      return;
    }
    void (async () => {
      try {
        const { fundraiser } = await fetchFundraiser(deepLinkFrId, auth.signer ?? undefined);
        setPledgeTarget({
          id: fundraiser.id,
          title: fundraiser.title,
          mainnet: fundraiser.network === "mainnet",
          ownerPubkey: fundraiser.owner_pubkey,
          rails: fundraiser.settlement_rail ? [fundraiser.settlement_rail] : undefined,
        });
      } catch {
        /* deep link to an unknown/unavailable campaign: leave the feed as-is */
      }
    })();
  }, [deepLinkFrId, feed.loading, cards, fundCard, auth.signer]);

  const campaignCountLabel = useMemo(() => {
    if (feed.loading) return "Fetching fundraisers…";
    if (cards.length === 0) return "No open campaigns yet — create one";
    return `${cards.length} campaign${cards.length === 1 ? "" : "s"}`;
  }, [feed.loading, cards.length]);

  return (
    <div className="newspaper min-h-screen" style={{ background: "var(--np-bg)", color: "var(--np-ink)" }}>
      <main className="mx-auto max-w-5xl px-4 pb-8 pt-6 sm:px-5">
        <header className="mb-4 flex items-center justify-between border-b pb-3" style={{ borderColor: "var(--np-rule)" }}>
          <div>
            <h1 className="text-xl font-bold tracking-tight">₿AO Fund</h1>
            <p className="text-[11px]" style={{ color: "var(--np-muted)", fontFamily: "var(--np-font-mono)" }}>
              {campaignCountLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (auth.status !== "ready") {
                setStatus("Sign in to create a campaign");
                return;
              }
              setCreateMode("playground");
            }}
            className="px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em]"
            style={{ color: "var(--np-on-accent)", background: "var(--np-accent)", fontFamily: "var(--np-font-mono)" }}
          >
            Create campaign
          </button>
        </header>

        {status && (
          <p className="pb-3 text-[11px]" style={{ color: "var(--np-accent-2)", fontFamily: "var(--np-font-mono)" }}>
            {status}
          </p>
        )}

        <div className="grid gap-5 sm:grid-cols-2">
          {cards.map((c) => (
            <FundingCampaignCard
              key={c.id}
              campaign={c}
              nowSec={nowSec}
              gateStrip={gateStripProp(feed.gateViews.get(c.id), nowSec) ?? undefined}
              onFund={(id) => {
                const card = cards.find((x) => x.id === id) ?? c;
                fundCard(card);
              }}
              onChat={(id, title, roomAvailable) => openChat(id, title, roomAvailable)}
              onOpen={(card) => openBreakdown(card)}
            />
          ))}
        </div>

        <FundIntroCollapsible
          onPlayground={() => setCreateMode("playground")}
          onAgents={() => setCreateMode("playground")}
        />
        <FundMePanel initialRail="cashu" onCreate={(mode) => setCreateMode(mode)} />
      </main>

      <footer className="mx-auto max-w-5xl px-4 pb-10 sm:px-5">
        <FundFaq />
      </footer>

      {createMode && (
        <CreateCampaignModal
          defaultMode={createMode}
          onCreated={(info) => {
            setStatus(`Created “${info.title}”`);
            // The campaign room is the funding entry point (bao_fund_it parity):
            // after creation, open it in the chat.
            if (info.roomRequested) {
              navigate("/community", {
                state: { campaignRoomId: info.fundraiserId, title: info.title },
              });
            }
          }}
          onDone={(msg) => {
            setStatus(msg);
            setCreateMode(null);
            feed.reload();
          }}
          onClose={() => setCreateMode(null)}
        />
      )}

      {breakdown && (
        <FundCampaignModal
          campaign={breakdown}
          nowSec={nowSec}
          onClose={() => setBreakdown(null)}
          onFund={() => {
            const target = breakdown;
            setBreakdown(null);
            setPledgeTarget({
              id: target.frId ?? target.key,
              title: target.title,
              mainnet: target.network === "mainnet",
              ownerPubkey: target.ownerPubkey,
              rails: target.rail ? [target.rail] : undefined,
              breakdown: target,
            });
          }}
          onChat={(id, title, roomAvailable) => openChat(id, title, roomAvailable)}
          disputeSlot={(m) =>
            // Donor-only dispute surface (FROST court). The caller decides
            // entitlement; the modal never shows for non-contributors.
            breakdown.frId && auth.pubkey ? (
              <MilestoneCourtSection
                escrowId={`${breakdown.frId}::${m.id}`}
                frId={breakdown.frId}
                milestoneId={m.id}
                contributorPubkey={auth.pubkey}
                founderPubkey={breakdown.ownerPubkey ?? ""}
                marketEventId={m.marketId ?? m.id}
                secondsSinceEscrowLock={Math.max(0, nowSec - (m.deadlineAt ?? nowSec))}
                courtGroupPubkey={fundCourtGroupPubkey()}
                viewerRole="donor"
              />
            ) : null
          }
          releaseSlot={(m) =>
            // Owner-only on-chain release, matching bao_fund_it: the founder
            // signs the escrow release for an unlocked milestone.
            breakdown.frId && breakdown.ownerPubkey && auth.pubkey === breakdown.ownerPubkey && m.status === "unlocked" ? (
              <OnchainReleaseSection
                fundraiserId={breakdown.frId}
                milestoneId={m.id}
                signer={auth.signer}
                milestoneLabel={m.title}
              />
            ) : null
          }
          fundLabel={breakdown.network === "mainnet" ? "Fund with real Cashu" : "Fund this project (testnet)"}
        />
      )}

      {pledgeTarget && (
        <PledgeModal
          fundraiserId={pledgeTarget.id}
          title={pledgeTarget.title}
          mainnetCashu={pledgeTarget.mainnet}
          ownerPubkey={pledgeTarget.ownerPubkey}
          campaignRails={pledgeTarget.rails}
          breakdown={pledgeTarget.breakdown}
          nowSec={nowSec}
          onDone={(msg) => {
            setStatus(msg);
            setPledgeTarget(null);
            feed.reload();
          }}
          onClose={() => setPledgeTarget(null)}
        />
      )}

      {chatGate && (
        <CampaignChatGate
          campaignTitle={chatGate.title}
          onClose={() => setChatGate(null)}
          onOpenRoom={(roomName) => {
            setChatGate(null);
            navigate("/community", { state: { defaultRoomName: roomName } });
          }}
        />
      )}
    </div>
  );
}

export default BaoFundPage;
