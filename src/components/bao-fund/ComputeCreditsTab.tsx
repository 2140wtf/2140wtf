import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import { Bot, CheckCircle2, Copy, Cpu, Loader2, Send, WalletCards, Zap } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  BAO_COMPUTE_CREDIT_FULFILLMENT_KIND,
  BAO_COMPUTE_CREDIT_RECEIPT_KIND,
  BAO_COMPUTE_CREDIT_REQUEST_KIND,
  BAO_COMPUTE_CREDIT_TAG,
  buildComputeCreditFulfillment,
  buildComputeCreditReceipt,
  buildComputeCreditRequest,
  confirmedComputeCreditShots,
  isComputeCreditRequestConfirmed,
  parseComputeCreditFulfillment,
  parseComputeCreditReceipt,
  parseComputeCreditRequest,
  resolveCreditLockTarget,
  isLikelyMainnetMint,
  aggregateAgentCreditStats,
  type ComputeCreditFulfillment,
  type ComputeCreditReceipt,
  type ComputeCreditRequest,
  type ComputeCreditShot,
  type CreditLockMode,
} from '@/lib/baoComputeCredits';
import {
  ROUTSTR_BASE_URL,
  routstrCreateBalanceFromCashu,
  routstrGetBalance,
  routstrGetInfo,
  routstrTopupWithCashu,
} from '@/lib/routstr';
import { NUTZAP_INFO_KIND, parseNutzapInfoEvent } from '@/lib/cashu/cashuNip60';
import { checkTokenProofsSpent, decodeCashuToken, safeNormalizeMintUrl, MAX_MINT_FEE_PPM } from '@/lib/cashu/cashu';
import { extractTokenLockPubkeys, getTokenAmount } from '@/pets/battle/lib/cashuEscrow';
import { bytesToHex } from '@noble/curves/utils.js';
import { nip19 } from 'nostr-tools';
import { useCashuWalletContext } from '@/hooks/useCashuWalletContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNip17SendMessage } from '@/hooks/useNip17SendMessage';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { usePublishPreferences } from '@/hooks/usePublishPreferences';
import { useToast } from '@/hooks/useToast';
import { useAuthor } from '@/hooks/useAuthor';
import { RoutstrExplainer } from './RoutstrExplainer';
import { AgentGateCheck } from './AgentGateCheck';
import { creditOutboxStorageKey, hasUnsupportedLockSecrets } from './computeCreditsUtils';
import { cn } from '@/lib/utils';

function formatSats(n: number): string {
  return Number(n).toLocaleString();
}

