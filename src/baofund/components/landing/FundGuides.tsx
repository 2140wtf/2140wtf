/**
 * FundGuides - guided step-by-step panels for the user journeys:
 * View Campaigns (browse & fund) and the UNIFIED Fund me flow (owner,
 * 2026-09-19: the steps are the same across rails - one panel, the user
 * picks the coin: Bitcoin testnet4 / Liquid testnet / mainnet Cashu).
 */
import React from 'react';
import '../../theme/newspaperTheme.css';
import { AgentGateCheck } from '../agents/AgentGateCheck';

export interface GuideStep {
  t: string;
  d: string;
}

/** Numbered step list, newspaper style. */
export function GuideSteps({ steps }: { steps: GuideStep[] }): React.ReactElement {
  return (
    <ol className="grid gap-3 sm:grid-cols-2">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-3 border p-3" style={{ borderColor: 'var(--np-rule)' }}>
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold"
            style={{
              fontFamily: 'var(--np-font-mono)',
              color: 'var(--np-on-accent)',
              background: 'var(--np-ink)',
            }}
          >
            {i + 1}
          </span>
          <div>
            <div
              className="mb-0.5 text-[11px] font-bold uppercase tracking-[0.14em]"
              style={{ fontFamily: 'var(--np-font-mono)', color: 'var(--np-ink)' }}
            >
              {s.t}
            </div>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--np-muted)' }}>
              {s.d}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function PanelShell({
  kicker,
  badge,
  badgeColor,
  title,
  children,
}: {
  kicker: string;
  badge: string;
  badgeColor: string;
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="border p-5" style={{ borderColor: badgeColor, background: 'var(--np-paper)' }}>
      <div
        className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-[0.2em]"
        style={{ fontFamily: 'var(--np-font-mono)', color: badgeColor }}
      >
        <span>{kicker}</span>
        <span className="border px-1.5 py-0.5" style={{ borderColor: badgeColor }}>
          {badge}
        </span>
      </div>
      <h2
        className="mb-3 text-xl font-bold"
        style={{ fontFamily: 'var(--np-font-serif)', color: 'var(--np-ink)' }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function CreateButton({ label, onClick }: { label: string; onClick: () => void }): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-4 px-5 py-2 text-[11px] font-bold uppercase tracking-[0.2em]"
      style={{
        fontFamily: 'var(--np-font-mono)',
        color: 'var(--np-on-accent)',
        background: 'var(--np-accent)',
        border: '1px solid var(--np-accent)',
      }}
    >
      {label}
    </button>
  );
}

export type FundMeRail = 'testnet4' | 'liquid' | 'cashu';

const RAILS: Array<{ id: FundMeRail; label: string; badge: string; color: string }> = [
  { id: 'testnet4', label: 'Bitcoin · Testnet4', badge: 'ON-CHAIN · NO VALUE', color: 'var(--np-accent)' },
  { id: 'liquid', label: 'Liquid · Testnet', badge: 'ON-CHAIN · NO VALUE', color: 'var(--np-accent-2)' },
  { id: 'cashu', label: 'Mainnet · Cashu', badge: 'REAL ECASH', color: 'var(--np-success)' },
];

const RAIL_STEPS: Record<FundMeRail, Array<{ t: string; d: string }>> = {
  testnet4: [
    { t: 'Get free coins', d: 'A testnet4 faucet sends sats to your tb1p… taproot address (find current faucets via mempool.space/testnet4).' },
    { t: 'Create the campaign', d: 'Per-stage tapscript outputs are derived from YOUR key - nothing is custodial. Every pledge is a real on-chain output.' },
    { t: 'Fund it from your wallet', d: 'Hit FUND - the pledge shows the escrow address. Pay it from your testnet4 wallet, paste the txid; the probe verifies it on-chain.' },
    { t: 'Claim or refund', d: 'On delivery the founder claims through the founder tapscript; if it fails, the donor refunds through the CLTV path - all on-chain.' },
  ],
  liquid: [
    { t: 'Get free coins', d: 'The Liquid testnet faucet sends LBTC to your tex1… address.' },
    { t: 'Create the campaign', d: 'Same tapscript milestone escrow as testnet4, on Liquid - cheaper, faster blocks.' },
    { t: 'Fund it from your wallet', d: 'Open the campaign, hit FUND, pay the escrow address from your Liquid wallet, paste the txid.' },
    { t: 'Claim or refund', d: 'Founder claim / donor CLTV refund - identical mechanics, on-chain, no platform signature.' },
  ],
  cashu: [
    { t: 'Create agent funding', d: 'Describe the job your agent will do and split it into milestones.' },
    { t: 'Split into milestones', d: 'Each milestone = a funding tranche + the evidence you will publish when it is done.' },
    { t: 'Share the campaign', d: 'It appears under View Campaigns with a REAL badge. Donors send Cashu tokens to your wallet.' },
    { t: 'Deliver & redeem', d: 'Publish proof, get attested, redeem the tokens in the Wallet tab (Cashu · mainnet).' },
  ],
};

/**
 * Fund me - the UNIFIED funding flow (owner 2026-09-19): one guided panel,
 * the user picks the rail; the mechanics are the same for all three.
 */
export function FundMePanel({
  initialRail,
  onCreate,
}: {
  initialRail: FundMeRail;
  onCreate: (mode: 'mainnet' | 'playground') => void;
}): React.ReactElement {
  const [rail, setRail] = React.useState<FundMeRail>(initialRail);
  const active = RAILS.find((r) => r.id === rail)!;
  return (
    <PanelShell
      kicker="Fund me"
      badge={active.badge}
      badgeColor={active.color}
      title="From an idea to a funded ₿AO"
    >
      <p className="mb-4 text-sm leading-relaxed" style={{ color: 'var(--np-muted)' }}>
        One flow, three coins. Describe the work, split it into milestones, publish proof, and the
        community attests delivery. <b>Pick the rail</b> - the steps below adapt.
      </p>
      {/* Rail chooser - newspaper rule bar with | separators. */}
      <div
        className="mb-4 flex flex-wrap items-center justify-between gap-2 border-y py-2"
        style={{ borderColor: 'var(--np-rule)' }}
      >
        <span
          className="text-[10px] uppercase tracking-[0.2em]"
          style={{ fontFamily: 'var(--np-font-mono)', color: 'var(--np-muted)' }}
        >
          Rail
        </span>
        <div className="flex items-center divide-x" style={{ borderColor: 'var(--np-rule)' }}>
          {RAILS.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRail(r.id)}
              className="px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em]"
              style={{
                fontFamily: 'var(--np-font-mono)',
                color: rail === r.id ? r.color : 'var(--np-muted)',
                borderLeft: r.id !== RAILS[0].id ? '1px solid var(--np-rule)' : undefined,
                textDecoration: rail === r.id ? 'underline' : 'none',
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <GuideSteps steps={RAIL_STEPS[rail]} />
      {rail !== 'cashu' && (
        <p className="mt-3 text-[11px] leading-relaxed" style={{ color: 'var(--np-muted)' }}>
          Not a simulation: the REAL tapscript escrow, no-value coins from public faucets. The
          platform never holds keys - only the coin value differs from mainnet.
        </p>
      )}
      {rail === 'cashu' && (
        <p className="mt-3 text-[11px] leading-relaxed" style={{ color: 'var(--np-muted)' }}>
          Receiving is free. Set up your wallet in the <b>Wallet</b> tab first so tokens have a home
          (keys stay in this browser / your Nostr relays).
        </p>
      )}
      <div className="mt-4">
        <AgentGateCheck title="Agent check - reveal agent-only tooling">
          <p className="text-xs leading-relaxed" style={{ color: 'var(--np-muted)' }}>
            Agent lane unlocked - the compute-credit tooling below is intended for autonomous
            agents. Requests you post from here are flagged as agent-originated.
          </p>
        </AgentGateCheck>
      </div>
      <CreateButton
        label={rail === 'cashu' ? 'Create campaign - mainnet Cashu' : 'Create campaign - free'}
        onClick={() => onCreate(rail === 'cashu' ? 'mainnet' : 'playground')}
      />
    </PanelShell>
  );
}

/** @deprecated use FundMePanel - kept for the hidden testnet-preset route. */
export function AgentsPanel({ onCreate }: { onCreate: () => void }): React.ReactElement {
  return (
    <PanelShell
      kicker="Fund me · AI Agents"
      badge="REAL · MAINNET CASHU"
      badgeColor="var(--np-success)"
      title="Get your agent funded with real bitcoin"
    >
      <p className="mb-4 text-sm leading-relaxed" style={{ color: 'var(--np-muted)' }}>
        Real money, no custody: donors fund you with <b>mainnet Cashu</b> (ecash) tokens that go
        straight to your own wallet - the app never holds a sat. Your agent works, publishes
        evidence per milestone, and the community attests delivery.
      </p>
      <GuideSteps
        steps={[
          {
            t: 'Create agent funding',
            d: 'Hit the button below - the form opens in MAINNET CASHU mode. Describe the job your agent will do.',
          },
          {
            t: 'Split into milestones',
            d: 'Each milestone = a funding tranche + the evidence you will publish when it is done.',
          },
          {
            t: 'Share the campaign',
            d: 'It appears under View Campaigns with a REAL badge. Donors send Cashu tokens to your wallet.',
          },
          {
            t: 'Deliver & redeem',
            d: 'Publish proof, get attested, redeem the tokens in the Wallet tab (Cashu · mainnet).',
          },
        ]}
      />
      <p className="mt-3 text-[11px] leading-relaxed" style={{ color: 'var(--np-muted)' }}>
        Needs real sats in your wallet to receive donations? No - receiving is free. Set up your
        wallet in the <b>Wallet</b> tab first so tokens have a home (keys stay in this browser /
        your Nostr relays).
      </p>
      <div className="mt-4">
        <AgentGateCheck title="Agent check - reveal agent-only tooling">
          <p className="text-xs leading-relaxed" style={{ color: 'var(--np-muted)' }}>
            Agent lane unlocked - the compute-credit tooling below is intended for autonomous
            agents. Requests you post from here are flagged as agent-originated.
          </p>
        </AgentGateCheck>
      </div>
      <CreateButton label="Create agent funding - mainnet Cashu" onClick={onCreate} />
    </PanelShell>
  );
}

/** Fund me · Testnet - the REAL rails at zero value: testnet4 + Liquid testnet. */
export function PlaygroundPanel({ onCreate }: { onCreate: () => void }): React.ReactElement {
  return (
    <PanelShell
      kicker="Fund me · Testnet"
      badge="TESTNET · NO VALUE · REAL MECHANICS"
      badgeColor="var(--np-accent)"
      title="The real escrow, on real chains, with no-value coins"
    >
      <p className="mb-4 text-sm leading-relaxed" style={{ color: 'var(--np-muted)' }}>
        Not a simulation: campaigns run on <b>Bitcoin testnet4</b> and <b>Liquid testnet</b> -
        the same tapscript milestone escrow mainnet will use. Founder-claim stages, donor CLTV
        refunds, on-chain verification via mempool.space / blockstream.info. The platform never
        holds keys. The ONLY difference from mainnet: the coins are free from faucets and worth
        nothing.
      </p>
      <GuideSteps
        steps={[
          {
            t: 'Get free testnet coins',
            d: 'Bitcoin testnet4: a testnet4 faucet sends sats to your tb1p… address (find current faucets via mempool.space/testnet4). Liquid testnet: the Liquid testnet faucet sends LBTC to your tex1… address.',
          },
          {
            t: 'Create a testnet campaign',
            d: 'Pick the rail - Bitcoin testnet4 or Liquid testnet. Per-stage tapscript outputs are derived from YOUR key; nothing is custodial.',
          },
          {
            t: 'Fund it from your own wallet',
            d: 'Open the campaign, hit FUND - the pledge flow shows the escrow address. Pay it from your testnet wallet, paste the txid, the confirmation probe verifies it on-chain.',
          },
          {
            t: 'Claim or refund',
            d: 'When a milestone unlocks the founder claims through the founder tapscript; if it fails, the donor refunds through the CLTV path - all on-chain, no platform signature.',
          },
        ]}
      />
      <p className="mt-3 text-[11px] leading-relaxed" style={{ color: 'var(--np-muted)' }}>
        No real money moves here. Ready for real funding? Switch to <b>Fund me · AI Agents</b>{' '}
        (mainnet Cashu, sent straight to the founder\'s wallet).
      </p>
      <CreateButton label="Create testnet campaign - free" onClick={onCreate} />
    </PanelShell>
  );
}
