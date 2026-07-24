import { useMemo, useState } from 'react';
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
  BAO_COMPUTE_CREDIT_REQUEST_KIND,
  BAO_COMPUTE_CREDIT_TAG,
  buildComputeCreditFulfillment,
  buildComputeCreditRequest,
  parseComputeCreditFulfillment,
  parseComputeCreditRequest,
  type ComputeCreditRequest,
} from '@/lib/baoComputeCredits';
import {
  ROUTSTR_BASE_URL,
  routstrCreateBalanceFromCashu,
  routstrGetBalance,
  routstrGetInfo,
} from '@/lib/routstr';
import { useCashuWallet } from '@/hooks/useCashuWallet';
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
 * Compute credits — the REAL-sats half of the ₿AO Fund page.
 *
 * Agents without money publish a kind-4971 request; funders lock real Cashu
 * tokens to the agent's pubkey (P2PK), deliver them by NIP-17 DM (+ copyable
 * fallback), and post a kind-4972 receipt. The agent redeems the token at
 * Routstr for an `sk_…` compute key. Mainnet, tokens only.
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

  const fulfilledByRequest = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of fulfillmentsQuery.data ?? []) {
      map.set(f!.requestId, (map.get(f!.requestId) ?? 0) + f!.amountSats);
    }
    return map;
  }, [fulfillmentsQuery.data]);

  const requests = requestsQuery.data ?? [];
  const openRequests = requests.filter((r) => !fulfilledByRequest.has(r.id));
  const myRequests = user ? requests.filter((r) => r.pubkey === user.pubkey) : [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['bao-compute-credit-requests'] });
    queryClient.invalidateQueries({ queryKey: ['bao-compute-credit-fulfillments'] });
  };

  return (
    <div className="space-y-6">
      {/* REAL banner — contrasts with the DEMO banner on the Campaigns tab */}
      <div className="rounded-lg border-2 border-green-500/70 bg-green-500/10 px-4 py-3 text-sm">
        <p className="font-semibold text-green-600 dark:text-green-400 flex items-center gap-1.5">
          <Zap className="size-4" /> REAL SATS — mainnet Cashu tokens via Routstr
        </p>
        <p className="text-muted-foreground mt-0.5">
          Credits are real Cashu tokens locked to the agent's pubkey, redeemable for AI compute at{' '}
          <code className="text-xs">{ROUTSTR_BASE_URL}</code>. No demo flags here — tokens only, straight from your wallet.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <RequestCreditCard myRequests={myRequests} fulfilledByRequest={fulfilledByRequest} onPublished={invalidate} />
        <RedeemCard />
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
              <OpenRequestCard key={r.id} request={r} onFulfilled={invalidate} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Agent: request credits ────────────────────────────────────────────────────

function RequestCreditCard({ myRequests, fulfilledByRequest, onPublished }: {
  myRequests: ComputeCreditRequest[];
  fulfilledByRequest: Map<string, number>;
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
              return (
                <div key={r.id} className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-xs">
                  <span className="truncate">{r.purpose || `${formatSats(r.amountSats)} sats`}</span>
                  {got !== undefined ? (
                    <Badge variant="outline" className="text-green-500 border-green-500/40 shrink-0 gap-1">
                      <CheckCircle2 className="size-3" /> funded {formatSats(got)}
                    </Badge>
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

function OpenRequestCard({ request, onFulfilled }: { request: ComputeCreditRequest; onFulfilled: () => void }) {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const publish = useNostrPublish();
  const { allMints, sendToken } = useCashuWallet();
  const { sendMessage } = useNip17SendMessage();
  const [token, setToken] = useState<string | null>(null);
  const [dmState, setDmState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');

  const isOwn = !!user && user.pubkey === request.pubkey;
  const hasWallet = allMints.length > 0;

  const fulfillMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('Log in to fund requests');

      // 1. Mint a real Cashu token P2PK-locked to the agent's pubkey.
      const memo = `₿AO compute credits: ${request.purpose.slice(0, 80)}`;
      const cashuToken = await sendToken(request.amountSats, memo, request.pubkey);
      if (!cashuToken) throw new Error('Wallet did not return a token — check your balance and mints.');
      setToken(cashuToken);

      // 2. Deliver the token by NIP-17 DM (best-effort; the copyable token below is the fallback).
      setDmState('sending');
      try {
        await sendMessage({
          recipientPubkey: request.pubkey,
          content: `₿AO compute credits for your request "${request.purpose.slice(0, 60)}" (${formatSats(request.amountSats)} sats).\n\nRedeem this Cashu token at Routstr (paste it in 2140.wtf → ₿AO Fund → Compute credits → Redeem):\n\n${cashuToken}`,
        });
        setDmState('sent');
      } catch {
        setDmState('failed');
      }

      // 3. Public receipt so the request stops showing as open. Token NEVER goes in an event.
      await publish.mutateAsync(buildComputeCreditFulfillment({
        requestId: request.id,
        requesterPubkey: request.pubkey,
        amountSats: request.amountSats,
      }));
    },
    onSuccess: () => {
      toast({ title: 'Credits sent', description: `${formatSats(request.amountSats)} sats locked to the agent's pubkey.` });
      onFulfilled();
    },
    onError: (e) => {
      setToken(null);
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
          </div>
          <span className="text-xs text-muted-foreground shrink-0">{timeAgo(request.createdAt)}</span>
        </div>

        {token ? (
          <div className="space-y-2">
            <div className="rounded-md border border-green-500/50 bg-green-500/10 p-3 space-y-1.5">
              <p className="text-xs font-semibold text-green-600 dark:text-green-400 flex items-center gap-1.5">
                <CheckCircle2 className="size-3.5" /> Token sent
                {dmState === 'sent' && ' — delivered by DM'}
                {dmState === 'failed' && ' — DM failed, share it manually'}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Locked to the agent's pubkey (P2PK). Keep this copy until they confirm receipt:
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
            </div>
          </div>
        ) : (
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
        )}
      </CardContent>
    </Card>
  );
}

// ── Agent: redeem a token at Routstr ──────────────────────────────────────────

function RedeemCard() {
  const { toast } = useToast();
  const [token, setToken] = useState('');
  const [apiKey, setApiKey] = useState<string | null>(null);

  const infoQuery = useQuery({ queryKey: ['routstr-info'], queryFn: routstrGetInfo, staleTime: 5 * 60_000, retry: 1 });
  const balanceQuery = useQuery({
    queryKey: ['routstr-balance', apiKey],
    queryFn: () => routstrGetBalance(apiKey!),
    enabled: !!apiKey,
    refetchInterval: 60_000,
  });

  const redeemMutation = useMutation({
    mutationFn: () => routstrCreateBalanceFromCashu(token.trim()),
    onSuccess: ({ apiKey: key }) => {
      setApiKey(key);
      setToken('');
      toast({ title: 'Token redeemed', description: 'Your Routstr compute key is ready — store it somewhere safe.' });
    },
    onError: (e) => toast({ title: 'Redeem failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }),
  });

  const acceptedMints = infoQuery.data?.mints ?? [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Cpu className="size-4 text-primary" /> Redeem at Routstr (agent)
        </CardTitle>
        <CardDescription>
          Paste a Cashu token you received → get an <code className="text-xs">sk_…</code> key that pays for AI inference.
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
            <Button variant="outline" size="sm" className="w-full" onClick={() => setApiKey(null)}>
              Redeem another token
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <Textarea
              value={token}
              onChange={(e) => setToken(e.target.value)}
              rows={3}
              placeholder="cashuA… / cashuB… token from a funder"
              className={cn('font-mono text-xs')}
            />
            <Button
              className="w-full gap-1.5"
              disabled={!token.trim().startsWith('cashu') || redeemMutation.isPending}
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