function timeAgo(ts: number): string {
  const mins = Math.floor((Date.now() / 1000 - ts) / 60);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function RequestAuthor({ pubkey }: { pubkey: string }) {
  const author = useAuthor(pubkey);
  const name = author.data?.metadata?.name;
  return <span className="font-mono">{name ?? `${pubkey.slice(0, 8)}…`}</span>;
}

/**
 * Corroborated track record for an agent (credits review 2026-07).
 *
 * Every input kind is self-published — NOTHING here is proof of payment, so
 * the copy says exactly that. "Funded" requires BOTH a non-self funder claim
 * AND the agent's own confirmation; receipts are deduped per request and must
 * reference the agent's own requests. Claimant pubkeys are inspectable — the
 * real defense against sockpuppet rings.
 */
function AgentReputationBadge({ pubkey }: { pubkey: string }) {
  const { nostr } = useNostr();
  const [expanded, setExpanded] = useState<boolean | null>(null);

  const statsQuery = useQuery({
    queryKey: ['bao-compute-credit-reputation', pubkey],
    queryFn: async ({ signal }) => {
      // Full history (no 30d floor): the agent's own requests + receipts, and
      // every 4972 (claims AND confirmations) addressed to them.
      const events = await nostr.query(
        [
          { kinds: [BAO_COMPUTE_CREDIT_REQUEST_KIND, BAO_COMPUTE_CREDIT_RECEIPT_KIND], authors: [pubkey], limit: 500 },
          { kinds: [BAO_COMPUTE_CREDIT_FULFILLMENT_KIND], '#p': [pubkey], limit: 500 },
        ],
        { signal },
      );
      const reqs = events.map(parseComputeCreditRequest).filter((r): r is ComputeCreditRequest => r !== null);
      const fuls = events.map(parseComputeCreditFulfillment).filter((f) => f !== null);
      const recs = events.map(parseComputeCreditReceipt).filter((r): r is ComputeCreditReceipt => r !== null);
      return aggregateAgentCreditStats({ agentPubkey: pubkey, requests: reqs, fulfillments: fuls, receipts: recs });
    },
    staleTime: 5 * 60_000,
  });

  const stats = statsQuery.data;
  if (!stats || (stats.requests === 0 && stats.receipts === 0)) return null;

  const showClaimants = expanded ?? stats.claimants.length > 3;

  return (
    <div className="rounded-md border border-dashed px-2.5 py-1.5 text-[11px] text-muted-foreground space-y-1">
      <p>
        Track record: <span className="font-medium text-foreground">{stats.fundedRequests} funded</span>
        {' · '}{stats.claimants.length} claimant{stats.claimants.length === 1 ? '' : 's'}
        {' · '}{stats.receipts} receipt{stats.receipts === 1 ? '' : 's'}
        {' · '}~{formatSats(stats.selfReportedSats)} sats self-reported
      </p>
      <p className="italic">Activity, not verified payment — check the claimants before funding.</p>
      {stats.claimants.length > 0 && (
        <div>
          <button
            type="button"
            className="underline underline-offset-2 hover:text-foreground"
            onClick={() => setExpanded(!showClaimants)}
          >
            {showClaimants ? 'Hide claimants' : `Show claimants (${stats.claimants.length})`}
          </button>
          {showClaimants && (
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
              {stats.claimants.map((c) => (
                <span key={c} className="font-mono"><RequestAuthor pubkey={c} /></span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Compute credits — the REAL-sats half of the ₿AO Fund page.
 *
 * Agents without money publish a kind-4971 request; funders lock real Cashu
 * tokens to the agent's pubkey (P2PK), deliver them by NIP-17 DM (+ copyable
 * fallback), and post a kind-4972 claim. The agent confirms receipt with
 * their own kind-4972 — only the agent's confirmation closes the request,
 * since anyone can publish a 4972 for any request. The agent redeems the
 * token at Routstr for an `sk_…` compute key. Mainnet, tokens only.
 */
export function ComputeCreditsTab({ defaultView = 'browse' }: { defaultView?: 'browse' | 'agent' }) {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const queryClient = useQueryClient();

  const requestsQuery = useQuery({
    queryKey: ['bao-compute-credit-requests'],
    queryFn: async ({ signal }) => {
      const since = Math.floor(Date.now() / 1000) - 30 * 24 * 3600;
      // limit 1000 (most relays cap lower): with a small limit a griefer can
      // flood junk requests and push legitimate ones out of the relay's
      // newest-first window entirely. Still only a mitigation — a determined
      // flood needs relay-side rate limits.
      const events = await nostr.query(
        [{ kinds: [BAO_COMPUTE_CREDIT_REQUEST_KIND], '#t': [BAO_COMPUTE_CREDIT_TAG], since, limit: 1000 }],
        { signal },
      );
      // Clamp future-dated created_at for sorting: relays accept events
      // timestamped ahead of now, and without the clamp a griefer can pin
      // their request to the top of the list by dating it next year.
      const nowSec = Math.floor(Date.now() / 1000);
      const sortKey = (r: ComputeCreditRequest) => Math.min(r.createdAt, nowSec);
      return events
        .map(parseComputeCreditRequest)
        .filter((r): r is ComputeCreditRequest => r !== null)
        .sort((a, b) => sortKey(b) - sortKey(a));
    },
    refetchInterval: 30_000,
  });

  const requests = useMemo(() => requestsQuery.data ?? [], [requestsQuery.data]);

  const fulfillmentsQuery = useQuery({
    // Scoped by #e to the requests we actually display. Kind 4972 is
    // deliberately permissionless (anyone can publish one), so a GLOBAL
    // `{kinds:[4972], limit:500}` window is floodable: an attacker mints 500
    // junk fulfillments with random e-tags, the relay returns newest-first,
    // and every legitimate claim/confirmation falls out of the window —
    // silently disabling the double-funding warning (hunt round 8 blocker).
    // Relay-side #e filtering makes junk events irrelevant: they can never
    // reference a displayed request, so they never consume the limit.
    queryKey: ['bao-compute-credit-fulfillments', requests.map((r) => r.id).join(',')],
    queryFn: async ({ signal }) => {
      const ids = requests.map((r) => r.id);
      if (ids.length === 0) return [];
      const events = await nostr.query(
        [{ kinds: [BAO_COMPUTE_CREDIT_FULFILLMENT_KIND], '#e': ids, limit: 500 }],
        { signal },
      );
      return events.map(parseComputeCreditFulfillment).filter((f) => f !== null);
    },
    enabled: requests.length > 0,
    refetchInterval: 30_000,
  });

  const { confirmedShotsByRequest, claimsByRequest } = useMemo(() => {
    // A kind-4972 event proves NOTHING about payment — anyone can publish one
    // for any request. So it is only trusted as follows:
    //   - authored by the REQUESTER → confirmation of receipt; closes the request
    //   - authored by anyone else   → a funder's "I sent it" claim; displayed
    //     as a marker but never hides the request (a griefer could otherwise
    //     hide every open request without paying a single sat).
    const ownerById = new Map(requests.map((r) => [r.id, r.pubkey]));
    const confirmed = new Map<string, Set<ComputeCreditShot>>();
    const claims = new Map<string, ComputeCreditFulfillment[]>();
    for (const request of requests) {
      const shots = confirmedComputeCreditShots(request, fulfillmentsQuery.data ?? []);
      if (shots.size > 0) confirmed.set(request.id, shots);
    }
    for (const f of fulfillmentsQuery.data ?? []) {
      if (!f) continue;
      const owner = ownerById.get(f.requestId);
      if (!owner || f.requesterPubkey !== owner) continue; // p tag must match the real requester
      if (f.pubkey !== owner) {
        const list = claims.get(f.requestId) ?? [];
        list.push(f);
        claims.set(f.requestId, list);
      }
    }
    return { confirmedShotsByRequest: confirmed, claimsByRequest: claims };
  }, [fulfillmentsQuery.data, requests]);

  const requestIsConfirmed = (request: ComputeCreditRequest) =>
    isComputeCreditRequestConfirmed(request, fulfillmentsQuery.data?.filter((f): f is ComputeCreditFulfillment => f !== null) ?? []);
  const openRequests = requests.filter((request) => !requestIsConfirmed(request));
  const myRequests = user ? requests.filter((r) => r.pubkey === user.pubkey) : [];
  const myFundedRequests = myRequests.filter(requestIsConfirmed);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['bao-compute-credit-requests'] });
    queryClient.invalidateQueries({ queryKey: ['bao-compute-credit-fulfillments'] });
    queryClient.invalidateQueries({ queryKey: ['bao-compute-credit-reputation'] });
  };

  return (
    <div className="space-y-6">
      {/* REAL banner — contrasts with the DEMO banner on the Campaigns tab */}
      <div className="rounded-lg border-2 border-green-500/70 bg-green-500/10 px-4 py-3 text-sm">
        <p className="font-semibold text-green-600 dark:text-green-400 flex items-center gap-1.5">
          <Zap className="size-4" /> REAL SATS — mainnet Cashu for agents
        </p>
        <p className="text-muted-foreground mt-0.5">
          Funding sends a private <span className="text-green-600 dark:text-green-400 font-medium">Bitcoin mainnet Cashu token</span> to
          the agent. The agent can keep it as Cashu or convert it into an AI-compute key at{' '}
          <code className="text-xs">{ROUTSTR_BASE_URL}</code>. This is separate from the free ₿AO testnet sats used by demo campaigns.
        </p>
      </div>
        <p className="text-muted-foreground mt-1">
          <span className="text-green-600 dark:text-green-400 font-medium">Experimental:</span> receipts and reputation
          badges are trust signals, not guarantees — nothing stops an agent from redeeming your sats and disappearing,
          and any crowd-voted outcome elsewhere in the app can be gamed. Fund only what you can afford to lose.
        </p>

      <RoutstrExplainer />

      <Tabs defaultValue={defaultView} className="space-y-4">
        <TabsList className="grid h-auto w-full grid-cols-2">
          <TabsTrigger value="browse" className="min-h-11 gap-2 whitespace-normal py-2">
            <Bot className="size-4" /> Fund an agent
          </TabsTrigger>
          <TabsTrigger value="agent" className="min-h-11 gap-2 whitespace-normal py-2">
            <Cpu className="size-4" /> Request or receive
          </TabsTrigger>
        </TabsList>

        <TabsContent value="browse" className="mt-0 space-y-3">
          <div>
            <h2 className="text-lg font-semibold">Fund an agent with Cashu</h2>
            <p className="text-sm text-muted-foreground">Review the request and the agent&apos;s track record before sending real mainnet sats.</p>
          </div>
          {requestsQuery.isLoading ? (
            <div className="space-y-3">
              {[0, 1].map((i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
            </div>
          ) : openRequests.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                No open compute-credit requests right now.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {openRequests.map((r) => (
                <OpenRequestCard key={r.id} request={r} claims={claimsByRequest.get(r.id) ?? []} confirmedShots={confirmedShotsByRequest.get(r.id) ?? new Set()} onFulfilled={invalidate} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="agent" className="mt-0 space-y-3">
          <div>
            <h2 className="text-lg font-semibold">Request or receive Cashu</h2>
            <p className="text-sm text-muted-foreground">Publish a funding request, receive its Cashu token, and optionally turn it into AI compute.</p>
          </div>
          <AgentGateCheck>
            <div className="grid gap-6 md:grid-cols-2">
              <RequestCreditCard myRequests={myRequests} confirmedShotsByRequest={confirmedShotsByRequest} claimsByRequest={claimsByRequest} onPublished={invalidate} />
              <RedeemCard myFundedRequests={myFundedRequests} onReceiptPublished={invalidate} />
            </div>
          </AgentGateCheck>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Agent: request credits ────────────────────────────────────────────────────

function RequestCreditCard({ myRequests, confirmedShotsByRequest, claimsByRequest, onPublished }: {
  myRequests: ComputeCreditRequest[];
  confirmedShotsByRequest: Map<string, Set<ComputeCreditShot>>;
  claimsByRequest: Map<string, ComputeCreditFulfillment[]>;
  onPublished: () => void;
}) {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const publish = useNostrPublish();
  const { isEnabled: isPublishFeatureEnabled, setEnabled: setPublishFeatureEnabled } = usePublishPreferences();
  const nutzapsAdEnabled = isPublishFeatureEnabled('nutzaps');
  const [shots, setShots] = useState<1 | 2>(1);
  const [amount, setAmount] = useState('1000');
  const [amount2, setAmount2] = useState('');
  const [purpose, setPurpose] = useState('');

  const requestMutation = useMutation({
    mutationFn: () =>
      publish.mutateAsync({
        ...buildComputeCreditRequest({
          amountSats: parseInt(amount, 10) || 0,
          purpose,
          shots,
          amount2Sats: shots === 2 ? parseInt(amount2, 10) || 0 : undefined,
        }),
      }),
    onSuccess: () => {
      toast({ title: 'Compute-credit request published' });
      setPurpose('');
      onPublished();
    },
    onError: (e) => toast({ title: 'Publish failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }),
  });

  // Agent-side confirmation. Only a kind-4972 authored by the requester
  // closes the request — a funder's receipt is a claim, not proof of payment.
  const confirmMutation = useMutation({
    mutationFn: ({ request, shot }: { request: ComputeCreditRequest; shot: ComputeCreditShot }) =>
      publish.mutateAsync(buildComputeCreditFulfillment({
        requestId: request.id,
        requesterPubkey: request.pubkey,
        amountSats: shot === 2 ? request.amount2Sats ?? 0 : request.amountSats,
        shot: shot === 2 ? 2 : undefined,
      })),
    onSuccess: () => {
      setConfirmTarget(null);
      toast({ title: 'Cashu receipt confirmed', description: 'The received payout is now marked as funded.' });
      onPublished();
    },
    onError: (e) => toast({ title: 'Confirm failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }),
  });

  // Two-step confirm: a claim event is only a funder SAYING they sent sats —
  // anyone can publish one (a griefer can blanket every open request with
  // fake claims hoping for a reflex click), and a crafted token can carry a
  // refund locktime that lets the "funder" reclaim it after you confirm. The
  // agent must explicitly attest they actually redeemed the sats first.
  const [confirmTarget, setConfirmTarget] = useState<{ requestId: string; shot: ComputeCreditShot } | null>(null);

  const valid =
    (parseInt(amount, 10) || 0) > 0 &&
    purpose.trim().length > 0 &&
    (shots === 1 || (parseInt(amount2, 10) || 0) > 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Bot className="size-4 text-primary" /> Request Cashu funding
        </CardTitle>
        <CardDescription>
          Describe the work and payout plan. The request is public; the actual Cashu token is sent privately.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {user && !nutzapsAdEnabled && (
          <div className="flex items-start gap-2.5 rounded-md border border-amber-500/50 bg-card px-3 py-2.5 text-foreground">
            <Zap className="size-4 shrink-0 mt-0.5 text-amber-500" />
            <div className="space-y-1.5">
              <p className="text-xs leading-relaxed">
                Publish a Cashu receiver address so funding can lock directly to this wallet. Without it, the token is locked to your Nostr identity and needs your signer to unlock.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 border-amber-500/50 text-[11px] text-foreground hover:bg-muted"
                onClick={() => {
                  setPublishFeatureEnabled('nutzaps', true);
                  toast({ title: 'Nutzap receiver ad enabled', description: 'Your wallet publishes it right away.' });
                }}
              >
                <Zap className="size-3" /> Enable Cashu receiver
              </Button>
            </div>
          </div>
        )}
        <div className="space-y-1.5">
          <Label>Payout plan</Label>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={shots === 1 ? 'default' : 'outline'}
              size="sm"
              onClick={() => setShots(1)}
            >
              Single shot
            </Button>
            <Button
              type="button"
              variant={shots === 2 ? 'default' : 'outline'}
              size="sm"
              onClick={() => setShots(2)}
            >
              Double shot
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {shots === 1
              ? 'One Cashu payout after the donor accepts the work.'
              : 'Two separate Cashu payouts. Confirm each one only after receiving it.'}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cc-amount">{shots === 2 ? 'First payout (sats)' : 'Payout (sats)'}</Label>
          <Input id="cc-amount" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" />
        </div>
        {shots === 2 && (
          <div className="space-y-1.5">
            <Label htmlFor="cc-amount2">Second payout (sats)</Label>
            <Input id="cc-amount2" value={amount2} onChange={(e) => setAmount2(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" placeholder="2140" />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="cc-purpose">What work will you deliver?</Label>
          <Textarea id="cc-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={2} placeholder="e.g. Run inference and publish the oracle dashboard results" />
        </div>
        {user ? (
          <Button className="w-full gap-1.5" disabled={!valid || requestMutation.isPending} onClick={() => requestMutation.mutate()}>
            {requestMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Publish request
          </Button>
        ) : (
          <p className="text-xs text-center text-muted-foreground">Log in to request credits.</p>
        )}

        {myRequests.length > 0 && (
          <div className="space-y-1.5 pt-1">
            <p className="text-xs font-medium text-muted-foreground">Your requests</p>
            {myRequests.slice(0, 5).map((r) => {
              const confirmed = confirmedShotsByRequest.get(r.id) ?? new Set<ComputeCreditShot>();
              const claims = claimsByRequest.get(r.id) ?? [];
              const expectedShots: ComputeCreditShot[] = r.shots === 2 ? [1, 2] : [1];
              const isComplete = expectedShots.every((shot) => confirmed.has(shot));
              const pendingClaimShots = expectedShots.filter((shot) =>
                !confirmed.has(shot) && claims.some((claim) => (claim.shot ?? 1) === shot),
              );
              const armed = confirmTarget?.requestId === r.id ? confirmTarget.shot : null;
              const totalSats = r.amountSats + (r.shots === 2 ? r.amount2Sats ?? 0 : 0);
              return (
                <div key={r.id} className="flex flex-col gap-2 rounded-md border px-2.5 py-2 text-xs sm:flex-row sm:items-center sm:justify-between">
                  <span className="min-w-0 truncate">{r.purpose || `${formatSats(totalSats)} sats`}</span>
                  {isComplete ? (
                    <Badge variant="outline" className="text-green-500 border-green-500/40 shrink-0 gap-1">
                      <CheckCircle2 className="size-3" /> funded {formatSats(totalSats)}
                    </Badge>
                  ) : armed ? (
                      <div className="flex flex-col gap-1 sm:max-w-[70%]">
                        <p className="text-[10px] text-amber-950 dark:text-amber-200 leading-tight">
                          A claim only says someone paid. Confirm payout {armed} only after it appears in your Cashu wallet or Routstr balance. If it did not arrive, do not confirm.
                        </p>
                        <div className="flex flex-wrap gap-1">
                          <Button
                            size="sm" variant="outline"
                            className="gap-1 h-auto min-h-7 whitespace-normal text-[11px] text-green-600 dark:text-green-400 border-green-500/40"
                            disabled={confirmMutation.isPending}
                            onClick={() => confirmMutation.mutate({ request: r, shot: armed })}
                          >
                            {confirmMutation.isPending ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle2 className="size-3" />}
                            Confirm payout {armed} received
                          </Button>
                          <Button
                            size="sm" variant="ghost"
                            className="shrink-0 h-6 text-[11px]"
                            onClick={() => setConfirmTarget(null)}
                          >
                            Not yet
                          </Button>
                        </div>
                      </div>
                  ) : pendingClaimShots.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {pendingClaimShots.map((shot) => (
                        <Button
                          key={shot}
                          size="sm" variant="outline"
                          className="gap-1 h-auto min-h-7 whitespace-normal text-[11px] text-amber-950 dark:text-amber-200 border-amber-500/40"
                          onClick={() => setConfirmTarget({ requestId: r.id, shot })}
                        >
                          <CheckCircle2 className="size-3" />
                          Confirm payout {shot}
                        </Button>
                      ))}
                    </div>
                  ) : (
                    <Badge variant="outline" className="w-fit shrink-0">
                      {confirmed.size > 0 ? `${confirmed.size}/${expectedShots.length} confirmed` : `open · ${timeAgo(r.createdAt)}`}
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Funder: fulfill a request with a real Cashu token ─────────────────────────

function OpenRequestCard({ request, claims, confirmedShots, onFulfilled }: { request: ComputeCreditRequest; claims: ComputeCreditFulfillment[]; confirmedShots: Set<ComputeCreditShot>; onFulfilled: () => void }) {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { toast } = useToast();
  const publish = useNostrPublish();
  const { allMints, balances, mintUrl, sendTokenToOutbox } = useCashuWalletContext();
  const { sendMessage } = useNip17SendMessage();
  const [token, setToken] = useState<string | null>(null);
  const [lockMode, setLockMode] = useState<CreditLockMode | null>(null);
  const [allowBearer, setAllowBearer] = useState(false);
  const [allowIdentityLockFallback, setAllowIdentityLockFallback] = useState(false);
  const [dmState, setDmState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const [receiptFailed, setReceiptFailed] = useState(false);
  const [confirmFunding, setConfirmFunding] = useState(false);

  const isOwn = !!user && user.pubkey === request.pubkey;
  const hasWallet = allMints.length > 0;

  // Double-shot requests fund tranche by tranche; single-shot ignores this.
  const isDoubleShot = request.shots === 2 && !!request.amount2Sats;
  const [fundShot, setFundShot] = useState<1 | 2>(1);
  const fundAmount = fundShot === 2 ? (request.amount2Sats ?? 0) : request.amountSats;
  const shotCovered = (shot: ComputeCreditShot) => confirmedShots.has(shot);

  // The minted funding token is the ONLY copy of the send proofs (the wallet
  // persists just the change) — if this component unmounts after a DM failure
  // (tab switch, navigation, crash) the sats are gone with the wallet already
  // debited. Keep a localStorage outbox copy until the funder explicitly
  // discards it (agent confirmed receipt). Scoped by funder pubkey so account
  // B on a shared browser never sees or destroys account A's copy.
  const outboxKey = creditOutboxStorageKey(user?.pubkey, request.id);
  // The key the current token state belongs to. Without this guard, an
  // account switch/logout fires the write effect with the OLD account's
  // token under the NEW key (or the shared logged-out key), leaking a bearer
  // token to whoever uses this browser next.
  const [outboxLoadedKey, setOutboxLoadedKey] = useState<string | null>(null);
  useEffect(() => {
    // Reset FIRST — state from the previous key must never render or persist
    // under the new one.
    setToken(null);
    setLockMode(null);
    setDmState('idle');
    try {
      if (!user) {
        // Never restore (or keep) a token for an anonymous viewer: a legacy
        // logged-out entry would be a bearer token anyone on this browser
        // could copy. The funder's own pubkey-scoped copy is untouched and
        // restores when they log back in.
        localStorage.removeItem(outboxKey);
        setOutboxLoadedKey(outboxKey);
        return;
      }
      // Purge a legacy logged-out duplicate of this request's token, if one
      // exists from before the write path was account-gated.
      localStorage.removeItem(creditOutboxStorageKey(undefined, request.id));
      const raw = localStorage.getItem(outboxKey);
      if (raw) {
        const saved = JSON.parse(raw) as { token?: unknown; lockMode?: CreditLockMode; dmState?: string };
        if (saved && typeof saved.token === 'string' && saved.token) {
          setToken(saved.token);
          setLockMode(saved.lockMode ?? null);
          setDmState(saved.dmState === 'sent' ? 'sent' : 'failed');
        }
      }
    } catch { /* corrupted entry — ignore */ }
    setOutboxLoadedKey(outboxKey);
  }, [outboxKey, user, request.id]);
  useEffect(() => {
    // Only persist state that belongs to the current key, and never write a
    // token while logged out (it would land on the shared logged-out key).
    if (!user || outboxLoadedKey !== outboxKey) return;
    try {
      if (token) localStorage.setItem(outboxKey, JSON.stringify({ token, lockMode, dmState }));
      else localStorage.removeItem(outboxKey);
    } catch { /* storage full/blocked — the on-screen copy still works */ }
  }, [token, lockMode, dmState, outboxKey, outboxLoadedKey, user]);

  // Shared cache with RedeemCard — which mints Routstr accepts for redeem.
  const routstrInfoQuery = useQuery({ queryKey: ['routstr-info'], queryFn: routstrGetInfo, staleTime: 5 * 60_000, retry: 1 });

  const publishReceipt = useMutation({
    mutationFn: async () => {
      await publish.mutateAsync(buildComputeCreditFulfillment({
        requestId: request.id,
        requesterPubkey: request.pubkey,
        amountSats: fundAmount,
        shot: fundShot === 2 ? 2 : undefined,
      }));
    },
    onSuccess: () => {
      setReceiptFailed(false);
      onFulfilled();
    },
    onError: () => setReceiptFailed(true),
  });

  const fulfillMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('Log in to fund requests');

      // 1. Resolve the lock target. Fetch the agent's latest VERIFIED
      //    kind-10019 (author-checked; a forged info event could redirect the
      //    lock to an attacker's wallet key), then apply the hierarchy:
      //    wallet key → identity key → bearer (explicit opt-in only).
      let nutzapInfo: { pubkey: string; mints: string[] } | null = null;
      try {
        const infoEvents = await nostr.query(
          [{ kinds: [NUTZAP_INFO_KIND], authors: [request.pubkey], limit: 5 }],
        );
        const valid = infoEvents
          .filter((ev) => parseNutzapInfoEvent(ev, request.pubkey) !== null)
          .sort((a, b) => b.created_at - a.created_at);
        nutzapInfo = valid.length > 0 ? parseNutzapInfoEvent(valid[0], request.pubkey) : null;
      } catch {
        nutzapInfo = null; // relay failure → identity lock fallback
      }

      const target = resolveCreditLockTarget({
        nutzapInfo,
        agentIdentityPubkey: request.pubkey,
        funderMints: allMints.map((m) => m.url),
        routstrMints: routstrInfoQuery.data?.mints ?? [],
        activeMint: mintUrl,
        allowBearer,
      });

      if (!isLikelyMainnetMint(target.mintUrl)) {
        throw new Error('Agent funding requires a reachable HTTPS mainnet Cashu mint. Select a mainnet mint; signet and demo mints are blocked.');
      }
      if (target.mode === 'identity-key' && !allowIdentityLockFallback) {
        throw new Error('This agent has no compatible NIP-61 wallet key. Ask the agent to publish one, or explicitly enable identity-key fallback.');
      }

      // 2. Balance check at the chosen mint — a raw "Insufficient balance: 0"
      //    from deep in the wallet tells the funder nothing.
      const mintBalance = balances[target.mintUrl] ?? 0;
      if (mintBalance < fundAmount) {
        const short = target.mintUrl.replace(/^https?:\/\//, '');
        throw new Error(`Not enough balance at ${short} (${mintBalance} sats). Fund that mint first.`);
      }

      // 3. Mint a real Cashu token, P2PK-locked unless bearer was opted in.
      const memo = `₿AO compute credits: ${request.purpose.slice(0, 80)}`;
      const cashuToken = await sendTokenToOutbox(
        fundAmount,
        memo,
        target.lockPubkey ?? undefined,
        target.mintUrl,
        { key: outboxKey, metadata: { lockMode: target.mode } },
      );
      if (!cashuToken) throw new Error('Wallet did not return a token — check your balance and mints.');
      setToken(cashuToken);
      setLockMode(target.mode);

      // 4. Deliver the token by NIP-17 DM (best-effort; the copyable token below is the fallback).
      const redeemHint = target.mode === 'wallet-key'
        ? 'Locked to your wallet key — paste it in 2140.wtf → ₿AO Fund → Compute credits → Redeem; the app sweeps it to your wallet and redeems at Routstr for you.'
        : target.mode === 'identity-key'
          ? 'Locked to your Nostr pubkey — paste it in 2140.wtf → ₿AO Fund → Compute credits → Redeem (the sweep confirms with your signer or pasted nsec), or sweep it with your own tooling.'
          : '⚠️ UNLOCKED bearer token — whoever sees it can claim it. Redeem it immediately at Routstr.';
      setDmState('sending');
      try {
        await sendMessage({
          recipientPubkey: request.pubkey,
          content: `₿AO compute credits for request ${request.id} ("${request.purpose.slice(0, 60)}") — ${formatSats(fundAmount)} sats${isDoubleShot ? `, milestone ${fundShot}/2` : ''}.\n\n${redeemHint}\n\n${cashuToken}`,
        });
        setDmState('sent');
      } catch {
        setDmState('failed');
      }

      // 5. Public claim marker (kind 4972). Token NEVER goes in an event.
      //    This does NOT close the request — only the agent's own confirmation
      //    does (anyone can publish a 4972, so a funder's receipt is a claim,
      //    not proof). If this fails the token is already minted and the wallet
      //    debited — it must NEVER be discarded, so the receipt gets its own
      //    retry path instead of failing the whole mutation (which used to
      //    wipe the token).
      try {
        await publishReceipt.mutateAsync();
      } catch {
        // receiptFailed state is set by publishReceipt.onError; the token
        // stays visible below with a "retry receipt" button.
      }
    },
    onSuccess: () => {
      toast({ title: 'Credits sent', description: `${formatSats(fundAmount)} sats sent to the agent.` });
    },
    onError: (e) => {
      // Only reachable before a token exists (resolution/balance/sendToken
      // failure); once a token is minted the mutation never throws, so it
      // cannot be lost here.
      setToken(null);
      setLockMode(null);
      setDmState('idle');
      toast({ title: 'Funding failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    },
  });

  return (
    <Card>
      <CardContent className="py-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm">
              <RequestAuthor pubkey={request.pubkey} /> requests{' '}
              {isDoubleShot ? (
                <span className="font-semibold tabular-nums">
                  {formatSats(request.amountSats)} + {formatSats(request.amount2Sats!)} sats
                  <span className="ml-1.5 text-[10px] font-normal text-primary">2 milestones</span>
                </span>
              ) : (
                <span className="font-semibold tabular-nums">{formatSats(request.amountSats)} sats</span>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-0.5 whitespace-pre-wrap">{request.purpose}</p>
            <div className="mt-1.5">
              <AgentReputationBadge pubkey={request.pubkey} />
            </div>
          </div>
          <span className="text-xs text-muted-foreground shrink-0">{timeAgo(request.createdAt)}</span>
        </div>

        {claims.length > 0 && !token && (
          <p className="text-[11px] text-amber-950 dark:text-amber-200">
            {claims.length === 1 ? '1 funder says they already sent this' : `${claims.length} funders say they already sent this`} — check with the agent before double-funding.
          </p>
        )}

        {token && user ? (
          <div className="space-y-2">
            <div className="rounded-md border border-green-500/50 bg-green-500/10 p-3 space-y-1.5">
              <p className="text-xs font-semibold text-green-600 dark:text-green-400 flex items-center gap-1.5">
                <CheckCircle2 className="size-3.5" /> Token sent
                {dmState === 'sent' && ' — delivered by DM'}
                {dmState === 'failed' && ' — DM failed, share it manually'}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {lockMode === 'bearer'
                  ? '⚠️ Unlocked bearer token — whoever sees it can claim it. Keep this copy until the agent confirms receipt:'
                  : lockMode === 'identity-key'
                    ? "Locked to the agent's Nostr pubkey (P2PK). Keep this copy until they confirm receipt:"
                    : "Locked to the agent's wallet key (P2PK). Keep this copy until they confirm receipt:"}
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-[10px] break-all rounded bg-background/60 px-2 py-1.5 max-h-16 overflow-y-auto">{token}</code>
                <Button
                  size="icon" variant="outline" className="shrink-0"
                  onClick={() => { navigator.clipboard.writeText(token); toast({ title: 'Token copied' }); }}
                >
                  <Copy className="size-3.5" />
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                This copy is kept on this device (survives tab switches) until you discard it.
              </p>
              <Button
                size="sm" variant="ghost" className="h-7 text-[11px] text-muted-foreground"
                onClick={() => { setToken(null); setLockMode(null); setDmState('idle'); }}
              >
                Agent confirmed receipt — discard copy
              </Button>
              {receiptFailed && (
                <div className="flex items-center justify-between gap-2 rounded-md border border-amber-500/50 bg-card px-2.5 py-2">
                  <p className="text-[11px] text-foreground">
                    Receipt not published — the request may still show as open. The token above is safe; keep it until the agent confirms.
                  </p>
                  <Button
                    size="sm" variant="outline" className="shrink-0 gap-1.5"
                    disabled={publishReceipt.isPending}
                    onClick={() => publishReceipt.mutate()}
                  >
                    {publishReceipt.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                    Retry receipt
                  </Button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                {isOwn ? 'This is your own request.' : hasWallet ? 'Real sats from your Cashu wallet, P2PK-locked to the agent.' : 'Add a Cashu mint in Wallet to fund requests.'}
              </p>
              {!isOwn && user && (
                isDoubleShot ? (
                  <div className="grid w-full grid-cols-1 gap-1.5 sm:w-auto sm:grid-cols-2">
                    {[1, 2].map((shot) => {
                      const amount = shot === 2 ? request.amount2Sats! : request.amountSats;
                      const covered = shotCovered(shot as 1 | 2);
                      return (
                        <Button
                          key={shot}
                          size="sm"
                          variant={fundShot === shot ? 'default' : 'outline'}
                          className="h-auto min-h-9 gap-1 whitespace-normal"
                          disabled={!hasWallet || fulfillMutation.isPending || covered}
                          onClick={() => { setFundShot(shot as 1 | 2); setConfirmFunding(true); }}
                        >
                          {covered ? <CheckCircle2 className="size-3.5" /> : fulfillMutation.isPending && fundShot === shot ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
                          {covered ? `Payout ${shot} received` : `Payout ${shot} · ${formatSats(amount)}`}
                        </Button>
                      );
                    })}
                  </div>
                ) : (
                  <Button
                    size="sm" className="gap-1.5 shrink-0"
                    disabled={!hasWallet || fulfillMutation.isPending}
                    onClick={() => setConfirmFunding(true)}
                  >
                    {fulfillMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
                    Send {formatSats(request.amountSats)} sats
                  </Button>
                )
              )}
            </div>
            {!isOwn && user && hasWallet && (
              <div className="space-y-1.5">
                <label className="flex items-start gap-2 text-[11px] text-muted-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={allowIdentityLockFallback}
                    onChange={(e) => setAllowIdentityLockFallback(e.target.checked)}
                  />
                  <span>Allow identity-key fallback when the agent has no compatible NIP-61 wallet key.</span>
                </label>
                <label className="flex items-start gap-2 text-[11px] text-muted-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={allowBearer}
                    onChange={(e) => setAllowBearer(e.target.checked)}
                  />
                  <span>
                    Send <span className="text-amber-600 dark:text-amber-400 font-medium">unlocked</span> (bearer token in an encrypted DM — only for agents that ask for it)
                  </span>
                </label>
              </div>
            )}
            {!user && (
              <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                Log in to fund this request. Donors do not need to pass the client-side agent check.
              </p>
            )}
          </div>
        )}
      </CardContent>
      <Dialog open={confirmFunding} onOpenChange={(open) => !fulfillMutation.isPending && setConfirmFunding(open)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send Cashu to this agent?</DialogTitle>
            <DialogDescription>
              This will irreversibly debit {formatSats(fundAmount)} real mainnet sats from your Cashu balance and send a token to the agent.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border bg-muted/40 p-3 text-sm space-y-1">
            <p><span className="text-muted-foreground">Request:</span> {request.purpose}</p>
            <p><span className="text-muted-foreground">Amount:</span> {formatSats(fundAmount)} sats{isDoubleShot ? ` · payout ${fundShot}/2` : ''}</p>
            <p><span className="text-muted-foreground">Active mint:</span> <span className="break-all">{mintUrl}</span></p>
            <p><span className="text-muted-foreground">Protection:</span> {allowBearer ? 'Unlocked bearer token (higher risk)' : 'P2PK lock selected automatically'}</p>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" disabled={fulfillMutation.isPending} onClick={() => setConfirmFunding(false)}>Cancel</Button>
            <Button
              disabled={fulfillMutation.isPending}
              onClick={() => {
                setConfirmFunding(false);
                fulfillMutation.mutate();
              }}
            >
              {fulfillMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : `Send ${formatSats(fundAmount)} sats`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ── Agent: redeem a token at Routstr ──────────────────────────────────────────

/**
 * Redeem flow (credits review 2026-07 — the old "paste locked token straight
 * at Routstr" flow was broken: Routstr redeems via an UNSIGNED split at the
 * mint, which NUT-11-enforcing mints reject for P2PK-locked proofs):
 *
 *   locked to wallet key → sweep with the wallet's own NIP-60 key (no nsec)
 *   locked to anything else (legacy identity-key tokens) → sweep with a
 *       pasted nsec/hex (remote-signer users included)
 *   unlocked → straight to Routstr
 *
 * After a sweep the app re-sends the POST-FEE amount as an unlocked token and
 * redeems THAT at Routstr. If Routstr fails after the sweep, the unlocked
 * token is immediately received back so the sats return to the wallet.
 */
function RedeemCard({ myFundedRequests, onReceiptPublished }: {
  myFundedRequests: ComputeCreditRequest[];
  onReceiptPublished: () => void;
}) {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const publish = useNostrPublish();
  const queryClient = useQueryClient();
  const { allMints, addCustomMint, sendToken, wasLastSendAmbiguous, receiveToken, receiveLockedToken, sweepWalletLockedToken, getWalletP2pkPubkey } = useCashuWalletContext();
  const [token, setToken] = useState('');
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [redeemedSats, setRedeemedSats] = useState(0);
  const [topupToken, setTopupToken] = useState('');
  const [identitySweep, setIdentitySweep] = useState(false);
  const [lockHints, setLockHints] = useState<string[]>([]);
  const [privkeyPaste, setPrivkeyPaste] = useState('');
  const [receiptRequestId, setReceiptRequestId] = useState<string | null>(null);
  const [receiptNote, setReceiptNote] = useState('');
  const [receiptPublished, setReceiptPublished] = useState(false);
  const [walletReceivedSats, setWalletReceivedSats] = useState(0);
  const [identityDestination, setIdentityDestination] = useState<'wallet' | 'routstr'>('routstr');

  const infoQuery = useQuery({ queryKey: ['routstr-info'], queryFn: routstrGetInfo, staleTime: 5 * 60_000, retry: 1 });
  const balanceQuery = useQuery({
    queryKey: ['routstr-balance', apiKey],
    queryFn: () => routstrGetBalance(apiKey!),
    enabled: !!apiKey,
    refetchInterval: 60_000,
  });

  /** Re-send swept sats as an unlocked token for Routstr (fee-reserve retry). */
  const resendUnlocked = async (amount: number, mint?: string): Promise<string> => {
    const memo = 'Routstr compute redeem';
    let t = await sendToken(amount, memo, undefined, mint);
    if (!t && !wasLastSendAmbiguous()) {
      // Retry ONLY when the first attempt provably never reached the mint
      // (local proof selection / explicit mint rejection) — the fee shave
      // this retry exists for. After an AMBIGUOUS failure (timeout, dropped
      // response, post-commit validation) attempt 1 may have committed:
      // retrying would double-spend from the remaining proofs and burn the
      // first attempt's sats at the mint.
      // The reserve must cover the mint's per-proof input fee, which the
      // wallet tolerates up to MAX_MINT_FEE_PPM (5%) — a 0.1% shave still
      // failed on high-fee mints or with many small proofs.
      const reserve = Math.max(2, Math.ceil(amount * (MAX_MINT_FEE_PPM / 1_000_000)));
      if (amount - reserve > 0) t = await sendToken(amount - reserve, memo, undefined, mint);
    }
    if (!t) {
      if (wasLastSendAmbiguous()) {
        // Do NOT claim the sats are safe — the mint may have committed.
        throw new Error(`Swept ${formatSats(amount)} sats to your wallet, but the Routstr token send was not confirmed by the mint — it may or may not have completed. Do NOT retry yet: check your Wallet tab balance; if it dropped, the recovery journal reconciles automatically. (Re-pasting the original token won't work — it's already swept.)`);
      }
      // The original token is already marked processed by the sweep, so
      // "retry the redeem" can never work — name the path that does.
      throw new Error(`Swept ${formatSats(amount)} sats to your wallet but couldn't prepare the Routstr token — your sats are safe in your wallet. Send yourself a fresh token from the Wallet tab and redeem that instead (re-pasting the original token won't work — it's already swept).`);
    }
    return t;
  };

  /** Redeem an unlocked token at Routstr; on failure try to put the bearer token back in the wallet. */
  const redeemUnlocked = async (unlocked: string): Promise<{ apiKey: string; balance: number }> => {
    try {
      return await routstrCreateBalanceFromCashu(unlocked);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // receiveToken journals the token BEFORE contacting the mint and never
      // throws (0 on failure) — so a failed receive-back still leaves the
      // token in the wallet's pending-receive journal for automatic retries.
      const returned = await receiveToken(unlocked);
      if (returned > 0) {
        // receiveToken's success path only stores proofs under mints already
        // in allMints — a token from an unconfigured mint credits sats the UI
        // (balances, Wallet tab) never shows. This is the user's own money
        // coming back from a failed redeem (not an untrusted pasted token),
        // so adopt the mint instead of leaving the sats invisible.
        const known = new Set(allMints.map((m) => safeNormalizeMintUrl(m.url)));
        const missing = [
          ...new Set(
            (decodeCashuToken(unlocked) ?? [])
              .map((e) => safeNormalizeMintUrl(e.mintUrl))
              .filter((u) => u && !known.has(u)),
          ),
        ];
        for (const u of missing) addCustomMint(u, u);
        if (missing.length > 0) {
          throw new Error(`Routstr redeem failed (${msg}). The sats were returned to your Cashu wallet at ${missing.join(', ')} (added to your mints so you can see and spend them) — retry when Routstr is back.`);
        }
        throw new Error(`Routstr redeem failed (${msg}). The sats were returned to your Cashu wallet — retry when Routstr is back.`);
      }
      // The receive-back failed too. Routstr creates the balance server-side
      // BEFORE responding, so a lost HTTP response means the token's proofs
      // are already SPENT at the mint: no wallet retry can ever credit them,
      // and claiming "automatic credit on next launch" would be a lie. Ask
      // the mint which situation we are actually in before promising anything.
      const spent = await checkTokenProofsSpent(unlocked);
      if (spent === true) {
        // "Spent" can't distinguish Routstr's spend from OUR OWN receive-back
        // that swapped at the mint but failed afterwards (proofs sitting in
        // the wallet's proof-recovery journal). Name both — telling the user
        // the sats are at Routstr when they're actually in their own journal
        // sends them chasing a balance that doesn't exist.
        throw new Error(
          `Routstr redeem failed (${msg}), and the mint confirms the token is already spent. Either Routstr created a balance but its response never reached you (keep this token and contact Routstr support to recover the API key), or your own wallet received it and the proofs are in its recovery journal — restart the app or check the Wallet tab to reconcile. The sats are NOT in your spendable balance.`,
        );
      }
      if (spent === null) {
        // The mint couldn't be asked — don't claim either way. The token may
        // be unspent (safe to retry) or already spent by Routstr's
        // server-side credit (retrying burns nothing but tells you "spent").
        throw new Error(
          `Routstr redeem failed (${msg}), and the mint could not be reached to check whether the token was spent. Keep the token above as a backup. Routstr credits the key BEFORE responding, so first refresh the balance / try the key — if the credit landed, the token's proofs are spent and retrying is harmless but useless.`,
        );
      }
      // The proofs were NOT spent. The journal claim must be honest:
      // receiveToken bails BEFORE journaling when the wallet isn't set up or
      // the token won't decode, so promise the journal only as a possibility
      // and point at the token copy that definitely still exists.
      throw new Error(
        `Routstr redeem failed (${msg}). The token was not spent — keep the token above as a backup and retry the redeem when Routstr is back. If your wallet is set up, it also holds the token in its recovery journal and keeps retrying it in the background.`,
      );
    }
  };

  const handleRedeemSuccess = ({ apiKey: key, sats }: { apiKey: string; balance: number; sats: number }) => {
    setApiKey(key);
    setRedeemedSats(sats);
    setToken('');
    setIdentitySweep(false);
    setLockHints([]);
    setPrivkeyPaste('');
    setReceiptRequestId(myFundedRequests[0]?.id ?? null);
    setReceiptPublished(false);
    toast({ title: 'Token redeemed', description: 'Your Routstr compute key is ready — store it somewhere safe.' });
  };

  const handleWalletReceiveSuccess = (sats: number) => {
    const knownMints = new Set(allMints.map((mint) => safeNormalizeMintUrl(mint.url)));
    const receivedMints = [...new Set(
      (decodeCashuToken(token.trim()) ?? [])
        .map((entry) => safeNormalizeMintUrl(entry.mintUrl))
        .filter(Boolean),
    )];
    for (const mint of receivedMints) {
      if (!knownMints.has(mint)) addCustomMint(mint, mint);
    }
    setWalletReceivedSats(sats);
    setToken('');
    setIdentitySweep(false);
    setLockHints([]);
    setPrivkeyPaste('');
    toast({ title: 'Cashu received', description: `${formatSats(sats)} sats are now in your Cashu wallet. No API credits were purchased.` });
  };

  const receiveIntoWalletMutation = useMutation({
    mutationFn: async (): Promise<number> => {
      const raw = token.trim();
      const locks = extractTokenLockPubkeys(raw);
      if (locks.length === 0) {
        if (hasUnsupportedLockSecrets(raw)) {
          throw new Error('This token uses a lock this app cannot parse. It was not spent; sweep it with compatible Cashu tooling.');
        }
        const received = await receiveToken(raw);
        if (received <= 0) throw new Error('The Cashu wallet could not receive this token. Check the mint and wallet error, then retry.');
        return received;
      }

      const walletPub = getWalletP2pkPubkey()?.toLowerCase() ?? null;
      const xonlyLocks = locks.map((lock) => (lock.length === 66 ? lock.slice(2) : lock));
      if (walletPub && xonlyLocks.includes(walletPub)) {
        const received = await sweepWalletLockedToken(raw);
        if (received <= 0) throw new Error('The wallet could not unlock this token. Check the wallet error, then retry.');
        return received;
      }

      setIdentityDestination('wallet');
      setLockHints(locks);
      setIdentitySweep(true);
      throw new Error('This token needs its matching private key before it can enter this wallet.');
    },
    onSuccess: handleWalletReceiveSuccess,
    onError: (error) => toast({
      title: 'Cashu receive needs attention',
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive',
    }),
  });

  const redeemMutation = useMutation({
    mutationFn: async (): Promise<{ apiKey: string; balance: number; sats: number }> => {
      const raw = token.trim();
      const locks = extractTokenLockPubkeys(raw);
      const faceSats = getTokenAmount(raw);

      if (locks.length === 0) {
        // No extractable locks. That means bearer ONLY if no proof carries a
        // lock-shaped secret we can't parse (tagged P2PK, HTLC, …) — those
        // are rejected by the mint's unsigned split at Routstr and the
        // receive-back can't sign for them, so refuse up front instead of
        // misrouting the token.
        if (hasUnsupportedLockSecrets(raw)) {
          throw new Error('This token is locked with a scheme this app can\'t parse (e.g. P2PK with locktime/refund tags, or an HTLC) — it was NOT sent anywhere. Sweep it with Cashu tooling that supports the lock, then redeem the resulting unlocked token here.');
        }
        // Bearer token — straight to Routstr.
        const res = await redeemUnlocked(raw);
        return { ...res, sats: faceSats };
      }

      // The sweep→resend step draws from ONE mint — a token spanning several
      // mints would brick the flow (resend sees only the first mint's share,
      // and the sweep already marked the token processed so retry is
      // impossible). Refuse BEFORE touching anything; the wallet's own
      // receive handles multi-mint tokens fine.
      const tokenMints = [...new Set((decodeCashuToken(raw) ?? []).map((e) => e.mintUrl).filter(Boolean))];
      if (tokenMints.length > 1) {
        throw new Error('This token spans multiple mints — receive it in the Wallet tab first, then send yourself a single-mint token and redeem that.');
      }

      const walletPub = getWalletP2pkPubkey()?.toLowerCase() ?? null;
      // Length-gated normalization: only 66-char compressed locks lose the
      // 02/03 prefix — a genuine x-only 64-char lock that happens to start
      // with those bytes must NOT be mangled.
      const xonlyLocks = locks.map((l) => (l.length === 66 ? l.slice(2) : l));
      if (walletPub && xonlyLocks.includes(walletPub)) {
        // Locked to THIS wallet's NIP-60 key — sweep without any nsec.
        const swept = await sweepWalletLockedToken(raw);
        if (!swept) throw new Error('Sweep failed — check the wallet error, or set up your Cashu wallet first.');
        const mint = tokenMints[0];
        const unlocked = await resendUnlocked(swept, mint);
        const res = await redeemUnlocked(unlocked);
        return { ...res, sats: swept };
      }

      // Locked to a key this wallet doesn't hold. That may be the user's
      // Nostr identity key (legacy tokens) OR a wallet key from another
      // app/device (the funder locks to whatever the latest kind-10019
      // advertises — not necessarily THIS browser's wallet key). Show the
      // actual lock pubkeys so the user can tell which key is needed instead
      // of blindly pasting an identity nsec that can never work.
      setLockHints(locks);
      setIdentityDestination('routstr');
      setIdentitySweep(true);
      throw new Error('This token is locked to a key this wallet doesn\'t hold (see below). If it\'s your Nostr key, paste your nsec/hex; if it\'s a wallet key from another app or device, sweep it there or paste that wallet\'s key.');
    },
    onSuccess: handleRedeemSuccess,
    onError: (e) => toast({ title: 'Redeem failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }),
  });

  const identitySweepMutation = useMutation({
    mutationFn: async (): Promise<
      | { destination: 'wallet'; sats: number }
      | { destination: 'routstr'; apiKey: string; balance: number; sats: number }
    > => {
      const raw = token.trim();
      const v = privkeyPaste.trim();
      let hex: string | null = null;
      if (/^[0-9a-f]{64}$/i.test(v)) {
        hex = v.toLowerCase();
      } else if (v.startsWith('nsec1')) {
        try {
          const decoded = nip19.decode(v);
          if (decoded.type === 'nsec') hex = bytesToHex(decoded.data);
        } catch { /* fall through */ }
      }
      if (!hex) throw new Error('Invalid key — paste an nsec1… or 64-char hex private key.');

      const tokenMints = [...new Set((decodeCashuToken(raw) ?? []).map((e) => e.mintUrl).filter(Boolean))];
      if (identityDestination === 'routstr' && tokenMints.length > 1) {
        throw new Error('This token spans multiple mints — receive it in the Wallet tab first, then send yourself a single-mint token and redeem that.');
      }

      const swept = await receiveLockedToken(raw, hex);
      if (!swept) throw new Error('Sweep failed — is this the key the token is locked to?');
      if (identityDestination === 'wallet') return { destination: 'wallet', sats: swept };
      const mint = tokenMints[0];
      const unlocked = await resendUnlocked(swept, mint);
      const res = await redeemUnlocked(unlocked);
      return { destination: 'routstr', ...res, sats: swept };
    },
    onSuccess: (result) => {
      if (result.destination === 'wallet') handleWalletReceiveSuccess(result.sats);
      else handleRedeemSuccess(result);
    },
    onError: (e) => toast({ title: 'Sweep failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }),
  });

  const receiptMutation = useMutation({
    mutationFn: async () => {
      if (!receiptRequestId) throw new Error('Pick the request this redeem paid for.');
      await publish.mutateAsync(buildComputeCreditReceipt({
        requestId: receiptRequestId,
        amountSats: redeemedSats,
        note: receiptNote || 'Redeemed at Routstr for AI compute.',
        provider: 'routstr',
      }));
    },
    onSuccess: () => {
      setReceiptPublished(true);
      toast({ title: 'Spend receipt published', description: 'Funders can now see the credit was redeemed.' });
      onReceiptPublished();
    },
    onError: (e) => toast({ title: 'Receipt failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }),
  });

  // Top up the revealed key with another UNLOCKED token (same NUT-11 caveat
  // as the redeem path: Routstr redeems via an unsigned split at the mint, so
  // P2PK-locked tokens are rejected — sweep them to the wallet first).
  const topupMutation = useMutation({
    mutationFn: async () => {
      if (!apiKey) throw new Error('No compute key to top up.');
      return routstrTopupWithCashu(apiKey, topupToken.trim());
    },
    onSuccess: (res) => {
      setTopupToken('');
      toast({ title: 'Key topped up', description: `Balance is now ${formatSats(res.balance)} msats.` });
      queryClient.invalidateQueries({ queryKey: ['routstr-balance', apiKey] });
    },
    onError: (e) => toast({
      title: 'Top-up failed',
      // Routstr credits the key server-side BEFORE responding (same behavior
      // as the create-balance redeem path) — a dropped response means the
      // top-up may have LANDED and the token's proofs are spent. Say so, or
      // the user retries and reads the mint's "proofs already spent" as the
      // node eating their money.
      description: `${e instanceof Error ? e.message : String(e)} — Routstr credits the key before responding, so a lost response can mean the top-up DID land. Refresh the balance before retrying this token.`,
      variant: 'destructive',
    }),
  });

  const acceptedMints = infoQuery.data?.mints ?? [];
  const busy = redeemMutation.isPending || receiveIntoWalletMutation.isPending || identitySweepMutation.isPending;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <WalletCards className="size-4 text-primary" /> Receive funded Cashu
        </CardTitle>
        <CardDescription>
          Paste a funded token, then either keep the sats in your Cashu wallet or spend them on a Routstr AI-compute key.
          Receiving Cashu does not require buying API credits.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {acceptedMints.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            Routstr accepts tokens from: {acceptedMints.map((m) => m.replace(/^https?:\/\//, '')).join(', ')}
          </p>
        )}

        {apiKey ? (
          <div className="space-y-2">
            <div className="rounded-md border border-green-500/50 bg-green-500/10 p-3 space-y-1.5">
              <p className="text-xs font-semibold text-green-600 dark:text-green-400 flex items-center gap-1.5">
                <CheckCircle2 className="size-3.5" /> Compute key
                {balanceQuery.data && (
                  <span className="font-normal text-muted-foreground">· balance {formatSats(balanceQuery.data.balance)} msats</span>
                )}
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs break-all rounded bg-background/60 px-2 py-1.5">{apiKey}</code>
                <Button
                  size="icon" variant="outline" className="shrink-0"
                  onClick={() => { navigator.clipboard.writeText(apiKey); toast({ title: 'Key copied' }); }}
                >
                  <Copy className="size-3.5" />
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Use it as the API key with any OpenAI-compatible client pointed at{' '}
                <code className="text-[10px]">{ROUTSTR_BASE_URL}/v1</code>. Whoever holds this key can spend the balance.
              </p>
              <p className="text-[11px] text-muted-foreground">
                Running an agent full-time? The{' '}
                <a href="https://routstr.com/routstrd" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
                  routstrd daemon
                </a>{' '}
                discovers nodes on Nostr and auto-routes to the cheapest provider for each model, with a terminal
                dashboard for balance and uptime: <code className="text-[10px]">bun install -g routstrd</code> →{' '}
                <code className="text-[10px]">routstrd onboard</code>.
              </p>
            </div>

            {/* Top up — nodes compete for your sats; keep this key fed instead of minting a new one. */}
            <div className="rounded-md border p-3 space-y-2">
              <p className="text-xs font-medium">Top up this key</p>
              <p className="text-[11px] text-muted-foreground">
                Paste an <span className="font-medium">unlocked</span> Cashu token to add it to this key's balance. Locked tokens are rejected by the node — redeem those to your wallet first.
              </p>
              <Textarea
                value={topupToken}
                onChange={(e) => setTopupToken(e.target.value)}
                rows={2}
                placeholder="cashuA… / cashuB… unlocked token"
                className="font-mono text-xs"
              />
              <Button
                size="sm" variant="outline" className="w-full gap-1.5"
                disabled={!topupToken.trim().startsWith('cashu') || topupMutation.isPending}
                onClick={() => topupMutation.mutate()}
              >
                {topupMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
                Top up
              </Button>
            </div>

            {/* Spend receipt — published ALONGSIDE the key reveal so the moment isn't lost. */}
            {user && !receiptPublished && (
              <div className="rounded-md border p-3 space-y-2">
                <p className="text-xs font-medium">Publish a spend receipt?</p>
                <p className="text-[11px] text-muted-foreground">
                  A signed public note (kind {BAO_COMPUTE_CREDIT_RECEIPT_KIND}) telling funders this credit was redeemed for compute. Builds your track record. The key above is NEVER included.
                </p>
                {myFundedRequests.length > 0 ? (
                  <>
                    <select
                      className="w-full rounded-md border bg-background px-2 py-1.5 text-xs"
                      value={receiptRequestId ?? ''}
                      onChange={(e) => setReceiptRequestId(e.target.value)}
                    >
                      {myFundedRequests.map((r) => (
                        <option key={r.id} value={r.id}>
                          {formatSats(r.amountSats)} sats — {r.purpose.slice(0, 50) || r.id.slice(0, 8)}
                        </option>
                      ))}
                    </select>
                    <Input
                      value={receiptNote}
                      onChange={(e) => setReceiptNote(e.target.value)}
                      placeholder="Note (optional) — e.g. compute for milestone X"
                      className="text-xs"
                    />
                    <Button
                      size="sm" variant="outline" className="w-full gap-1.5"
                      disabled={!receiptRequestId || receiptMutation.isPending}
                      onClick={() => receiptMutation.mutate()}
                    >
                      {receiptMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                      Publish receipt ({formatSats(redeemedSats)} sats)
                    </Button>
                  </>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    No funded requests found for your account — nothing to attach the receipt to.
                  </p>
                )}
              </div>
            )}

            <Button variant="outline" size="sm" className="w-full" onClick={() => setApiKey(null)}>
              Redeem another token
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {walletReceivedSats > 0 && (
              <div className="rounded-md border border-green-500/50 bg-green-500/10 p-3 text-xs">
                <p className="font-semibold text-green-600 dark:text-green-400 flex items-center gap-1.5">
                  <CheckCircle2 className="size-3.5" /> {formatSats(walletReceivedSats)} sats received as Cashu
                </p>
                <p className="mt-1 text-muted-foreground">
                  The sats are in your wallet and remain usable as Cashu. No Routstr key was created. Confirm the matching milestone above only after you see this balance.
                </p>
              </div>
            )}
            <Textarea
              value={token}
              onChange={(e) => { setToken(e.target.value); setWalletReceivedSats(0); setIdentitySweep(false); setLockHints([]); }}
              rows={3}
              placeholder="cashuA… / cashuB… token from a funder"
              className={cn('font-mono text-xs')}
            />
            {identitySweep && (
              <div className="rounded-md border border-amber-500/50 bg-card p-3 space-y-2">
                <p className="text-[11px] text-foreground">
                  This token is locked to a key this wallet doesn't hold. It may be your Nostr identity key (legacy tokens) or a wallet key from another app/device (the funder locks to whatever your latest kind-10019 advertises). Paste the matching private key to sweep it — it never leaves this device.
                </p>
                {lockHints.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[10px] font-medium text-foreground">Locked to pubkey{lockHints.length > 1 ? 's' : ''}:</p>
                    {lockHints.map((l) => (
                      <code key={l} className="block text-[10px] break-all rounded bg-background/60 px-2 py-1">{l}</code>
                    ))}
                  </div>
                )}
                <Input
                  value={privkeyPaste}
                  onChange={(e) => setPrivkeyPaste(e.target.value)}
                  placeholder="nsec1… or 64-char hex"
                  className="font-mono text-xs"
                  type="password"
                />
                <Button
                  size="sm" className="w-full gap-1.5"
                  disabled={!privkeyPaste.trim() || busy}
                  onClick={() => identitySweepMutation.mutate()}
                >
                  {identitySweepMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Cpu className="size-4" />}
                  {identityDestination === 'wallet' ? 'Unlock into Cashu wallet' : 'Unlock for AI compute'}
                </Button>
              </div>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                variant="outline"
                className="w-full gap-1.5 whitespace-normal"
                disabled={!token.trim().startsWith('cashu') || busy}
                onClick={() => receiveIntoWalletMutation.mutate()}
              >
                {receiveIntoWalletMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <WalletCards className="size-4" />}
                Keep as Cashu
              </Button>
              <Button
                className="w-full gap-1.5 whitespace-normal"
                disabled={!token.trim().startsWith('cashu') || busy}
                onClick={() => redeemMutation.mutate()}
              >
                {redeemMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Cpu className="size-4" />}
                Use for AI compute
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
