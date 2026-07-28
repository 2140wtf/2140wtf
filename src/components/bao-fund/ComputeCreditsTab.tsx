import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import { Bot, CheckCircle2, Copy, Cpu, Loader2, Send, Zap } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  BAO_COMPUTE_CREDIT_FULFILLMENT_KIND,
  BAO_COMPUTE_CREDIT_RECEIPT_KIND,
  BAO_COMPUTE_CREDIT_REQUEST_KIND,
  BAO_COMPUTE_CREDIT_TAG,
  buildComputeCreditFulfillment,
  buildComputeCreditReceipt,
  buildComputeCreditRequest,
  parseComputeCreditFulfillment,
  parseComputeCreditReceipt,
  parseComputeCreditRequest,
  resolveCreditLockTarget,
  aggregateAgentCreditStats,
  type ComputeCreditFulfillment,
  type ComputeCreditReceipt,
  type ComputeCreditRequest,
  type CreditLockMode,
} from '@/lib/baoComputeCredits';
import {
  ROUTSTR_BASE_URL,
  routstrCreateBalanceFromCashu,
  routstrGetBalance,
  routstrGetInfo,
} from '@/lib/routstr';
import { NUTZAP_INFO_KIND, parseNutzapInfoEvent } from '@/lib/cashu/cashuNip60';
import { decodeCashuToken } from '@/lib/cashu/cashu';
import { extractTokenLockPubkeys, getTokenAmount } from '@/pets/battle/lib/cashuEscrow';
import { bytesToHex } from '@noble/curves/utils.js';
import { nip19 } from 'nostr-tools';
import { useCashuWalletContext } from '@/hooks/useCashuWalletContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNip17SendMessage } from '@/hooks/useNip17SendMessage';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { useAuthor } from '@/hooks/useAuthor';
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
export function ComputeCreditsTab() {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const queryClient = useQueryClient();

  const requestsQuery = useQuery({
    queryKey: ['bao-compute-credit-requests'],
    queryFn: async ({ signal }) => {
      const since = Math.floor(Date.now() / 1000) - 30 * 24 * 3600;
      const events = await nostr.query(
        [{ kinds: [BAO_COMPUTE_CREDIT_REQUEST_KIND], '#t': [BAO_COMPUTE_CREDIT_TAG], since, limit: 200 }],
        { signal },
      );
      return events
        .map(parseComputeCreditRequest)
        .filter((r): r is ComputeCreditRequest => r !== null)
        .sort((a, b) => b.createdAt - a.createdAt);
    },
    refetchInterval: 30_000,
  });

  const fulfillmentsQuery = useQuery({
    queryKey: ['bao-compute-credit-fulfillments'],
    queryFn: async ({ signal }) => {
      const since = Math.floor(Date.now() / 1000) - 30 * 24 * 3600;
      const events = await nostr.query(
        [{ kinds: [BAO_COMPUTE_CREDIT_FULFILLMENT_KIND], since, limit: 500 }],
        { signal },
      );
      return events.map(parseComputeCreditFulfillment).filter((f) => f !== null);
    },
    refetchInterval: 30_000,
  });

  const requests = useMemo(() => requestsQuery.data ?? [], [requestsQuery.data]);

  const { fulfilledByRequest, claimsByRequest } = useMemo(() => {
    // A kind-4972 event proves NOTHING about payment — anyone can publish one
    // for any request. So it is only trusted as follows:
    //   - authored by the REQUESTER → confirmation of receipt; closes the request
    //   - authored by anyone else   → a funder's "I sent it" claim; displayed
    //     as a marker but never hides the request (a griefer could otherwise
    //     hide every open request without paying a single sat).
    const ownerById = new Map(requests.map((r) => [r.id, r.pubkey]));
    const fulfilled = new Map<string, number>();
    const claims = new Map<string, ComputeCreditFulfillment[]>();
    for (const f of fulfillmentsQuery.data ?? []) {
      if (!f) continue;
      const owner = ownerById.get(f.requestId);
      if (!owner || f.requesterPubkey !== owner) continue; // p tag must match the real requester
      if (f.pubkey === owner) {
        fulfilled.set(f.requestId, (fulfilled.get(f.requestId) ?? 0) + f.amountSats);
      } else {
        const list = claims.get(f.requestId) ?? [];
        list.push(f);
        claims.set(f.requestId, list);
      }
    }
    return { fulfilledByRequest: fulfilled, claimsByRequest: claims };
  }, [fulfillmentsQuery.data, requests]);

  const openRequests = requests.filter((r) => !fulfilledByRequest.has(r.id));
  const myRequests = user ? requests.filter((r) => r.pubkey === user.pubkey) : [];
  const myFundedRequests = myRequests.filter((r) => fulfilledByRequest.has(r.id));

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
          <Zap className="size-4" /> REAL SATS — mainnet Cashu tokens via Routstr
        </p>
        <p className="text-muted-foreground mt-0.5">
          Credits are real Cashu tokens P2PK-locked to the agent, swept in-app, and redeemed for AI compute at{' '}
          <code className="text-xs">{ROUTSTR_BASE_URL}</code>. No demo flags here — tokens only, straight from your wallet.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <RequestCreditCard myRequests={myRequests} fulfilledByRequest={fulfilledByRequest} claimsByRequest={claimsByRequest} onPublished={invalidate} />
        <RedeemCard myFundedRequests={myFundedRequests} onReceiptPublished={invalidate} />
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-1.5">
          <Bot className="size-4 text-primary" /> Open requests
        </h2>
        {requestsQuery.isLoading ? (
          <div className="space-y-3">
            {[0, 1].map((i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
          </div>
        ) : openRequests.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No open compute-credit requests. Agents can post one with the form above.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {openRequests.map((r) => (
              <OpenRequestCard key={r.id} request={r} claims={claimsByRequest.get(r.id) ?? []} onFulfilled={invalidate} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Agent: request credits ────────────────────────────────────────────────────

function RequestCreditCard({ myRequests, fulfilledByRequest, claimsByRequest, onPublished }: {
  myRequests: ComputeCreditRequest[];
  fulfilledByRequest: Map<string, number>;
  claimsByRequest: Map<string, ComputeCreditFulfillment[]>;
  onPublished: () => void;
}) {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const publish = useNostrPublish();
  const [amount, setAmount] = useState('1000');
  const [purpose, setPurpose] = useState('');

  const requestMutation = useMutation({
    mutationFn: () =>
      publish.mutateAsync({
        ...buildComputeCreditRequest({ amountSats: parseInt(amount, 10) || 0, purpose }),
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
    mutationFn: (request: ComputeCreditRequest) =>
      publish.mutateAsync(buildComputeCreditFulfillment({
        requestId: request.id,
        requesterPubkey: request.pubkey,
        amountSats: request.amountSats,
      })),
    onSuccess: () => {
      toast({ title: 'Receipt confirmed', description: 'Your request is now marked as funded.' });
      onPublished();
    },
    onError: (e) => toast({ title: 'Confirm failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }),
  });

  const valid = (parseInt(amount, 10) || 0) > 0 && purpose.trim().length > 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Bot className="size-4 text-primary" /> Request credits (agent)
        </CardTitle>
        <CardDescription>
          Post a public request (kind {BAO_COMPUTE_CREDIT_REQUEST_KIND}) — a funder locks real sats to your pubkey.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="cc-amount">Amount (sats)</Label>
          <Input id="cc-amount" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cc-purpose">What will you build with it?</Label>
          <Textarea id="cc-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={2} placeholder="e.g. Run inference for my oracle dashboard milestone" />
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
              const got = fulfilledByRequest.get(r.id);
              const claims = claimsByRequest.get(r.id) ?? [];
              return (
                <div key={r.id} className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-xs">
                  <span className="truncate">{r.purpose || `${formatSats(r.amountSats)} sats`}</span>
                  {got !== undefined ? (
                    <Badge variant="outline" className="text-green-500 border-green-500/40 shrink-0 gap-1">
                      <CheckCircle2 className="size-3" /> funded {formatSats(got)}
                    </Badge>
                  ) : claims.length > 0 ? (
                    <Button
                      size="sm" variant="outline"
                      className="shrink-0 gap-1 h-6 text-[11px] text-amber-600 dark:text-amber-400 border-amber-500/40"
                      disabled={confirmMutation.isPending}
                      onClick={() => confirmMutation.mutate(r)}
                    >
                      {confirmMutation.isPending ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle2 className="size-3" />}
                      {claims.length} claim{claims.length === 1 ? '' : 's'} — confirm received
                    </Button>
                  ) : (
                    <Badge variant="outline" className="shrink-0">open · {timeAgo(r.createdAt)}</Badge>
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

function OpenRequestCard({ request, claims, onFulfilled }: { request: ComputeCreditRequest; claims: ComputeCreditFulfillment[]; onFulfilled: () => void }) {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { toast } = useToast();
  const publish = useNostrPublish();
  const { allMints, balances, mintUrl, sendToken } = useCashuWalletContext();
  const { sendMessage } = useNip17SendMessage();
  const [token, setToken] = useState<string | null>(null);
  const [lockMode, setLockMode] = useState<CreditLockMode | null>(null);
  const [allowBearer, setAllowBearer] = useState(false);
  const [dmState, setDmState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const [receiptFailed, setReceiptFailed] = useState(false);

  const isOwn = !!user && user.pubkey === request.pubkey;
  const hasWallet = allMints.length > 0;

  // The minted funding token is the ONLY copy of the send proofs (the wallet
  // persists just the change) — if this component unmounts after a DM failure
  // (tab switch, navigation, crash) the sats are gone with the wallet already
  // debited. Keep a localStorage outbox copy until the funder explicitly
  // discards it (agent confirmed receipt).
  const outboxKey = `bao_credit_outbox_${request.id}`;
  useEffect(() => {
    try {
      const raw = localStorage.getItem(outboxKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as { token?: unknown; lockMode?: CreditLockMode; dmState?: string };
      if (saved && typeof saved.token === 'string' && saved.token) {
        setToken(saved.token);
        setLockMode(saved.lockMode ?? null);
        setDmState(saved.dmState === 'sent' ? 'sent' : 'failed');
      }
    } catch { /* corrupted entry — ignore */ }
  }, [outboxKey]);
  useEffect(() => {
    try {
      if (token) localStorage.setItem(outboxKey, JSON.stringify({ token, lockMode, dmState }));
      else localStorage.removeItem(outboxKey);
    } catch { /* storage full/blocked — the on-screen copy still works */ }
  }, [token, lockMode, dmState, outboxKey]);

  // Shared cache with RedeemCard — which mints Routstr accepts for redeem.
  const routstrInfoQuery = useQuery({ queryKey: ['routstr-info'], queryFn: routstrGetInfo, staleTime: 5 * 60_000, retry: 1 });

  const publishReceipt = useMutation({
    mutationFn: async () => {
      await publish.mutateAsync(buildComputeCreditFulfillment({
        requestId: request.id,
        requesterPubkey: request.pubkey,
        amountSats: request.amountSats,
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

      // 2. Balance check at the chosen mint — a raw "Insufficient balance: 0"
      //    from deep in the wallet tells the funder nothing.
      const mintBalance = balances[target.mintUrl] ?? 0;
      if (mintBalance < request.amountSats) {
        const short = target.mintUrl.replace(/^https?:\/\//, '');
        throw new Error(`Not enough balance at ${short} (${mintBalance} sats). Fund that mint first.`);
      }

      // 3. Mint a real Cashu token, P2PK-locked unless bearer was opted in.
      const memo = `₿AO compute credits: ${request.purpose.slice(0, 80)}`;
      const cashuToken = await sendToken(
        request.amountSats,
        memo,
        target.lockPubkey ?? undefined,
        target.mintUrl,
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
          content: `₿AO compute credits for your request "${request.purpose.slice(0, 60)}" (${formatSats(request.amountSats)} sats).\n\n${redeemHint}\n\n${cashuToken}`,
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
      toast({ title: 'Credits sent', description: `${formatSats(request.amountSats)} sats sent to the agent.` });
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
              <span className="font-semibold tabular-nums">{formatSats(request.amountSats)} sats</span>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5 whitespace-pre-wrap">{request.purpose}</p>
            <div className="mt-1.5">
              <AgentReputationBadge pubkey={request.pubkey} />
            </div>
          </div>
          <span className="text-xs text-muted-foreground shrink-0">{timeAgo(request.createdAt)}</span>
        </div>

        {claims.length > 0 && !token && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400">
            {claims.length === 1 ? '1 funder says they already sent this' : `${claims.length} funders say they already sent this`} — check with the agent before double-funding.
          </p>
        )}

        {token ? (
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
                <div className="flex items-center justify-between gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 px-2.5 py-2">
                  <p className="text-[11px] text-amber-600 dark:text-amber-400">
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
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {isOwn ? 'This is your own request.' : hasWallet ? 'Real sats from your Cashu wallet, P2PK-locked to the agent.' : 'Add a Cashu mint in Wallet to fund requests.'}
              </p>
              {!isOwn && user && (
                <Button
                  size="sm" className="gap-1.5 shrink-0"
                  disabled={!hasWallet || fulfillMutation.isPending}
                  onClick={() => fulfillMutation.mutate()}
                >
                  {fulfillMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
                  Send {formatSats(request.amountSats)} sats
                </Button>
              )}
            </div>
            {!isOwn && user && hasWallet && (
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
            )}
          </div>
        )}
      </CardContent>
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
  const { sendToken, receiveToken, receiveLockedToken, sweepWalletLockedToken, getWalletP2pkPubkey } = useCashuWalletContext();
  const [token, setToken] = useState('');
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [redeemedSats, setRedeemedSats] = useState(0);
  const [identitySweep, setIdentitySweep] = useState(false);
  const [lockHints, setLockHints] = useState<string[]>([]);
  const [privkeyPaste, setPrivkeyPaste] = useState('');
  const [receiptRequestId, setReceiptRequestId] = useState<string | null>(null);
  const [receiptNote, setReceiptNote] = useState('');
  const [receiptPublished, setReceiptPublished] = useState(false);

  const infoQuery = useQuery({ queryKey: ['routstr-info'], queryFn: routstrGetInfo, staleTime: 5 * 60_000, retry: 1 });
  const balanceQuery = useQuery({
    queryKey: ['routstr-balance', apiKey],
    queryFn: () => routstrGetBalance(apiKey!),
    enabled: !!apiKey,
    refetchInterval: 60_000,
  });

  /** Re-send swept sats as an unlocked token for Routstr (small fee-reserve retry). */
  const resendUnlocked = async (amount: number, mint?: string): Promise<string> => {
    const memo = 'Routstr compute redeem';
    let t = await sendToken(amount, memo, undefined, mint);
    if (!t) {
      const reserve = Math.max(1, Math.ceil(amount * 0.001));
      if (amount - reserve > 0) t = await sendToken(amount - reserve, memo, undefined, mint);
    }
    if (!t) {
      throw new Error(`Swept ${formatSats(amount)} sats to your wallet but couldn't prepare the Routstr token — your sats are safe in your wallet. Retry the redeem.`);
    }
    return t;
  };

  /** Redeem an unlocked token at Routstr; on failure put the bearer token back in the wallet. */
  const redeemUnlocked = async (unlocked: string): Promise<{ apiKey: string; balance: number }> => {
    try {
      return await routstrCreateBalanceFromCashu(unlocked);
    } catch (e) {
      // receiveToken journals the token BEFORE contacting the mint and never
      // throws (0 on failure) — so even if the receive-back fails right now,
      // the wallet's pending-receive reconciler retries it automatically on
      // the next app launch. Say that honestly instead of claiming the sats
      // are already back.
      const returned = await receiveToken(unlocked);
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(returned > 0
        ? `Routstr redeem failed (${msg}). The sats were returned to your Cashu wallet — retry when Routstr is back.`
        : `Routstr redeem failed (${msg}). The token is saved in your wallet's recovery journal and will be credited automatically on the next app launch — retry the redeem when Routstr is back.`);
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

  const redeemMutation = useMutation({
    mutationFn: async (): Promise<{ apiKey: string; balance: number; sats: number }> => {
      const raw = token.trim();
      const locks = extractTokenLockPubkeys(raw);
      const faceSats = getTokenAmount(raw);

      if (locks.length === 0) {
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
      setIdentitySweep(true);
      throw new Error('This token is locked to a key this wallet doesn\'t hold (see below). If it\'s your Nostr key, paste your nsec/hex; if it\'s a wallet key from another app or device, sweep it there or paste that wallet\'s key.');
    },
    onSuccess: handleRedeemSuccess,
    onError: (e) => toast({ title: 'Redeem failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }),
  });

  const identitySweepMutation = useMutation({
    mutationFn: async (): Promise<{ apiKey: string; balance: number; sats: number }> => {
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
      if (tokenMints.length > 1) {
        throw new Error('This token spans multiple mints — receive it in the Wallet tab first, then send yourself a single-mint token and redeem that.');
      }

      const swept = await receiveLockedToken(raw, hex);
      if (!swept) throw new Error('Sweep failed — is this the key the token is locked to?');
      const mint = tokenMints[0];const unlocked = await resendUnlocked(swept, mint);
      const res = await redeemUnlocked(unlocked);
      return { ...res, sats: swept };
    },
    onSuccess: handleRedeemSuccess,
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

  const acceptedMints = infoQuery.data?.mints ?? [];
  const busy = redeemMutation.isPending || identitySweepMutation.isPending;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Cpu className="size-4 text-primary" /> Redeem at Routstr (agent)
        </CardTitle>
        <CardDescription>
          Paste a Cashu token you received → get an <code className="text-xs">sk_…</code> key that pays for AI inference.
          Locked tokens are swept to your wallet first.
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
            <Textarea
              value={token}
              onChange={(e) => { setToken(e.target.value); setIdentitySweep(false); setLockHints([]); }}
              rows={3}
              placeholder="cashuA… / cashuB… token from a funder"
              className={cn('font-mono text-xs')}
            />
            {identitySweep && (
              <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 space-y-2">
                <p className="text-[11px] text-amber-600 dark:text-amber-400">
                  This token is locked to a key this wallet doesn't hold. It may be your Nostr identity key (legacy tokens) or a wallet key from another app/device (the funder locks to whatever your latest kind-10019 advertises). Paste the matching private key to sweep it — it never leaves this device.
                </p>
                {lockHints.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[10px] font-medium text-amber-600 dark:text-amber-400">Locked to pubkey{lockHints.length > 1 ? 's' : ''}:</p>
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
                  Sweep &amp; redeem
                </Button>
              </div>
            )}
            <Button
              className="w-full gap-1.5"
              disabled={!token.trim().startsWith('cashu') || busy}
              onClick={() => redeemMutation.mutate()}
            >
              {redeemMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Cpu className="size-4" />}
              Redeem for compute key
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
