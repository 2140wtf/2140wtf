import { useMemo, useState } from 'react';
import { nip19 } from 'nostr-tools';
import { ArrowLeft, Swords, UserSearch } from 'lucide-react';
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
import { usePetssCollection } from '@/pets/core/hooks/usePetssCollection';
import { useRemoteBattle } from '../hooks/useRemoteBattle';
import { genUserName } from '@/lib/genUserName';
import { DEFAULT_PRIZE_SATS, DEFAULT_ROUND_DURATION_SECONDS } from '../lib/constants';

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

  const eligiblePets = useMemo(
    () => companions.filter((pet) => pet.stage === 'baby' || pet.stage === 'adult'),
    [companions],
  );

  const [petId, setPetId] = useState<string>('');
  const [opponentMode, setOpponentMode] = useState<'follows' | 'npub'>('follows');
  const [followPubkey, setFollowPubkey] = useState<string>('');
  const [npubInput, setNpubInput] = useState('');
  const [npubError, setNpubError] = useState<string | null>(null);

  const localPet = useMemo(
    () => eligiblePets.find((pet) => pet.d === petId),
    [eligiblePets, petId],
  );

  const opponentPubkey = useMemo<string | null>(() => {
    if (opponentMode === 'follows') {
      return followPubkey || null;
    }
    try {
      const decoded = nip19.decode(npubInput.trim());
      if (decoded.type === 'npub') {
        setNpubError(null);
        return decoded.data;
      }
      if (decoded.type === 'nprofile') {
        setNpubError(null);
        return decoded.data.pubkey;
      }
      setNpubError('Only npub/nprofile identifiers are supported.');
      return null;
    } catch {
      if (npubInput.trim()) {
        setNpubError('Invalid Nostr identifier.');
      } else {
        setNpubError(null);
      }
      return null;
    }
  }, [opponentMode, followPubkey, npubInput]);

  const canSend = !!localPet && !!opponentPubkey;

  const handleSendInvite = async () => {
    if (!localPet || !opponentPubkey) return;
    await remote.sendInvite(opponentPubkey, localPet, {
      prizeAmount: DEFAULT_PRIZE_SATS,
      roundDurationSeconds: DEFAULT_ROUND_DURATION_SECONDS,
    });
  };

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
          </div>
          <Button variant="outline" onClick={remote.cancelInvite}>
            Cancel
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (remote.phase === 'accepted') {
    return (
      <Card className={className}>
        <CardContent className="py-12 text-center space-y-4">
          <p className="font-semibold">Opponent accepted!</p>
          <p className="text-sm text-muted-foreground">Starting the battle…</p>
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

        <Button
          size="lg"
          className="w-full"
          disabled={!canSend}
          onClick={handleSendInvite}
        >
          <Swords className="mr-2 size-4" />
          Send Battle Request
        </Button>
      </CardContent>
    </Card>
  );
}
