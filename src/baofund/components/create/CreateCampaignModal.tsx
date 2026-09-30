/**
 * CreateCampaignModal - create a milestone-based campaign.
 *
 * Two modes, switchable inside the modal:
 *  - TESTNET: ₿AO testnet rails - Bitcoin testnet4 (scripted escrow, zero
 *    platform keys) and Liquid testnet. NO VALUE coins; same mechanics as
 *    mainnet so the move to production is a parameter change, not a rewrite.
 *    Nothing moves on-chain.
 *  - MAINNET CASHU: real money - donors send mainnet ecash tokens straight
 *    to the founder's wallet; the campaign is marked [rail:mainnet-cashu]
 *    (interim signalling until the API grows a settlement-network field).
 */
import React, { useState } from 'react';
import { createFundraiser, railLabel, type CreateMilestoneInput, type SignerLike } from '../../lib/baoFundraising';
import { createGuestSigner, getGuestPubkeyHex } from '../../relay/guestIdentity';
import { publishCampaignCard } from '../../relay/publishCampaignCard';
import { markMainnetCashu } from '../../lib/cashu/mainnetMarker';
import { useAuth } from '../../auth/useAuth';
import '../../theme/newspaperTheme.css';
import { errorMessage } from '../../lib/errors';

const CATEGORIES = ['infra', 'tools', 'compute', 'attestation', 'content', 'research', 'other'];

export type CreateMode = 'playground' | 'mainnet';

interface MsRow {
  title: string;
  amount: string;
  criteria?: string;
}

function ModeCard({
  active,
  color,
  title,
  badge,
  children,
  onClick,
}: {
  active: boolean;
  color: string;
  title: string;
  badge: string;
  children: React.ReactNode;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 border p-3 text-left"
      style={{
        borderColor: active ? color : 'var(--np-rule)',
        background: active ? 'var(--np-bg)' : 'transparent',
        outline: active ? `2px solid ${color}` : 'none',
        outlineOffset: -2,
      }}
    >
      <div
        className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-[0.16em]"
        style={{ fontFamily: 'var(--np-font-mono)', color }}
      >
        <span className="font-bold">{title}</span>
        <span className="border px-1 py-0.5" style={{ borderColor: color }}>{badge}</span>
      </div>
      <p className="text-[11px] leading-relaxed" style={{ color: 'var(--np-muted)' }}>
        {children}
      </p>
    </button>
  );
}

/** Plain-language meaning of each room gate, shown under the selector. The
 *  wording matches what the stack actually enforces today (see AGENTS.md
 *  "Campaign-room admission + registry wiring"): only `invite` changes the
 *  protocol policy; `donors` hides the link from non-contributors at the API;
 *  `follows` is not enforced yet and currently behaves like `open`. */
const ROOM_GATE_HELP: Record<'open' | 'invite' | 'follows' | 'donors', string> = {
  open: 'Open - anyone who receives the link can join. The campaign page shows the link only to you and to contributors; everyone else sees a "contribute first" gate.',
  invite: 'Invite-only - the room is hidden (protocol policy: invite); you hand out personal invite links and can revoke them.',
  follows: 'Followers - meant for your Nostr followers. Enforcement is not live yet, so today the room behaves like Open.',
  donors: 'Donors - the room link is shown only to contributors; anyone who receives the link can join. Today this behaves like Open - the donor admission menu was removed.',
};

