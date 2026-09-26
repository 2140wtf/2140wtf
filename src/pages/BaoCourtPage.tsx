/**
 * BaoCourtPage — the FROST ₿AO Court (juror console), ported from bao_fund_it.
 *
 * Candidacies and disputes are PUBLIC court data on the fund relay; the juror
 * console drains the encrypted gift-wrapped inbox with the NIP-60 signer.
 * Settlement rails are Cashu + Liquid testnet + Bitcoin testnet4 (no signet).
 */
import { useMemo } from "react";

import { useAuth } from "@/baofund/auth/useAuth";
import { CourtPanel } from "@/baofund/court/CourtPanel";
import { baoRelayUrl } from "@/baofund/lib/baoFundraising";
import { useFundFeed } from "@/baofund/relay/fundFeed";
import "@/baofund/theme/newspaperTheme.css";
import "@/baofund/theme/appTokens.css";

export function BaoCourtPage() {
  const auth = useAuth();
  const feed = useFundFeed(auth.signer ?? undefined);

  const signEvent = useMemo(
    () =>
      auth.signer
        ? async (t: { kind: number; created_at: number; tags: string[][]; content: string }) => {
            const signed = await auth.signer!.signEvent(t);
            return { ...t, ...signed };
          }
        : null,
    [auth.signer],
  );

  const campaigns = useMemo(
    () =>
      feed.cards.map((c) => ({
        id: c.id,
        title: c.title,
        ...(c.frId ? { frId: c.frId } : {}),
      })),
    [feed.cards],
  );

  return (
    <div className="newspaper min-h-screen" style={{ background: "var(--np-bg)", color: "var(--np-ink)" }}>
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-5">
        <header className="mb-4 border-b pb-3" style={{ borderColor: "var(--np-rule)" }}>
          <h1 className="text-xl font-bold tracking-tight">₿AO Court</h1>
          <p className="text-xs" style={{ color: "var(--np-muted)" }}>
            When a funded campaign goes wrong, a randomly picked jury decides the
            outcome. Post a small testnet bond to join the jury, vote once, and
            earn a share of the fee if you vote with the majority. Rails: Cashu ·
            Liquid testnet · Bitcoin testnet4.
          </p>
        </header>
        <CourtPanel
          myPubkey={auth.pubkey}
          nip60Signer={auth.nip60Signer}
          signEvent={signEvent}
          relayUrl={baoRelayUrl()}
          campaigns={campaigns}
        />
      </div>
    </div>
  );
}

export default BaoCourtPage;
