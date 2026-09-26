/**
 * MintDiscovery - NIP-87 mint discovery for the wallet (2140 parity).
 *
 * Discovers Cashu mints from public relays (kind-38172 announcements +
 * kind-38000 recommendations), ranked by mainnet/NUT support/ratings, and
 * adds one to the multi-mint wallet with a single click. Signed-in users can
 * scope the recommendations to the people they follow.
 */
import React from 'react';
import type { Event } from 'nostr-tools';
import { Globe, Landmark, Search, Star, Users, X } from 'lucide-react';
import { useAuth } from '../auth/useAuth';
import {
  buildMintRecommendationEvent,
  discoverMints,
  fetchFollowPubkeys,
  fetchMintAudit,
  fetchMintInfo,
  getPublishedReview,
  parseDiscoveryRelays,
  parseMintRecommendation,
  publishMintRecommendation,
  rememberPublishedReview,
  reviewCooldownRemainingMs,
  upsertRecommendation,
  type DiscoveredMint,
  type MintAuditSummary,
  type MintInfoSummary,
} from './mintDiscovery';

export interface MintDiscoveryProps {
  /** Normalized URLs already in the wallet (rendered as "Added"). */
  addedUrls: ReadonlySet<string>;
  /** Add (and activate) a mint. */
  onAdd: (url: string) => Promise<void>;
  /** Wallet operation in flight - disables Add. */
  busy?: boolean;
}

type Scope = 'global' | 'follows';

/** Test-network mints are never addable (owner rule: no signet wallet). */
const TEST_NETWORKS = new Set(['testnet', 'signet', 'regtest']);

function NutBadge({ nut }: { nut: number }): React.ReactElement {
  return (
    <span className="rounded border px-1 text-[9px] font-mono" style={{ borderColor: 'var(--np-rule)', color: 'var(--np-muted)' }}>
      NUT-{nut}
    </span>
  );
}

