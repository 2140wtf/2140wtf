import { useEffect, useMemo, useRef, useState } from 'react';
import { Users, Radio, Loader2, DoorOpen, Gavel, Beaker } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useDemoCourtRoom } from '@/hooks/useDemoCourtRoom';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { DEMO_BOND_AMOUNT_SATS, electCoordinator } from '@/lib/baoCourtSimulator';
import type { BaoCourtDispute } from '@/hooks/useBaoCourtDisputes';
import type { JurorSettingsState } from './JurorSettings';
import type { SelectedJuror } from '@bao/frost-court';

const DEFAULT_CATEGORIES = ['sports', 'politics', 'crypto', 'science', 'entertainment', 'world'];
const THRESHOLD_OPTIONS = [3, 4, 5];

interface DemoCourtLobbyProps {
  readonly settings: JurorSettingsState;
  readonly onSessionReady: (
    dispute: BaoCourtDispute,
    selectedJurors: SelectedJuror[],
    seed: string,
    myJurorIdx: number,
  ) => void;
}

function truncatePubkey(pubkey: string): string {
  if (pubkey.length <= 12) return pubkey;
  return `${pubkey.slice(0, 6)}…${pubkey.slice(-6)}`;
}

export function DemoCourtLobby({
  settings,
  onSessionReady,
}: DemoCourtLobbyProps) {
  const { user } = useCurrentUser();

  const [roomName, setRoomName] = useState('demo-room');
  const [category, setCategory] = useState(settings.categories[0] ?? 'world');
  const [threshold, setThreshold] = useState(3);

  const room = useDemoCourtRoom({
    roomName,
    category,
    threshold,
    pace: settings.demoPace,
  });

  const myJurorIdx = useMemo(() => {
    if (!user) return 1;
    return room.selectedJurors.findIndex((j) => j.nostrPubkey === user.pubkey) + 1 || 1;
  }, [room.selectedJurors, user]);

  const coordinatorPubkey = useMemo(
    () => (room.members.length >= threshold ? electCoordinator(room.members.map((m) => m.pubkey)) : null),
    [room.members, threshold],
  );

  const sessionTriggeredRef = useRef(false);

  useEffect(() => {
    if (room.status !== 'formed') {
      sessionTriggeredRef.current = false;
    }
  }, [room.status]);

  useEffect(() => {
    if (room.status === 'formed' && room.dispute && room.seed && !sessionTriggeredRef.current) {
      sessionTriggeredRef.current = true;
      onSessionReady(room.dispute, room.selectedJurors, room.seed, myJurorIdx);
    }
  }, [room.status, room.dispute, room.seed, room.selectedJurors, myJurorIdx, onSessionReady]);

  const statusMessage = () => {
    switch (room.status) {
      case 'idle':
        return 'Enter a room name, pick a category, and join to simulate a jury with other users.';
      case 'joining':
        return 'Publishing your demo-room membership…';
      case 'waiting':
        return `Waiting for ${threshold - room.members.length} more juror${threshold - room.members.length === 1 ? '' : 's'}…`;
      case 'settling':
      case 'forming':
        return room.isCoordinator
          ? 'You are the coordinator. Publishing the mock dispute and jury selection…'
          : 'Jury threshold reached. Waiting for the coordinator to publish the selection…';
      case 'formed':
        return `Demo jury formed — you are Juror #${myJurorIdx}. Starting FROST ceremony…`;
      case 'error':
        return room.error ?? 'Something went wrong.';
      default:
        return '';
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Beaker className="size-5 text-amber-500" />
            <CardTitle className="text-base">Demo jury lobby</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="demo-room-name">Room name</Label>
              <Input
                id="demo-room-name"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                disabled={room.status !== 'idle' && room.status !== 'error'}
                placeholder="e.g. crypto-demo"
              />
            </div>

            <div className="space-y-2">
              <Label>Category</Label>
              <div className="flex flex-wrap gap-2">
                {DEFAULT_CATEGORIES.map((c) => (
                  <Badge
                    key={c}
                    variant={category === c ? 'default' : 'outline'}
                    className="cursor-pointer capitalize"
                    onClick={() => {
                      if (room.status === 'idle' || room.status === 'error') {
                        setCategory(c);
                      }
                    }}
                  >
                    {c}
                  </Badge>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Jurors needed</Label>
            <div className="flex flex-wrap gap-2">
              {THRESHOLD_OPTIONS.map((n) => (
                <Button
                  key={n}
                  type="button"
                  variant={threshold === n ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => {
                    if (room.status === 'idle' || room.status === 'error') {
                      setThreshold(n);
                    }
                  }}
                >
                  {n}
                </Button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <Radio className={cn('size-4', room.status === 'waiting' && 'text-amber-500 animate-pulse')} />
              <span className="font-medium">{statusMessage()}</span>
            </div>

            {room.members.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Jurors in room ({room.members.length}/{threshold})
                </p>
                <div className="grid gap-2">
                  {room.members.map((member) => {
                    const isCoordinator = member.pubkey === coordinatorPubkey;
                    const jurorNumber = room.selectedJurors.findIndex((j) => j.nostrPubkey === member.pubkey) + 1 || undefined;
                    return (
                      <div
                        key={member.pubkey}
                        className={cn(
                          'flex items-center justify-between rounded-md border p-2 text-sm',
                          member.pubkey === user?.pubkey && 'border-primary bg-primary/5',
                        )}
                      >
                        <span className="font-mono text-xs">{truncatePubkey(member.pubkey)}</span>
                        <div className="flex items-center gap-1">
                          {jurorNumber !== undefined && (
                            <Badge variant="outline">#{jurorNumber}</Badge>
                          )}
                          {member.pubkey === user?.pubkey && <Badge variant="outline">You</Badge>}
                          {isCoordinator && <Badge variant="secondary">Coordinator</Badge>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Gavel className="size-3" />
              <span>
                Fake bond locked: {DEMO_BOND_AMOUNT_SATS.toLocaleString()} sats per juror
              </span>
            </div>
          </div>

          <div className="flex gap-2">
            {room.status === 'idle' || room.status === 'error' || room.status === 'joining' ? (
              <Button
                onClick={() => void room.join()}
                disabled={!roomName.trim() || !user || room.status === 'joining'}
                className="flex-1"
              >
                {room.status === 'joining' && <Loader2 className="size-4 mr-2 animate-spin" />}
                <Users className="size-4 mr-2" />
                Join demo jury
              </Button>
            ) : (
              <Button onClick={room.leave} variant="outline" className="flex-1">
                <DoorOpen className="size-4 mr-2" />
                Leave room
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
