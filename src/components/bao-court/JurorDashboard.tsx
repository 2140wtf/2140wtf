import { useCallback, useState } from "react";
import { Gavel, List, Settings, Beaker } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { useBaoCourtDisputes, type BaoCourtDispute } from "@/hooks/useBaoCourtDisputes";
import { DisputeCard } from "./DisputeCard";
import { JurorRegistrationCard } from "./JurorRegistrationCard";
import { JurorSessionModal } from "./JurorSessionModal";
import { JurorSettings, type JurorSettingsState } from "./JurorSettings";
import { DemoCourtLobby } from "./DemoCourtLobby";
import type { SelectedJuror } from "@bao/frost-court";

interface JurorDashboardProps {
  readonly settings: JurorSettingsState;
  readonly onSettingsChange: (settings: JurorSettingsState) => void;
}

function truncatePubkey(pubkey: string): string {
  if (pubkey.length <= 12) return pubkey;
  return `${pubkey.slice(0, 6)}…${pubkey.slice(-6)}`;
}

interface DemoSession {
  readonly dispute: BaoCourtDispute;
  readonly selectedJurors: SelectedJuror[];
  readonly seed: string;
  readonly myJurorIdx: number;
}

export function JurorDashboard({ settings, onSettingsChange }: JurorDashboardProps) {
  const { data: disputes = [], isLoading } = useBaoCourtDisputes();
  const [selectedDispute, setSelectedDispute] = useState<BaoCourtDispute | null>(null);
  const [demoSession, setDemoSession] = useState<DemoSession | null>(null);
  const [sessionOpen, setSessionOpen] = useState(false);

  const openDisputes = disputes.filter((d) => d.status === "open");

  const handleStartSession = (dispute: BaoCourtDispute) => {
    setSelectedDispute(dispute);
    setSessionOpen(true);
  };

  const handleDemoSessionReady = useCallback(
    (
      dispute: BaoCourtDispute,
      selectedJurors: SelectedJuror[],
      seed: string,
      myJurorIdx: number,
    ) => {
      setDemoSession({ dispute, selectedJurors, seed, myJurorIdx });
      setSessionOpen(true);
    },
    [],
  );

  const activeSession = demoSession ?? (selectedDispute ? { dispute: selectedDispute, selectedJurors: [], seed: '', myJurorIdx: 1 } : null);

  return (
    <Tabs defaultValue={settings.demoMode ? "lobby" : "disputes"} className="w-full">
      <TabsList className="grid w-full grid-cols-3">
        {settings.demoMode ? (
          <TabsTrigger value="lobby" className="gap-2">
            <Beaker className="size-4" />
            <span className="hidden sm:inline">Demo Lobby</span>
            <span className="sm:hidden">Lobby</span>
          </TabsTrigger>
        ) : (
          <TabsTrigger value="disputes" className="gap-2">
            <Gavel className="size-4" />
            <span className="hidden sm:inline">Open Disputes</span>
            <span className="sm:hidden">Disputes</span>
          </TabsTrigger>
        )}
        <TabsTrigger value="sessions" className="gap-2">
          <List className="size-4" />
          <span className="hidden sm:inline">My Sessions</span>
          <span className="sm:hidden">Sessions</span>
        </TabsTrigger>
        <TabsTrigger value="settings" className="gap-2">
          <Settings className="size-4" />
          <span>Settings</span>
        </TabsTrigger>
      </TabsList>

      {settings.demoMode ? (
        <TabsContent value="lobby" className="mt-4 space-y-4">
          <DemoCourtLobby
            settings={settings}
            onSessionReady={handleDemoSessionReady}
          />
        </TabsContent>
      ) : (
        <TabsContent value="disputes" className="mt-4 space-y-4">
          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Card key={i}>
                  <CardContent className="p-4 space-y-3">
                    <Skeleton className="h-5 w-3/4" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-9 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : openDisputes.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-12 px-8 text-center">
                <p className="text-muted-foreground max-w-sm mx-auto">
                  No open disputes found. Check back later or register as a juror to be ready when a
                  dispute is filed.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {openDisputes.map((dispute) => (
                <DisputeCard
                  key={dispute.disputeId}
                  dispute={dispute}
                  onSelect={handleStartSession}
                />
              ))}
            </div>
          )}
        </TabsContent>
      )}

      <TabsContent value="sessions" className="mt-4 space-y-4">
        {activeSession ? (
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{activeSession.dispute.proposedOutcome}</p>
                  <p className="text-sm text-muted-foreground">
                    {truncatePubkey(activeSession.dispute.challengerPubkey)}
                  </p>
                </div>
                <Badge>Active</Badge>
              </div>
              <Button onClick={() => setSessionOpen(true)}>Continue session</Button>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-dashed">
            <CardContent className="py-12 px-8 text-center">
              <p className="text-muted-foreground max-w-sm mx-auto">
                You have no active juror sessions. {settings.demoMode
                  ? 'Join a demo room from the Demo Lobby tab to begin.'
                  : 'Select a dispute from the Open Disputes tab to begin.'}
              </p>
            </CardContent>
          </Card>
        )}
      </TabsContent>

      <TabsContent value="settings" className="mt-4 space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <JurorSettings value={settings} onChange={onSettingsChange} />
          <JurorRegistrationCard
            disputeId={activeSession?.dispute.disputeId ?? "demo-dispute"}
            marketId={activeSession?.dispute.marketId ?? "demo-market"}
          />
        </div>
      </TabsContent>

      {activeSession && (
        <JurorSessionModal
          key={activeSession.dispute.disputeId}
          dispute={activeSession.dispute}
          selectedJurors={activeSession.selectedJurors}
          myJurorIdx={activeSession.myJurorIdx}
          demoMode={settings.demoMode}
          demoPace={settings.demoPace}
          seed={activeSession.seed}
          open={sessionOpen}
          onOpenChange={setSessionOpen}
        />
      )}
    </Tabs>
  );
}
