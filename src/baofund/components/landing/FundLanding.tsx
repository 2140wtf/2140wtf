/**
 * FundLanding - newspaper front-page sections for BAO Fund.
 * Broadsheet structure over the 2140 fund-flow copy, tightened:
 * dual funding lanes, CTAs, 3-step flow, FAQ columns, testnet footnote.
 * Owner (2026-09-19): the front page leads with CAMPAIGNS - tagline copy,
 * the how-it-works flow, funding lanes and the testnet note are collapsed
 * behind expandable <details> to save space.
 */
import React from 'react';
import '../../theme/newspaperTheme.css';

const DISCLOSURE_SUMMARY: React.CSSProperties = {
  cursor: 'pointer',
  fontFamily: 'var(--np-font-mono)',
  color: 'var(--np-ink)',
  fontSize: '10px',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.18em',
  userSelect: 'none' as const,
};

const STEPS: Array<{ n: string; t: string; d: string }> = [
  {
    n: 'I',
    t: 'Pick a campaign',
    d: 'Cards with a REAL badge take mainnet Cashu; the rest run on Bitcoin testnet4 / Liquid testnet (no-value coins).',
  },
  {
    n: 'II',
    t: 'Fund it',
    d: 'Testnet: hit FUND and pay the escrow address from your testnet4 / Liquid wallet. REAL: issue a Cashu token from your wallet.',
  },
  {
    n: 'III',
    t: 'Track delivery',
    d: 'Milestones unlock on attestation (proof → objection window → resolve). Chat with the team per campaign.',
  },
];

/** Collapsed-by-default explainer: how it works + the fund-me lanes + the
 *  testnet note, behind one summary row. The campaigns grid owns the top of
 *  the page; this is reference material for when the user asks for it. */
export function FundIntroCollapsible({
  onPlayground,
  onAgents,
}: {
  onPlayground?: () => void;
  onAgents?: () => void;
} = {}) {
  const [open, setOpen] = React.useState(false);
  return (
    <section className="mt-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid="fund-intro-toggle"
        className="flex w-full items-center justify-between border px-3 py-2 text-[10px] font-bold uppercase tracking-[0.2em]"
        style={{ borderColor: 'var(--np-rule)', color: 'var(--np-muted)', fontFamily: 'var(--np-font-mono)', background: 'transparent' }}
      >
        <span>How ₿AO funding works</span>
        <span aria-hidden>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div data-testid="fund-intro-body">
          <FundHowItWorks />
          <div className="mb-4">
            <FundingLanes onPlayground={onPlayground} onAgents={onAgents} />
          </div>
          <FundTestnetNote />
        </div>
      )}
    </section>
  );
}

export function FundHowItWorks() {
  return (
    <details className="py-3">
      <summary className="mb-2 text-[11px] font-bold uppercase tracking-[0.22em]" style={DISCLOSURE_SUMMARY}>
        From an idea to a funded ₿AO ▾
      </summary>
      <div className="grid gap-4 sm:grid-cols-3">
        {STEPS.map((s) => (
          <div key={s.n} className="border-t-2 pt-2" style={{ borderColor: 'var(--np-ink)' }}>
            <div
              className="mb-1 text-2xl font-bold"
              style={{ fontFamily: 'var(--np-font-serif)', color: 'var(--np-ink)' }}
            >
              {s.n}
            </div>
            <div
              className="mb-1 text-sm font-bold"
              style={{ fontFamily: 'var(--np-font-serif)', color: 'var(--np-ink)' }}
            >
              {s.t}
            </div>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--np-muted)' }}>
              {s.d}
            </p>
          </div>
        ))}
      </div>
    </details>
  );
}

