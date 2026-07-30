import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { nip19 } from 'nostr-tools';
import { ArrowLeft, Swords, UserSearch, Lock, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useFollows } from '@/hooks/useFollows';
import { useAuthor } from '@/hooks/useAuthor';
import { useAppContext } from '@/hooks/useAppContext';
import { useCashuSeed } from '@/hooks/useCashuSeed';
import { usePetssCollection } from '@/pets/core/hooks/usePetssCollection';
import { usePetsWallet } from '@/pets/core/hooks/usePetsWallet';
import { useRemoteBattle } from '../hooks/useRemoteBattle';
import { genUserName } from '@/lib/genUserName';
import { safeNormalizeMintUrl } from '@/lib/cashu/cashu';
import { DEFAULT_PRIZE_SATS, DEFAULT_ROUND_DURATION_SECONDS } from '../lib/constants';
import { deriveBattleEscrowKeypair, pendingBattleDepositKey, savePendingBattleDeposit, clearPendingBattleDeposit } from '../lib/cashuEscrow';
import { getMultisigDepositLocktime, MULTISIG_REFUND_PERIOD_SECONDS } from '@/lib/cashu/escrowMultisig';
import { EscrowExplainer } from './EscrowExplainer';
import type { BattleMode } from '../lib/battleMessages';

export interface RemoteBattleSetupProps {
  ownerPubkey: string;
  onBack: () => void;
  className?: string;
}

function FollowOption({ pubkey }: { pubkey: string }) {
  const author = useAuthor(pubkey);
  const name = author.data?.metadata?.name ?? genUserName(pubkey);
  const npub = useMemo(() => nip19.npubEncode(pubkey), [pubkey]);

  return (
    <div className="flex flex-col">
      <span className="font-medium truncate">{name}</span>
      <span className="text-xs text-muted-foreground truncate">{npub.slice(0, 18)}…</span>
    </div>
  );
}

