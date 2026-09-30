/**
 * ContributionsPanel - the book of donations for a campaign.
 * Pick a fundraiser (BY TITLE, not the opaque fr_ id - owner, 2026-09-19)
 * → list every pledge (donor, amount, rail, time) fetched from the API and
 * the running total vs goal.
 */
import React, { useEffect, useState } from 'react';
import { baoApiDate, fetchContributions, fetchFundraiser, type BaoContribution } from '../../lib/baoFundraising';
import { safeExplorerHref } from '../../lib/safeUrl';
import '../../theme/newspaperTheme.css';

export function ContributionsPanel({ campaignIds }: { campaignIds: string[] }) {
  const [id, setId] = useState(campaignIds[0] ?? '');
  const [rows, setRows] = useState<BaoContribution[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Dropdown labels: REAL campaign titles (the raw fr_ ids are meaningless
  // to users). Fetched once for the id list; failures degrade to the id.
  const [titles, setTitles] = useState<Record<string, string>>({});
  const campaignKey = campaignIds.join('|');
  useEffect(() => {
    let cancelled = false;
    const ids = campaignKey ? campaignKey.split('|') : [];
    (async () => {
      const entries = await Promise.all(
        ids.map(async (cid) => {
          try {
            const d = await fetchFundraiser(cid);
            return [cid, (d as { fundraiser?: { title?: string } }).fundraiser?.title ?? cid] as const;
          } catch {
            return [cid, cid] as const;
          }
        }),
      );
      if (!cancelled) setTitles(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [campaignKey]);

  // The feed resolves asynchronously - adopt the first campaign id once it
  // arrives, and never point at a campaign that is no longer in the list.
  // Derived during render instead of a setState-in-effect.
  const effectiveId =
    campaignIds.length === 0 || campaignIds.includes(id) ? id : (campaignIds[0] ?? '');

  // Reset the book when the selected campaign changes - the sanctioned
  // render-time adjustment pattern (setState during render with a change
  // guard), so the loading state shows immediately on switch.
  const [prevId, setPrevId] = useState(effectiveId);
  if (prevId !== effectiveId) {
    setPrevId(effectiveId);
    setRows(null);
    setError(null);
  }

  useEffect(() => {
    if (!effectiveId) return;
    let cancelled = false;
    // Async setState only in the effect body - sync resets happen in the
    // guarded render block above.
    fetchContributions(effectiveId)
      .then((c) => {
        if (cancelled) return;
        // A hostile/malformed 200 can carry anything; `rows.reduce` during
        // render must never see a non-array. Fail closed to the error state.
        if (!Array.isArray(c)) {
          setRows(null);
          setError('The contributions feed returned an unexpected payload.');
          return;
        }
        setRows(c);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveId]);

  if (campaignIds.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--np-muted)', fontFamily: 'var(--np-font-mono)' }}>
        No live campaigns yet - create one to see its contribution book.
      </p>
    );
  }

  // Pending (declared, unpaid/unconfirmed) pledges don't count toward the
  // campaign total - they land when the explorer confirms them.
  // Number() coercion: numeric strings (Postgres numeric drift) would
  // otherwise concatenate into a garbage total.
  const amountOf = (r: BaoContribution): number => Number(r.amount_sats) || 0;
  // Gross total: refunded rows stay in the campaign's raised total (the API
  // keeps `raised_sats` gross), but they are broken out so a donor can see
  // what actually stayed. `status` alone never flips on a refund.
  const total = rows ? rows.reduce((s, r) => s + (r.status === 'pending' ? 0 : amountOf(r)), 0) : 0;
  const pendingTotal = rows ? rows.reduce((s, r) => s + (r.status === 'pending' ? amountOf(r) : 0), 0) : 0;
  const refundedTotal = rows
    ? rows.reduce((s, r) => s + (r.refunded_at ? amountOf(r) : 0), 0)
    : 0;

  function statusChip(r: BaoContribution): React.ReactElement {
    const mono = { fontFamily: 'var(--np-font-mono)' } as const;
    if (r.refunded_at) {
      return <span className="text-[10px]" style={{ ...mono, color: 'var(--np-danger, #b3261e)' }}>refunded</span>;
    }
    if (r.refund_initiated_at) {
      return <span className="text-[10px]" style={{ ...mono, color: 'var(--np-accent-2)' }}>refund pending</span>;
    }
    if (r.status === 'escrowed') {
      return <span className="text-[10px]" style={{ ...mono, color: 'var(--np-success)' }}>escrowed ✓</span>;
    }
    if (r.status === 'confirmed') {
      return <span className="text-[10px]" style={{ ...mono, color: 'var(--np-success)' }}>confirmed ✓</span>;
    }
    if (r.status === 'pending') {
      return (
        <span className="text-[10px]" style={{ ...mono, color: 'var(--np-accent-2)' }}>
          {r.reference ? 'confirming…' : 'awaiting payment'}
        </span>
      );
    }
    return <span className="text-[10px]" style={{ ...mono, color: 'var(--np-muted)' }}>{r.status ?? 'recorded'}</span>;
  }

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3
          className="text-[11px] font-bold uppercase tracking-[0.22em]"
          style={{ color: 'var(--np-accent)', fontFamily: 'var(--np-font-mono)' }}
        >
          Contributions - who funded what
        </h3>
        <select
          value={effectiveId}
          onChange={(e) => setId(e.target.value)}
          className="border px-2 py-1 text-xs outline-none"
          style={{ borderColor: 'var(--np-rule)', fontFamily: 'var(--np-font-mono)' }}
        >
          {campaignIds.map((c) => (
            <option key={c} value={c}>{titles[c] ?? c}</option>
          ))}
        </select>
      </div>

      <div
        className="border"
        style={{ borderColor: 'var(--np-rule)', background: 'var(--np-paper)' }}
      >
        <div
          className="flex border-b px-3 py-1.5 text-[10px] uppercase tracking-widest"
          style={{ borderColor: 'var(--np-rule)', color: 'var(--np-muted)', fontFamily: 'var(--np-font-mono)' }}
        >
          <span className="w-28 shrink-0">Donor</span>
          <span className="flex-1 text-right">Sats</span>
          <span className="w-24 text-right">Rail</span>
          <span className="w-32 text-right">Status</span>
          <span className="w-28 shrink-0 text-right">When</span>
        </div>
        {rows === null && (
          <div className="px-3 py-3 text-xs" style={{ color: 'var(--np-muted)' }}>
            {error ? `Failed to load: ${error}` : 'Loading contributions…'}
          </div>
        )}
        {rows?.length === 0 && (
          <div className="px-3 py-3 text-xs" style={{ color: 'var(--np-muted)' }}>
            No contributions yet - fund it from the Testnet tab.
          </div>
        )}
        {rows?.map((r) => (
          <div
            key={r.id}
            className="flex border-b px-3 py-1.5 text-xs last:border-b-0"
            style={{ borderColor: 'var(--np-rule)' }}
          >
            <span className="w-28 shrink-0" style={{ fontFamily: 'var(--np-font-mono)' }}>
              {(r.contributor_pubkey ?? '').slice(0, 10)}…
            </span>
            <span className="flex-1 text-right" style={{ fontFamily: 'var(--np-font-mono)' }}>
              {r.amount_sats.toLocaleString()}
            </span>
            <span className="w-24 text-right" style={{ fontFamily: 'var(--np-font-mono)' }}>
              {r.rail}
            </span>
            <span className="w-32 text-right">
              {statusChip(r)}
              {r.explorer_tx_url && safeExplorerHref(r.explorer_tx_url) && (
                <a href={safeExplorerHref(r.explorer_tx_url)!} target="_blank" rel="noreferrer noopener"
                  className="ml-1 text-[10px] underline"
                  style={{ color: 'var(--np-accent-2)', fontFamily: 'var(--np-font-mono)' }}>
                  verify ↗</a>
              )}
            </span>
            <span className="w-28 shrink-0 text-right" style={{ fontFamily: 'var(--np-font-mono)' }}>
              {(baoApiDate(r.created_at) ?? new Date(0)).toLocaleDateString()}
            </span>
          </div>
        ))}
        {rows && (
          <div
            className="flex justify-between px-3 py-2 text-xs font-bold"
            style={{ fontFamily: 'var(--np-font-mono)', color: 'var(--np-ink)' }}
          >
            <span>
              Total{pendingTotal > 0 ? ` (+${pendingTotal.toLocaleString()} pending)` : ''}
              {refundedTotal > 0 ? ` (${refundedTotal.toLocaleString()} refunded)` : ''}
            </span>
            <span>{total.toLocaleString()} sats</span>
          </div>
        )}
      </div>
    </section>
  );
}