export function CreateCampaignModal({
  defaultMode = 'playground',
  onCreated,
  onDone,
  onClose,
}: {
  defaultMode?: CreateMode;
  /** Fired after the campaign exists and before onDone closes the modal -
   *  lets the host join the provisioned campaign room with the same signer
   *  that created the campaign (guest signers included). */
  onCreated?: (info: { fundraiserId: string; title: string; roomRequested: boolean }, signer: SignerLike) => void;
  onDone: (msg: string) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<CreateMode>(defaultMode);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [goal, setGoal] = useState('21400');
  const [category, setCategory] = useState('tools');
  const [rail, setRail] = useState<'l1' | 'liquid'>('l1');
  // Every campaign gets its discussion room: the checkbox is pre-ticked and
  // locked (owner rule 2026-09-23) - the room is the funding entry point.
  const wantRoom = true;
  const [roomGate, setRoomGate] = useState<'open' | 'invite' | 'follows' | 'donors'>('open');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const auth = useAuth();
  const [rows, setRows] = useState<MsRow[]>([{ title: '', amount: '', criteria: '' }]);

  const mainnet = mode === 'mainnet';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // A row the founder has started typing in must be complete: silently
      // dropping it (the old title+amount filter) created campaigns with
      // fewer milestones than the form showed. Only completely empty rows
      // are ignored.
      const started = rows.filter(
        (r) => r.title.trim() || r.amount.trim() || (r.criteria?.trim().length ?? 0) > 0,
      );
      // Server rule: every milestone needs a ≥50-char delivery description.
      // Fail fast client-side with the same message instead of a round-trip.
      for (const r of started) {
        if (!r.title.trim()) {
          throw new Error('Every milestone row needs a title - remove the row or name the milestone.');
        }
        const sats = Number(r.amount);
        if (!Number.isFinite(sats) || sats <= 0) {
          throw new Error(
            `Milestone "${r.title.trim().slice(0, 40)}" needs an amount in sats greater than zero.`,
          );
        }
        if ((r.criteria?.trim().length ?? 0) < 50) {
          throw new Error(
            `Milestone "${r.title.trim().slice(0, 40)}" needs a description of at least 50 characters - explain what will be delivered and how funders can verify it.`,
          );
        }
      }
      if (started.length === 0 && description.trim().length < 50) {
        throw new Error(
          'Add a milestone with a ≥50-character delivery description (what will be delivered, how funders verify it).',
        );
      }
      const milestones: CreateMilestoneInput[] = started
        .map((r) => ({
          title: r.title.trim(),
          amount_sats: Math.round(Number(r.amount)),
          description: r.criteria?.trim() || undefined,
          criteria: r.criteria?.trim() || undefined,
        }));
      if (mainnet && !auth.signer) {
        throw new Error('Sign in to launch a mainnet campaign - real campaigns need your key (no guest fallback).');
      }
      const signer = auth.signer ?? createGuestSigner();
      const res = await createFundraiser(signer, {
        title: title.trim(),
        description: mainnet ? markMainnetCashu(description.trim()) : description.trim() || undefined,
        runner_type: 'human',
        goal_sats: Math.round(Number(goal || 21400)),
        settlement_rail: mainnet ? 'cashu' : rail,
        // First-class network field (API-supported); the description marker
        // stays as fallback for older deployments and older clients.
        network: mainnet ? 'mainnet' : 'testnet',
        format: 'milestones',
        category,
        discussion_room: { enabled: wantRoom, gate: roomGate },
        milestones: milestones.length
          ? milestones
          : [{
              title: title.trim() || 'Milestone 1',
              amount_sats: Math.round(Number(goal || 21400)),
              description: description.trim(),
              criteria: description.trim(),
            }],
      });
      // Relay-native discovery: publish the signed kind-39801 card. The
      // campaign already exists (API/ledger), so a relay-policy rejection is
      // reported and never fails creation.
      void publishCampaignCard({
        signer,
        fundraiser: res.fundraiser,
        milestones: res.milestones,
      }).then((r) => {
        if (!r.ok) console.warn('[cards] campaign card not published:', r.error);
      });
      // Founder sees their own room: join it with the creating signer so it
      // lands in the Chat sidebar and opens selected.
      onCreated?.(
        { fundraiserId: res.fundraiser.id, title: title.trim(), roomRequested: wantRoom },
        signer,
      );
      onDone(
        mainnet
          ? `Mainnet-Cashu campaign created: ${res.fundraiser.id.slice(0, 10)} - donors fund you with real ecash`
          : `Testnet campaign created: ${res.fundraiser.id.slice(0, 10)} - ${railLabel(rail)} · NO VALUE coins`,
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true">
      <div className="absolute inset-0" style={{ background: 'rgba(26,26,26,0.45)' }} onClick={onClose} />
      <form
        onSubmit={submit}
        className="relative mx-auto my-8 w-[min(94vw,44rem)] border p-5"
        style={{ background: 'var(--np-paper)', borderColor: 'var(--np-ink)', boxShadow: 'var(--np-shadow)' }}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--np-font-serif)', color: 'var(--np-ink)' }}>
            Create a campaign
          </h2>
          <span className="text-[10px] uppercase tracking-widest" style={{ color: mainnet ? 'var(--np-success)' : 'var(--np-muted)' }}>
            {mainnet ? 'REAL · mainnet cashu' : 'TESTNET · no value'} · {(auth.pubkey ?? getGuestPubkeyHex()).slice(0, 8)}
          </span>
        </div>

        {/* Rail switch - the core choice: testnet (no value) vs mainnet cashu. */}
        <div className="mb-4 flex flex-col gap-2 sm:flex-row">
          <ModeCard
            active={!mainnet}
            color="var(--np-accent)"
            title="Testnet"
            badge="NO VALUE · TESTNET4 / LIQUID"
            onClick={() => setMode('playground')}
          >
            Bitcoin testnet4 or Liquid testnet coins - real chain mechanics (scripted
            escrow, CLTV, on-chain verification) with zero-value coins. Free from faucets.
          </ModeCard>
          <ModeCard
            active={mainnet}
            color="var(--np-success)"
            title="Mainnet Cashu"
            badge="REAL MONEY"
            onClick={() => setMode('mainnet')}
          >
            Donors send real ecash tokens straight to your wallet. No custody, no chargebacks.
          </ModeCard>
        </div>

        <label className="mb-3 block">
          <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} required
            className="mt-1 w-full border px-2 py-1.5 text-sm outline-none" style={{ borderColor: 'var(--np-rule)', fontFamily: 'var(--np-font-serif)' }} />
        </label>
        <label className="mb-3 block">
          <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>Description</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
            className="mt-1 w-full border px-2 py-1.5 text-sm outline-none" style={{ borderColor: 'var(--np-rule)' }} />
        </label>
        <div className="mb-3 border p-2" style={{ borderColor: 'var(--np-rule)' }}>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked disabled data-testid="discussion-room-enabled" />
              <span className="text-xs" style={{ color: 'var(--np-ink)' }}>Discussion room (always created)</span>
            </label>
            <select value={roomGate} onChange={(e) => setRoomGate(e.target.value as typeof roomGate)}
              aria-label="Who can join the room"
              data-testid="discussion-room-gate"
              className="ml-auto border px-1 py-0.5 text-xs" style={{ borderColor: 'var(--np-rule)' }}>
              <option value="open">Open - anyone</option>
              <option value="invite">Invite-only - personal links</option>
              <option value="follows">Followers - your Nostr followers</option>
              <option value="donors">Donors - contributors only</option>
            </select>
          </div>
          <p data-testid="discussion-room-help" className="mt-2 text-[10px]" style={{ color: 'var(--np-muted)' }}>
            {ROOM_GATE_HELP[roomGate]}
          </p>
        </div>
        <p className="mb-3 text-[10px]" style={{ color: 'var(--np-muted)' }}>
          Rooms are encrypted, un-scrapable scrolls (BAO Community protocol); the operator API provisions
          the room when the campaign is created.
        </p>
        <div className="mb-3 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>
              Goal ({mainnet ? 'real sats' : 'testnet sats'})
            </span>
            <input type="number" min={1} value={goal} onChange={(e) => setGoal(e.target.value)} required
              className="mt-1 w-full border px-2 py-1.5 text-sm outline-none" style={{ borderColor: 'var(--np-rule)', fontFamily: 'var(--np-font-mono)' }} />
          </label>
          {!mainnet && (
            <label className="block">
              <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>Testnet rail</span>
              <div className="mt-1 space-y-1">
                <label className="flex items-start gap-2 border px-2 py-1.5 text-xs"
                  style={{ borderColor: rail === 'l1' ? 'var(--np-ink)' : 'var(--np-rule)' }}>
                  <input type="radio" name="testnet-rail" value="l1" checked={rail === 'l1'}
                    onChange={() => setRail('l1')} data-testid="rail-l1" className="mt-0.5" />
                  <span>
                    <b>Bitcoin testnet4</b> - on-chain scripted escrow (tb1p address;
                    free coins from the mempool.space testnet4 faucet).
                  </span>
                </label>
                <label className="flex items-start gap-2 border px-2 py-1.5 text-xs"
                  style={{ borderColor: rail === 'liquid' ? 'var(--np-ink)' : 'var(--np-rule)' }}>
                  <input type="radio" name="testnet-rail" value="liquid" checked={rail === 'liquid'}
                    onChange={() => setRail('liquid')} data-testid="rail-liquid" className="mt-0.5" />
                  <span>
                    <b>Liquid testnet</b> - on-chain scripted escrow (LBTC;
                    free coins from the Liquid testnet faucet).
                  </span>
                </label>
              </div>
              <span className="mt-1 block text-[10px]" style={{ color: 'var(--np-muted)' }}>
                Both rails run the SAME tapscript milestone escrow: founder-claim stages,
                donor CLTV refunds - the platform never holds keys. Testnet coins are free
                and carry no value.
              </span>
            </label>
          )}
          <label className="block">
            <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)}
              className="mt-1 w-full border px-2 py-1.5 text-sm outline-none" style={{ borderColor: 'var(--np-rule)' }}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>

        <div className="mb-2 text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>
          Milestones - each one a funding goal
        </div>
        {mainnet ? (
          <p className="mb-3 border p-2 text-[11px] leading-relaxed" style={{ borderColor: 'var(--np-success)', color: 'var(--np-ink)', background: 'var(--np-bg)' }}>
            <b>Real money.</b> Donors fund this campaign with mainnet Cashu tokens sent directly to
            your wallet (Wallet tab → Cashu · mainnet). The campaign record lives on the API
            for discovery and milestone tracking, but the money itself never touches our servers.
          </p>
        ) : (
          <p className="mb-3 text-[11px]" style={{ color: 'var(--np-muted)' }}>
            On testnet, pledges are REAL on-chain payments (Bitcoin testnet4 / Liquid testnet) into
            the campaign's tapscript escrow - founder claims on verified milestones, donors refund
            via CLTV on failure. Coins have NO VALUE (free from faucets) but every mechanic is what
            mainnet runs. Switch to Mainnet Cashu above for real funding.
          </p>
        )}
        {rows.map((r, i) => (
          <div key={i} className="mb-3 border p-2" style={{ borderColor: 'var(--np-rule)' }}>
            <div className="grid grid-cols-[1fr_6rem_auto] gap-2">
              <input placeholder="Milestone goal - what this tranche funds" value={r.title}
                onChange={(ev) => setRows(rows.map((x, j) => (j === i ? { ...x, title: ev.target.value } : x)))}
                className="border px-2 py-1 text-sm outline-none" style={{ borderColor: 'var(--np-rule)' }} />
              <input type="number" min={1} placeholder="sats" value={r.amount}
                onChange={(ev) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: ev.target.value } : x)))}
                className="border px-2 py-1 text-sm outline-none" style={{ borderColor: 'var(--np-rule)', fontFamily: 'var(--np-font-mono)' }} />
              <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))}
                className="px-2 text-sm" style={{ color: 'var(--np-danger)' }}>×</button>
            </div>
            <textarea rows={3} placeholder="What must be achieved for these sats - min 50 chars: what will be delivered + how funders verify it"
              value={r.criteria ?? ''}
              onChange={(ev) => setRows(rows.map((x, j) => (j === i ? { ...x, criteria: ev.target.value } : x)))}
              className="mt-2 w-full resize-y border px-2 py-1 text-sm outline-none"
              style={{ borderColor: 'var(--np-rule)', width: '100%', boxSizing: 'border-box' }} />
          </div>
        ))}
        <button type="button" onClick={() => setRows([...rows, { title: '', amount: '', criteria: '' }])}
          className="mb-2 text-[11px] uppercase tracking-widest" style={{ color: 'var(--np-accent)', fontFamily: 'var(--np-font-mono)' }}>
          + add milestone
        </button>
        <p className="mb-4 text-[11px]" style={{ color: 'var(--np-muted)' }}>
          Each milestone needs a ≥50-character delivery description. Sats unlock when delivery is
          attested (proof → objection window → resolve).
        </p>

        {error && <p className="mb-3 text-xs" style={{ color: 'var(--np-danger)' }}>{error}</p>}
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="px-4 py-1.5 text-[11px] uppercase tracking-widest" style={{ color: 'var(--np-muted)', fontFamily: 'var(--np-font-mono)' }}>
            Cancel
          </button>
          <button type="submit" disabled={busy}
            className="px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest"
            style={{ fontFamily: 'var(--np-font-mono)', color: 'var(--np-on-accent)', background: mainnet ? 'var(--np-success)' : 'var(--np-accent)', border: `1px solid ${mainnet ? 'var(--np-success)' : 'var(--np-accent)'}` }}>
            {busy ? 'Creating…' : mainnet ? 'Create - mainnet Cashu' : 'Create - testnet'}
          </button>
        </div>
      </form>
    </div>
  );
}