export function RemoteBattleSetup({ ownerPubkey: _ownerPubkey, onBack, className }: RemoteBattleSetupProps) {
  const { companions, isLoading: petsLoading } = usePetssCollection();
  const { data: follows, isLoading: followsLoading } = useFollows();
  const remote = useRemoteBattle();
  const { config } = useAppContext();
  const { wallet: petsWallet, isCashu } = usePetsWallet();
  const { seedPhrase, available: seedAvailable } = useCashuSeed();

  const escrowKeypair = useMemo(() => {
    if (!seedPhrase) return null;
    try {
      return deriveBattleEscrowKeypair(seedPhrase);
    } catch {
      return null;
    }
  }, [seedPhrase]);

  const escrowConfigured = !!config.petsBattleEscrowPubkey && !!config.petsBattleEscrowServiceUrl;
  const canUseRealSats = isCashu && seedAvailable && escrowConfigured;
  const battleMode: BattleMode = canUseRealSats ? 'real-sats' : 'demo-sats';
  const operatorPubkey = config.petsBattleEscrowPubkey;

  const eligiblePets = useMemo(
    () => companions.filter((pet) => pet.stage === 'baby' || pet.stage === 'adult'),
    [companions],
  );

  const [petId, setPetId] = useState<string>('');
  const [opponentMode, setOpponentMode] = useState<'follows' | 'npub'>('follows');
  const [followPubkey, setFollowPubkey] = useState<string>('');
  const [npubInput, setNpubInput] = useState('');

  const localPet = useMemo(
    () => eligiblePets.find((pet) => pet.d === petId),
    [eligiblePets, petId],
  );

  const { opponentPubkey, npubError } = useMemo(() => {
    if (opponentMode === 'follows') {
      return { opponentPubkey: followPubkey || null, npubError: null };
    }
    const trimmed = npubInput.trim();
    if (!trimmed) {
      return { opponentPubkey: null, npubError: null };
    }
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type === 'npub' || decoded.type === 'nprofile') {
        return {
          opponentPubkey: decoded.type === 'npub' ? decoded.data : decoded.data.pubkey,
          npubError: null,
        };
      }
      return { opponentPubkey: null, npubError: 'Only npub/nprofile identifiers are supported.' };
    } catch {
      return { opponentPubkey: null, npubError: 'Invalid Nostr identifier.' };
    }
  }, [opponentMode, followPubkey, npubInput]);

  const canSend = !!localPet && !!opponentPubkey;

  // Never send (or silently strand) a real-sats battle the local wallet cannot
  // stake: the auto-deposit effect below skips deposits it cannot afford, and
  // without surfacing that, both players wait on escrow forever.
  const requiredDepositSats = remote.matchOptions?.prizeAmount ?? DEFAULT_PRIZE_SATS;
  // The deposit is drawn from ONE mint: the battle's agreed mint (advertised
  // by the host — the operator rejects mixed-mint releases), else the wallet's
  // active mint. Check THAT mint's balance, not the cross-mint total, or a
  // healthy total over empty deposit-mint strands both players on escrow.
  const depositMint = remote.escrow.agreedMint ?? petsWallet?.mintUrl ?? null;
  const normalizedDepositMint = depositMint ? safeNormalizeMintUrl(depositMint) : null;
  const depositMintBalanceKnown =
    !!normalizedDepositMint &&
    !!petsWallet &&
    Object.prototype.hasOwnProperty.call(petsWallet.balances, normalizedDepositMint);
  const walletBalanceSats = depositMintBalanceKnown
    ? petsWallet!.balances[normalizedDepositMint!]
    : (petsWallet?.totalBalance ?? 0);
  const hasStakeBalance = walletBalanceSats >= requiredDepositSats;
  const myDepositToken = remote.role === 'host'
    ? remote.escrow.hostDepositToken
    : remote.escrow.guestDepositToken;
  const awaitingMyDeposit =
    remote.escrow.mode === 'real-sats' &&
    (remote.phase === 'accepted' || remote.phase === 'inviting') &&
    !!petsWallet &&
    !!operatorPubkey &&
    !myDepositToken;
  const insufficientForDeposit = awaitingMyDeposit && !hasStakeBalance;

  const handleSendInvite = async () => {
    if (!localPet || !opponentPubkey) return;
    if (battleMode === 'real-sats' && !escrowKeypair) return;
    if (battleMode === 'real-sats' && !hasStakeBalance) return;
    await remote.sendInvite(opponentPubkey, localPet, {
      prizeAmount: DEFAULT_PRIZE_SATS,
      roundDurationSeconds: DEFAULT_ROUND_DURATION_SECONDS,
      mode: battleMode,
    }, escrowKeypair?.pubkey, battleMode === 'real-sats' ? petsWallet?.mintUrl : undefined);
  };

  const [isDepositing, setIsDepositing] = useState(false);
  const [depositError, setDepositError] = useState<string | null>(null);
  // Tracks WHICH battle (by battleId) the auto-deposit was attempted for — a
  // plain boolean would stay true forever, so a re-invite from this same
  // mounted component would silently skip the deposit and hang the escrow.
  const depositAttemptedForRef = useRef<string | null>(null);
  // Retains the minted deposit token until it is DELIVERED. The wallet is
  // debited at mint time, so losing this string on a publish failure would
  // strand real sats locked to the escrow operator. Mirrored to localStorage
  // so a page refresh mid-flight doesn't lose it either.
  const pendingDepositTokenRef = useRef<string | null>(null);
  const depositStorageKey = remote.battleId ? pendingBattleDepositKey(remote.battleId) : null;

  // Restore an undelivered deposit token after a refresh.
  useEffect(() => {
    if (!depositStorageKey) return;
    try {
      const saved = localStorage.getItem(depositStorageKey);
      if (saved) {
        pendingDepositTokenRef.current = saved;
        setDepositTokenForReclaim(saved);
      }
    } catch { /* storage blocked — in-memory ref still works */ }
  }, [depositStorageKey]);

  const attemptDeposit = useCallback(async () => {
    if (!petsWallet || !operatorPubkey) return;
    const hostKey = remote.escrow.hostEscrowPubkey;
    const guestKey = remote.escrow.guestEscrowPubkey;
    if (!hostKey || !guestKey) {
      setDepositError('Escrow keys were not exchanged yet — wait a moment and retry.');
      return;
    }
    if (!escrowKeypair) {
      setDepositError('Your battle escrow key is not available — cannot lock the stake.');
      return;
    }
    setIsDepositing(true);
    setDepositError(null);
    try {
      const amount = remote.matchOptions?.prizeAmount ?? DEFAULT_PRIZE_SATS;
      let token = pendingDepositTokenRef.current;
      if (!token) {
        // 2-of-3 multisig escrow (₿AO escrow primitive): the stake locks to
        // {host, guest, operator} and needs ANY TWO signatures to move. The
        // operator can never take the funds alone; if the battle is abandoned
        // our own refund key reclaims the stake after the 24h locktime.
        // Stake from the agreed mint when one was negotiated — the operator
        // rejects mixed-mint releases, so any other mint strands both stakes.
        token = await petsWallet.sendMultisigLockedToken(amount, {
          partyAPubkey: hostKey,
          partyBPubkey: guestKey,
          operatorPubkey,
          refundPubkey: escrowKeypair.pubkey,
          locktime: Math.floor(Date.now() / 1000) + MULTISIG_REFUND_PERIOD_SECONDS,
        }, `Battle escrow ${remote.battleId ?? ''}`, remote.escrow.agreedMint);
        if (!token) throw new Error(petsWallet.error ?? 'Wallet did not return a deposit token.');
        pendingDepositTokenRef.current = token;
        setDepositTokenForReclaim(token);
        if (remote.battleId) savePendingBattleDeposit(remote.battleId, token);
      }
      const delivered = await remote.sendEscrowDeposit(token);
      if (!delivered) throw new Error('Failed to deliver the escrow deposit — your sats are safe in the deposit token; retry to deliver it.');
      // Do NOT clear the journaled token here: a relay ack only proves one
      // relay accepted the ephemeral sync event, not that the opponent
      // received it. The journal is kept until the stake resolves — released
      // to the winner, or reclaimed via the refund path — so an abandoned
      // battle can never strand real sats.
    } catch (err) {
      console.error('[RemoteBattleSetup] escrow deposit failed:', err);
      setDepositError(err instanceof Error ? err.message : 'Escrow deposit failed.');
    } finally {
      setIsDepositing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [petsWallet, operatorPubkey, escrowKeypair, remote.matchOptions?.prizeAmount, remote.battleId, remote.escrow.hostEscrowPubkey, remote.escrow.guestEscrowPubkey, remote.escrow.agreedMint, remote.sendEscrowDeposit, depositStorageKey]);

  // The journaled deposit token is RETAINED after delivery: it is the only
  // handle on the locked stake, and the post-locktime refund path needs it.
  // It is cleared only when the stake resolves — the prize claim spends it
  // (winner), the release spends it (loser), or the refund reclaim below
  // sweeps it back (abandoned battle). PetsBattlePage additionally sweeps
  // stale journals whose proofs are spent or whose locktime has passed.
  const myDepositAcked = !!remote.escrow.myDepositAcked;
  const [depositTokenForReclaim, setDepositTokenForReclaim] = useState<string | null>(null);
  const depositLocktime = useMemo(
    () => (depositTokenForReclaim ? getMultisigDepositLocktime(depositTokenForReclaim) : null),
    [depositTokenForReclaim],
  );
  // Tick every 30s so the refund UI flips when the locktime passes.
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = setInterval(() => setNowSeconds(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(timer);
  }, []);
  const refundUnlocked = depositLocktime !== null && nowSeconds >= depositLocktime;
  const canReclaim =
    remote.escrow.mode === 'real-sats' &&
    (remote.phase === 'inviting' || remote.phase === 'accepted' || remote.phase === 'cancelled') &&
    !!depositTokenForReclaim &&
    refundUnlocked;

  const [isReclaiming, setIsReclaiming] = useState(false);
  const attemptReclaim = useCallback(async () => {
    if (!petsWallet || !escrowKeypair) return;
    const token = depositTokenForReclaim ?? pendingDepositTokenRef.current;
    if (!token) return;
    setIsReclaiming(true);
    setDepositError(null);
    try {
      // Post-locktime the mint honors the refund key (our own escrow key)
      // with a single signature — no operator, no opponent needed.
      const received = await petsWallet.receiveLockedToken(token, escrowKeypair.privkey);
      if (received > 0) {
        pendingDepositTokenRef.current = null;
        setDepositTokenForReclaim(null);
        if (remote.battleId) clearPendingBattleDeposit(remote.battleId);
        // Tell the opponent the escrow is unwound so they stop waiting (their
        // own stake refunds the same way).
        void remote.cancelInvite();
      } else {
        setDepositError(petsWallet.error || 'Reclaim failed — the stake may already have been released, or the mint is unreachable. Your deposit token is kept locally for another try.');
      }
    } finally {
      setIsReclaiming(false);
    }
  }, [petsWallet, escrowKeypair, depositTokenForReclaim, remote]);

  // End-to-end delivery: re-publish the deposit until the opponent acks.
  // The sync event is ephemeral, so a receiver that was mid-reconnect (or on
  // disjoint relays) never sees a one-shot publish — without retransmission
  // the stake sits locked to the operator while both sides wait on escrow.
  // Stops on ack, on a rejection (a deterministic refusal won't heal by
  // spamming), or after a minute, leaving the journaled token for manual
  // retry.
  const depositRejection = remote.escrow.depositRejectReason;
  const sendEscrowDeposit = remote.sendEscrowDeposit;
  useEffect(() => {
    if (remote.escrow.mode !== 'real-sats') return;
    if (remote.phase !== 'accepted' && remote.phase !== 'inviting') return;
    if (!myDepositToken || myDepositAcked || depositRejection) return;
    if (!pendingDepositTokenRef.current) return;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      const token = pendingDepositTokenRef.current;
      if (!token || attempts > 12) {
        clearInterval(timer);
        if (token) {
          setDepositError('Deposit sent but the opponent has not confirmed receipt — your sats remain locked in the deposit token, kept locally for retry. Make sure the opponent is online, then retry the deposit.');
        }
        return;
      }
      void sendEscrowDeposit(token);
    }, 5_000);
    return () => clearInterval(timer);
  }, [
    remote.escrow.mode,
    remote.phase,
    myDepositToken,
    myDepositAcked,
    depositRejection,
    sendEscrowDeposit,
  ]);

  useEffect(() => {
    if (remote.escrow.mode !== 'real-sats') return;
    if (remote.phase !== 'accepted' && remote.phase !== 'inviting') return;
    if (depositAttemptedForRef.current === remote.battleId || isDepositing) return;
    if (!petsWallet || !operatorPubkey) return;
    if (remote.role === 'host' && !remote.escrow.guestEscrowPubkey) return;
    if (remote.role === 'guest' && !remote.escrow.hostEscrowPubkey) return;
    const myDeposit = remote.role === 'host'
      ? remote.escrow.hostDepositToken
      : remote.escrow.guestDepositToken;
    if (myDeposit) return;

    // Per-mint check: the deposit draws from the agreed/active mint only.
    if (!hasStakeBalance) return;

    depositAttemptedForRef.current = remote.battleId;
    void attemptDeposit();
  }, [
    remote.escrow.mode,
    remote.phase,
    remote.role,
    remote.escrow.guestEscrowPubkey,
    remote.escrow.hostEscrowPubkey,
    remote.escrow.hostDepositToken,
    remote.escrow.guestDepositToken,
    remote.battleId,
    petsWallet,
    operatorPubkey,
    isDepositing,
    hasStakeBalance,
    attemptDeposit,
  ]);

  // Refund safety block: while a journaled deposit exists, show when the
  // refund unlocks — and once the locktime passes, a one-click reclaim that
  // sweeps the stake back with our own refund key (no operator, no opponent).
  const refundBlock = remote.escrow.mode === 'real-sats' && depositTokenForReclaim ? (
    canReclaim ? (
      <div className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3">
        <p className="text-xs text-muted-foreground">
          This battle never started. Your {requiredDepositSats.toLocaleString()}-sat stake is unlocked for refund — reclaim it to your wallet.
        </p>
        <Button
          size="sm" variant="outline" className="gap-1.5"
          disabled={isReclaiming}
          onClick={() => void attemptReclaim()}
        >
          {isReclaiming ? <Loader2 className="size-3.5 animate-spin" /> : <Lock className="size-3.5" />}
          Reclaim my stake
        </Button>
      </div>
    ) : depositLocktime ? (
      <p className="text-xs text-muted-foreground">
        Stake locked in 2-of-3 escrow. If this battle never finishes, your stake is refundable after {new Date(depositLocktime * 1000).toLocaleString()} — no operator needed.
      </p>
    ) : null
  ) : null;

  if (remote.phase === 'inviting') {
    return (
      <Card className={className}>
        <CardContent className="py-12 text-center space-y-4">
          <Swords className="mx-auto size-8 text-primary animate-pulse" />
          <div>
            <p className="font-semibold">Battle request sent!</p>
            <p className="text-sm text-muted-foreground">
              Waiting for opponent… {Math.ceil((remote.timeLeftMs ?? 0) / 1000)}s
            </p>
            {battleMode === 'real-sats' && !hasStakeBalance && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Your wallet balance ({walletBalanceSats.toLocaleString()} sats) is below the {requiredDepositSats.toLocaleString()}-sat stake — top up before the opponent accepts or the battle cannot start.
              </p>
            )}
          </div>
          {refundBlock}
          <Button variant="outline" onClick={remote.cancelInvite}>
            Cancel
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (remote.phase === 'accepted') {
    const escrowReady = remote.escrow.mode === 'demo-sats' || remote.escrow.phase === 'ready';
    return (
      <Card className={className}>
        <CardContent className="py-12 text-center space-y-4">
          <p className="font-semibold">Opponent accepted!</p>
          {remote.escrow.mode === 'real-sats' ? (
            <div className="space-y-2">
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Lock className="size-4" />
                {escrowReady
                  ? 'Escrow deposits ready. Starting the battle…'
                  : isDepositing
                    ? 'Locking your stake in escrow…'
                    : 'Waiting for escrow deposits…'}
              </div>
              {remote.escrow.agreedMint && (
                <p className="text-xs text-muted-foreground">
                  Stakes lock from mint: {remote.escrow.agreedMint.replace(/^https?:\/\//, '')}
                </p>
              )}
              {!escrowReady && !depositError && !insufficientForDeposit && !depositRejection && <Loader2 className="mx-auto size-5 animate-spin text-primary" />}
              {depositRejection && !escrowReady && (
                <div className="space-y-2 rounded-md border border-destructive/50 bg-destructive/10 p-3">
                  <p className="text-xs text-destructive">
                    The opponent rejected your escrow deposit: {depositRejection}. Your sats remain locked in the deposit token, kept locally — cancel this battle and start a fresh one to retry.
                  </p>
                  {remote.role === 'host' && (
                    <Button size="sm" variant="outline" onClick={() => void remote.cancelInvite()}>
                      Cancel battle
                    </Button>
                  )}
                </div>
              )}
              {insufficientForDeposit && !escrowReady && (
                <div className="space-y-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3">
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Insufficient balance — this battle stakes {requiredDepositSats.toLocaleString()} sats but your wallet has {walletBalanceSats.toLocaleString()}. Top up your Cashu wallet and the deposit is sent automatically.
                  </p>
                  {remote.role === 'host' && (
                    <Button size="sm" variant="outline" onClick={() => void remote.cancelInvite()}>
                      Cancel battle
                    </Button>
                  )}
                </div>
              )}
              {depositError && !escrowReady && (
                <div className="space-y-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3">
                  <p className="text-xs text-amber-600 dark:text-amber-400">{depositError}</p>
                  <Button
                    size="sm" variant="outline" className="gap-1.5"
                    disabled={isDepositing}
                    onClick={() => void attemptDeposit()}
                  >
                    {isDepositing ? <Loader2 className="size-3.5 animate-spin" /> : <Lock className="size-3.5" />}
                    Retry deposit
                  </Button>
                </div>
              )}
              {refundBlock}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Starting the battle…</p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Button variant="ghost" size="icon" className="-ml-2 size-8" onClick={onBack}>
            <ArrowLeft className="size-4" />
          </Button>
          <Swords className="size-5 text-primary" />
          Battle a Friend
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {petsLoading ? (
          <p className="text-sm text-muted-foreground">Loading your pets…</p>
        ) : eligiblePets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            You need a hatched pet to battle.
          </p>
        ) : (
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Your Fighter
            </label>
            <Select value={petId} onValueChange={setPetId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose your pet" />
              </SelectTrigger>
              <SelectContent>
                {eligiblePets.map((pet) => (
                  <SelectItem key={pet.d} value={pet.d}>
                    {pet.name} ({pet.stage})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-3">
          <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Opponent
          </label>
          <div className="flex gap-2">
            <Button
              variant={opponentMode === 'follows' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setOpponentMode('follows')}
            >
              Follows
            </Button>
            <Button
              variant={opponentMode === 'npub' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setOpponentMode('npub')}
            >
              npub
            </Button>
          </div>

          {opponentMode === 'follows' ? (
            followsLoading ? (
              <p className="text-sm text-muted-foreground">Loading follows…</p>
            ) : !follows || follows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                You aren't following anyone yet. Switch to npub to challenge by pubkey.
              </p>
            ) : (
              <Select value={followPubkey} onValueChange={setFollowPubkey}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose an opponent" />
                </SelectTrigger>
                <SelectContent>
                  {follows.map((pubkey) => (
                    <SelectItem key={pubkey} value={pubkey}>
                      <FollowOption pubkey={pubkey} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )
          ) : (
            <div className="space-y-1.5">
              <div className="relative">
                <UserSearch className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  value={npubInput}
                  onChange={(e) => setNpubInput(e.target.value)}
                  placeholder="npub1…"
                  className="pl-9"
                />
              </div>
              {npubError && <p className="text-xs text-destructive">{npubError}</p>}
            </div>
          )}
        </div>

        {remote.error && (
          <p className="text-sm text-destructive">{remote.error}</p>
        )}

        <div className="rounded-lg bg-muted p-3 text-sm space-y-1">
          <p>
            <span className="font-medium">Prize:</span> {DEFAULT_PRIZE_SATS.toLocaleString()}{' '}
            {battleMode === 'real-sats' ? 'real sats' : 'demo sats'}
          </p>
          {battleMode === 'real-sats' ? (
            <>
              <p className="text-muted-foreground">
                Both players lock {DEFAULT_PRIZE_SATS.toLocaleString()} real sats in escrow before the battle. The winner claims both stakes.
              </p>
              <EscrowExplainer />
              {!hasStakeBalance && (
                <p className="text-amber-600 dark:text-amber-400">
                  Your wallet balance ({walletBalanceSats.toLocaleString()} sats) is below the stake — top up your Cashu wallet to send a real-sats battle request.
                </p>
              )}
            </>
          ) : (
            <p className="text-muted-foreground">
              Real-sats battles require real Cashu mode and a configured escrow operator.
            </p>
          )}
        </div>

        {refundBlock}

        <Button
          size="lg"
          className="w-full"
          disabled={!canSend || (battleMode === 'real-sats' && !hasStakeBalance)}
          onClick={handleSendInvite}
        >
          <Swords className="mr-2 size-4" />
          Send Battle Request
        </Button>
      </CardContent>
    </Card>
  );
}