export function MintDiscovery({ addedUrls, onAdd, busy = false }: MintDiscoveryProps): React.ReactElement {
  const { pubkey, signer } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [mints, setMints] = React.useState<DiscoveredMint[]>([]);
  const [search, setSearch] = React.useState('');
  const [scope, setScope] = React.useState<Scope>('global');
  const [adding, setAdding] = React.useState<string | null>(null);
  // Per-mint details expander: /v1/info + audit.8333.space, fetched on demand.
  const [details, setDetails] = React.useState<Record<string, { loading: boolean; info: MintInfoSummary | null; audit: MintAuditSummary | null }>>({});
  // Review composer state (per mint), the publish guard and the local echo.
  const [reviewDraft, setReviewDraft] = React.useState<Record<string, { rating: number; content: string }>>({});
  const [reviewBusy, setReviewBusy] = React.useState<string | null>(null);
  const [reviewNote, setReviewNote] = React.useState<string | null>(null);
  const [nowMs, setNowMs] = React.useState(() => Date.now());

  // Cooldown countdown re-render (30s) while the panel is open.
  React.useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [open]);

  /** The on-relay / local-echo values when no draft exists yet. */
  const derivedFor = React.useCallback((mint: DiscoveredMint): { rating: number; content: string } => {
    const mine = pubkey
      ? mint.recommendations.find((r) => r.author.toLowerCase() === pubkey.toLowerCase())
      : undefined;
    const published = pubkey ? getPublishedReview(pubkey, mint.url) : null;
    return {
      rating: published?.rating ?? mine?.rating ?? 0,
      content: published?.content ?? mine?.content ?? '',
    };
  }, [pubkey]);

  /** The composer's current values: draft → published local echo → on-relay review. */
  const draftFor = React.useCallback((mint: DiscoveredMint): { rating: number; content: string } => (
    reviewDraft[mint.url] ?? derivedFor(mint)
  ), [reviewDraft, derivedFor]);

  const patchDraft = (mint: DiscoveredMint, patch: Partial<{ rating: number; content: string }>): void => {
    // Merge against the LATEST draft inside the updater: two edits in the same
    // tick (star + text) must not clobber each other via a stale closure.
    setReviewDraft((prev) => ({
      ...prev,
      [mint.url]: { ...(prev[mint.url] ?? derivedFor(mint)), ...patch },
    }));
  };

  const publishReview = async (mint: DiscoveredMint): Promise<void> => {
    if (!pubkey || !signer) return;
    const draft = draftFor(mint);
    setReviewBusy(mint.url);
    setReviewNote(null);
    try {
      const template = buildMintRecommendationEvent({
        mintUrl: mint.url,
        mintId: mint.announcement?.mintId,
        rating: draft.rating > 0 ? draft.rating : undefined,
        content: draft.content,
      });
      const signed = await signer.signEvent(template) as unknown as Event;
      const delivered = await publishMintRecommendation(
        parseDiscoveryRelays(import.meta.env?.VITE_BAO_MINT_DISCOVERY_RELAYS),
        signed,
      );
      if (delivered === 0) throw new Error('No discovery relay accepted the review - try again');
      const parsed = parseMintRecommendation(signed);
      if (parsed) setMints((prev) => upsertRecommendation(prev, parsed));
      rememberPublishedReview(pubkey, mint.url, {
        ...(draft.rating > 0 ? { rating: draft.rating } : {}),
        content: draft.content.trim().slice(0, 500),
      });
      setNowMs(Date.now());
      setReviewNote(`Review published to ${delivered} relay${delivered === 1 ? '' : 's'} - it is live locally now.`);
    } catch (err) {
      setReviewNote(err instanceof Error ? err.message : 'Could not publish the review');
    } finally {
      setReviewBusy(null);
    }
  };

  const toggleDetails = (url: string): void => {
    setDetails((prev) => {
      if (prev[url]) {
        const next = { ...prev };
        delete next[url];
        return next;
      }
      return { ...prev, [url]: { loading: true, info: null, audit: null } };
    });
    if (details[url]) return;
    void (async () => {
      const [info, audit] = await Promise.all([fetchMintInfo(url), fetchMintAudit(url)]);
      setDetails((prev) => (prev[url] ? { ...prev, [url]: { loading: false, info, audit } } : prev));
    })();
  };
  const loadedRef = React.useRef(false);
  // Latest-request guard: scope switches can overlap (follows does a kind-3
  // fetch first); only the newest request may apply its result.
  const requestSeq = React.useRef(0);

  const load = React.useCallback(async (nextScope: Scope): Promise<void> => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      let followPubkeys: string[] | undefined;
      if (nextScope === 'follows' && pubkey) {
        followPubkeys = await fetchFollowPubkeys(pubkey);
      }
      // Follows scope ALWAYS filters recommendations by the fetched set (an
      // empty set shows announcements only) - never silently global results
      // under the follows toggle.
      const found = await discoverMints(nextScope === 'follows' ? { followPubkeys: followPubkeys ?? [] } : {});
      if (seq !== requestSeq.current) return;
      setMints(found);
      loadedRef.current = true;
      if (found.length === 0) {
        setError(
          nextScope === 'follows'
            ? 'No mints recommended by the people you follow.'
            : 'No mints found on the discovery relays - try again later.',
        );
      }
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setError(err instanceof Error ? err.message : 'Mint discovery failed');
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [pubkey]);

  // A different signed-in account must not keep the previous account's scope
  // results; allow a retry after an error (loadedRef resets on failure).
  React.useEffect(() => {
    requestSeq.current += 1;
    loadedRef.current = false;
    // Deferred to a microtask: external-system sync without a reachable
    // synchronous setState in the effect body (react-perf rule).
    void Promise.resolve().then(() => {
      setMints([]);
      setError(null);
      // The stale in-flight load's finally no longer owns loading; clear it
      // here or the panel spins forever.
      setLoading(false);
      if (open) void load(scope);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebinding on account change only
  }, [pubkey]);

  const toggle = (): void => {
    const next = !open;
    setOpen(next);
    if (next && !loadedRef.current) void load(scope);
  };

  const switchScope = (next: Scope): void => {
    if (next === scope) return;
    setScope(next);
    void load(next);
  };

  const add = async (url: string): Promise<void> => {
    setAdding(url);
    setError(null);
    try {
      await onAdd(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that mint');
    } finally {
      setAdding(null);
    }
  };

  const normalizedSearch = search.trim().toLowerCase();
  const filtered = normalizedSearch
    ? mints.filter((m) => {
        const haystack = [
          m.url,
          m.name ?? '',
          m.description ?? '',
          m.network,
          ...m.nuts.map((n) => `nut-${n}`),
        ];
        return haystack.some((v) => v.toLowerCase().includes(normalizedSearch));
      })
    : mints;

  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={toggle}
        data-testid="mint-discovery-toggle"
        className="flex w-full items-center gap-2 rounded border px-2 py-1.5 text-xs"
        style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
      >
        <Landmark size={13} />
        <span className="flex-1 text-left">Discover mints</span>
        <span className="text-[10px]" style={{ color: 'var(--np-muted)' }}>
          {open ? 'hide' : 'NIP-87'}
        </span>
      </button>

      {open && (
        <div className="mt-2 border p-2" style={{ borderColor: 'var(--np-rule)' }} data-testid="mint-discovery-panel">
          <div className="mb-2 flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2" style={{ color: 'var(--np-muted)' }} />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, URL, network, NUT…"
                aria-label="Search Cashu mints"
                data-testid="mint-discovery-search"
                className="w-full rounded border bg-transparent py-1 pl-7 pr-7 text-xs"
                style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
              />
              {search && (
                <button
                  type="button"
                  aria-label="Clear mint search"
                  onClick={() => setSearch('')}
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-1"
                  style={{ color: 'var(--np-muted)' }}
                >
                  <X size={11} />
                </button>
              )}
            </div>
            {pubkey && (
              <div className="flex items-center gap-1" role="group" aria-label="Discovery scope">
                <button
                  type="button"
                  onClick={() => switchScope('global')}
                  title="Everyone"
                  aria-pressed={scope === 'global'}
                  className="rounded border p-1"
                  style={{
                    borderColor: scope === 'global' ? 'var(--np-accent)' : 'var(--np-rule)',
                    color: scope === 'global' ? 'var(--np-accent)' : 'var(--np-muted)',
                  }}
                >
                  <Globe size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => switchScope('follows')}
                  title="People you follow"
                  aria-pressed={scope === 'follows'}
                  className="rounded border p-1"
                  style={{
                    borderColor: scope === 'follows' ? 'var(--np-accent)' : 'var(--np-rule)',
                    color: scope === 'follows' ? 'var(--np-accent)' : 'var(--np-muted)',
                  }}
                >
                  <Users size={12} />
                </button>
              </div>
            )}
          </div>

          {loading && (
            <p className="text-[11px]" style={{ color: 'var(--np-muted)' }} data-testid="mint-discovery-loading">
              Searching NIP-87 relays…
            </p>
          )}
          {!loading && error && (
            <p className="text-[11px]" style={{ color: 'var(--np-error, #b91c1c)' }} data-testid="mint-discovery-error">
              {error}
            </p>
          )}
          {!loading && !error && filtered.length === 0 && (
            <p className="text-[11px]" style={{ color: 'var(--np-muted)' }}>
              {normalizedSearch ? 'No mints match that search.' : 'No mints found.'}
            </p>
          )}

          {!loading && filtered.length > 0 && (
            <ul className="max-h-64 space-y-1 overflow-y-auto" data-testid="mint-discovery-list">
              {filtered.slice(0, 30).map((mint) => {
                const added = addedUrls.has(mint.url);
                return (
                  <li
                    key={mint.url}
                    className="rounded border px-2 py-1.5"
                    style={{ borderColor: 'var(--np-rule)' }}
                    data-testid="mint-discovery-item"
                  >
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-semibold" style={{ color: 'var(--np-ink)' }}>
                          {mint.name ?? mint.url}
                        </div>
                        <div className="truncate text-[10px] font-mono" style={{ color: 'var(--np-muted)' }}>
                          {mint.url}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={added || busy || adding === mint.url || TEST_NETWORKS.has(mint.network)}
                        onClick={() => void add(mint.url)}
                        data-testid={`mint-add-${mint.url}`}
                        title={TEST_NETWORKS.has(mint.network) ? 'Test-network mints cannot be added to the wallet' : undefined}
                        className="rounded border px-2 py-1 text-[10px] uppercase tracking-widest disabled:opacity-50"
                        style={{ borderColor: 'var(--np-rule)', color: added ? 'var(--np-success)' : 'var(--np-ink)' }}
                      >
                        {added ? 'Added' : adding === mint.url ? '…' : TEST_NETWORKS.has(mint.network) ? 'test' : 'Add'}
                      </button>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {mint.network === 'mainnet' ? (
                        <span className="rounded border px-1 text-[9px] font-mono" style={{ borderColor: 'var(--np-success)', color: 'var(--np-success)' }}>
                          mainnet
                        </span>
                      ) : (
                        <span className="rounded border px-1 text-[9px] font-mono" style={{ borderColor: 'var(--np-rule)', color: 'var(--np-muted)' }}>
                          {mint.network}
                        </span>
                      )}
                      {mint.recommendations.length > 0 && (
                        <span className="flex items-center gap-0.5 text-[9px]" style={{ color: 'var(--np-muted)' }}>
                          <Users size={9} /> {mint.recommendations.length} rec{mint.recommendations.length === 1 ? '' : 's'}
                        </span>
                      )}
                      {mint.avgRating !== undefined && (
                        <span className="flex items-center gap-0.5 text-[9px]" style={{ color: 'var(--np-muted)' }}>
                          <Star size={9} /> {mint.avgRating.toFixed(1)}
                        </span>
                      )}
                      {mint.nuts.slice(0, 6).map((nut) => (
                        <NutBadge key={nut} nut={nut} />
                      ))}
                    </div>
                    {mint.description && (
                      <p className="mt-1 line-clamp-2 text-[10px]" style={{ color: 'var(--np-muted)' }}>
                        {mint.description}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => toggleDetails(mint.url)}
                      data-testid={`mint-details-${mint.url}`}
                      className="mt-1 text-[10px] underline"
                      style={{ color: 'var(--np-muted)' }}
                    >
                      {details[mint.url] ? 'hide details' : 'details'}
                    </button>
                    {details[mint.url] && (
                      <div className="mt-1 text-[10px]" style={{ color: 'var(--np-muted)', fontFamily: 'var(--np-font-mono)' }}>
                        {details[mint.url].loading ? (
                          <span>loading mint info…</span>
                        ) : (
                          <>
                            {details[mint.url].info ? (
                              <>
                                {details[mint.url].info!.name && <div>{details[mint.url].info!.name} {details[mint.url].info!.version ? `v${details[mint.url].info!.version}` : ''}</div>}
                                {details[mint.url].info!.motd && <div>mint message: {details[mint.url].info!.motd}</div>}
                                <div>
                                  {details[mint.url].info!.units.join('/') || 'sat'}
                                  {details[mint.url].info!.methods.length > 0 ? ` · ${details[mint.url].info!.methods.join('/')}` : ''}
                                  {details[mint.url].info!.nuts.length > 0 ? ` · NUTs ${details[mint.url].info!.nuts.join(',')}` : ''}
                                </div>
                              </>
                            ) : (
                              <div>mint info unavailable.</div>
                            )}
                            {details[mint.url].audit ? (
                              <div>
                                audit: {details[mint.url].audit!.successRate}% success ({details[mint.url].audit!.successfulSwaps}/{details[mint.url].audit!.totalSwaps} swaps)
                                {details[mint.url].audit!.averageTimeMs !== null ? ` · avg ${Math.round(details[mint.url].audit!.averageTimeMs!)} ms` : ''}
                              </div>
                            ) : (
                              <div>no independent audit observations.</div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                    {pubkey && signer && details[mint.url] && (() => {
                      const draft = draftFor(mint);
                      const cooldownMs = reviewCooldownRemainingMs(pubkey, mint.url, nowMs);
                      const canPublish = draft.rating > 0 || draft.content.trim().length > 0;
                      return (
                        <div className="mt-2 border-t pt-2" style={{ borderColor: 'var(--np-rule)' }} data-testid={`mint-review-${mint.url}`}>
                          <div className="mb-1 text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>
                            Your review
                          </div>
                          <div className="mb-1 flex items-center gap-1" role="group" aria-label="Mint rating">
                            {[1, 2, 3, 4, 5].map((star) => (
                              <button
                                key={star}
                                type="button"
                                aria-label={`${star} star${star === 1 ? '' : 's'}`}
                                aria-pressed={draft.rating >= star}
                                data-testid={`mint-review-star-${mint.url}-${star}`}
                                onClick={() => patchDraft(mint, { rating: star })}
                                className="p-0.5"
                                style={{ color: draft.rating >= star ? 'var(--np-accent)' : 'var(--np-muted)' }}
                              >
                                <Star size={13} fill={draft.rating >= star ? 'currentColor' : 'none'} />
                              </button>
                            ))}
                            {draft.rating > 0 && (
                              <button
                                type="button"
                                onClick={() => patchDraft(mint, { rating: 0 })}
                                className="ml-1 text-[9px] underline"
                                style={{ color: 'var(--np-muted)' }}
                              >
                                clear
                              </button>
                            )}
                          </div>
                          <textarea
                            value={draft.content}
                            onChange={(e) => patchDraft(mint, { content: e.target.value.slice(0, 500) })}
                            rows={2}
                            placeholder="What should others know about this mint?"
                            data-testid={`mint-review-text-${mint.url}`}
                            className="mb-1 w-full rounded border bg-transparent px-2 py-1 text-[10px]"
                            style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
                          />
                          <button
                            type="button"
                            disabled={reviewBusy === mint.url || cooldownMs > 0 || !canPublish}
                            onClick={() => void publishReview(mint)}
                            data-testid={`mint-review-publish-${mint.url}`}
                            className="rounded border px-2 py-1 text-[10px] uppercase tracking-widest disabled:opacity-50"
                            style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
                          >
                            {reviewBusy === mint.url
                              ? 'Publishing…'
                              : cooldownMs > 0
                                ? `Update in ${Math.max(1, Math.ceil(cooldownMs / 60_000))} min`
                                : 'Publish review'}
                          </button>
                          {reviewNote && (
                            <div className="mt-1 text-[10px]" style={{ color: 'var(--np-muted)' }} data-testid={`mint-review-note-${mint.url}`}>
                              {reviewNote}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default MintDiscovery;