export function FundingLanes({
  onPlayground,
  onAgents,
}: {
  onPlayground?: () => void;
  onAgents?: () => void;
} = {}) {
  const lane = (
    color: string,
    title: string,
    badge: string,
    copy: string,
    onClick?: () => void,
  ) => (
    <button
      type="button"
      onClick={onClick}
      className="border p-3 text-left"
      style={{ borderColor: 'var(--np-rule)', background: 'var(--np-paper)', cursor: onClick ? 'pointer' : 'default' }}
    >
      <div
        className="flex items-center justify-between text-[10px] uppercase tracking-[0.2em]"
        style={{ fontFamily: 'var(--np-font-mono)', color }}
      >
        <span className="font-bold">{title}</span>
        <span className="border px-1.5 py-0.5" style={{ borderColor: color }}>
          {badge}
        </span>
      </div>
      <p className="mt-1.5 text-xs" style={{ color: 'var(--np-muted)' }}>
        {copy}
      </p>
    </button>
  );
  // ONE fund-me flow (owner: "the steps are pretty much similar, unify") -
  // the three rails differ only in coin, so the flow presents the choice
  // and every card lands in the same guided panel.
  return (
    <details className="py-3" open>
      <summary className="mb-2 text-[11px] font-bold uppercase tracking-[0.22em]" style={DISCLOSURE_SUMMARY}>
        Fund me - pick your rail ▾
      </summary>
      <div className="grid gap-3 sm:grid-cols-3">
        {lane(
          'var(--np-accent)',
          'Bitcoin · Testnet4',
          'ON-CHAIN · NO VALUE',
          'REAL tapscript milestone escrow on Bitcoin testnet4 - founder claims, donor CLTV refunds, verifiable on mempool.space. Free faucet coins.',
          onPlayground,
        )}
        {lane(
          'var(--np-accent-2)',
          'Liquid · Testnet',
          'ON-CHAIN · NO VALUE',
          'The identical escrow on Liquid testnet - cheaper, faster blocks. Free LBTC from the Liquid testnet faucet.',
          onPlayground,
        )}
        {lane(
          'var(--np-success)',
          'Mainnet · Cashu',
          'REAL ECASH',
          'Real sats, no custody: donors issue mainnet Cashu tokens that go straight to your wallet. Same attestation flow as testnet.',
          onAgents,
        )}
      </div>
      <p className="mt-2 text-[10px] uppercase tracking-[0.18em]" style={{ color: 'var(--np-muted)', fontFamily: 'var(--np-font-mono)' }}>
        One flow - pick the coin, the steps are the same.
      </p>
    </details>
  );
}

export function FundFaq() {
  const items: Array<{ q: string; a: string }> = [
    {
      q: 'Why use ₿AO Fund?',
      a: 'Milestones make progress auditable; market resolution gates payouts; donors, agents, and courts share one evidence record.',
    },
    {
      q: 'How does access work?',
      a: 'Sign in with a Nostr extension, passkey, or 24-word seed - your identity doubles as your wallet. Testnet coins are free from the public faucets (coinfaucet.eu testnet4 faucet, Liquid testnet faucet).',
    },
    {
      q: 'Testnet vs AI Agents?',
      a: 'Testnet = the real on-chain escrow (Bitcoin testnet4 / Liquid testnet) with no-value coins. Fund me · AI Agents = real mainnet Cashu sent straight to the founder\'s wallet, no custody.',
    },
  ];
  return (
    <section className="grid gap-4 pt-4 sm:grid-cols-3">
      {items.map((i) => (
        <div key={i.q}>
          <div
            className="mb-1 text-[11px] font-bold uppercase tracking-[0.18em]"
            style={{ color: 'var(--np-ink)', fontFamily: 'var(--np-font-mono)' }}
          >
            {i.q}
          </div>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--np-muted)' }}>
            {i.a}
          </p>
        </div>
      ))}
    </section>
  );
}

export function FundTestnetNote() {
  return (
    <details
      className="mt-5 border p-3 text-[11px] leading-relaxed"
      style={{ borderColor: 'var(--np-accent)', background: 'var(--np-accent-dim)' }}
    >
      <summary className="font-bold uppercase tracking-wider" style={{ ...DISCLOSURE_SUMMARY, color: 'var(--np-accent)' }}>
        Testnet · no real money ▾
      </summary>
      <p className="mt-2" style={{ color: 'var(--np-ink)' }}>
        Testnet campaigns run the REAL tapscript escrow on Bitcoin testnet4 / Liquid testnet with
        no-value coins - every pledge is a real on-chain output you can verify on mempool.space or
        blockstream.info. Claim, refund and milestone mechanics are identical to what mainnet will
        run; only the coin value is zero. Delivery is attested (proof → objection window → resolve)
        and the founder receives the escrowed coins when the work is delivered as promised.
      </p>
    </details>
  );
}
