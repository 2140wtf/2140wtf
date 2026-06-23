import { useState } from "react";
import { Gavel, List, Settings } from "lucide-react";

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
import type { SelectedJuror } from "@/lib/bao-court";

interface JurorDashboardProps {
  readonly settings: JurorSettingsState;
  readonly onSettingsChange: (settings: JurorSettingsState) => void;
}

function truncatePubkey(pubkey: string): string {
  if (pubkey.length <= 12) return pubkey;
  return `${pubkey.slice(0, 6)}…${pubkey.slice(-6)}`;
}

export function JurorDashboard({ settings, onSettingsChange }: JurorDashboardProps) {
  const { data: disputes = [], isLoading } = useBaoCourtDisputes();
  const [selectedDispute, setSelectedDispute] = useState<BaoCourtDispute | null>(null);
  const [sessionOpen, setSessionOpen] = useState(false);

  const openDisputes = disputes.filter((d) => d.status === "open");

  // For demo purposes, treat the current user as selected if they have opened a session.
  const myJurorIdx = 1;
  const demoSelectedJurors: SelectedJuror[] = selectedDispute
    ? [
        {
          idx: 1,
          nostrPubkey: "0000000000000000000000000000000000000000000000000000000000000001",
          stakeCapacitySats: settings.bondAmountSats,
          stakeCommitment: {
            amountSats: settings.bondAmountSats,
            bondAddress: "bc1q...",
            status: "confirmed",
            committedAt: Math.floor(Date.now() / 1000),
          },
          wotScore: 80,
          categories: settings.categories,
          registeredAt: Math.floor(Date.now() / 1000),
          priority: 0,
        },
        {
          idx: 2,
          nostrPubkey: "0000000000000000000000000000000000000000000000000000000000000002",
          stakeCapacitySats: settings.bondAmountSats,
          stakeCommitment: {
            amountSats: settings.bondAmountSats,
            bondAddress: "bc1q...",
            status: "confirmed",
            committedAt: Math.floor(Date.now() / 1000),
          },
          wotScore: 80,
          categories: settings.categories,
          registeredAt: Math.floor(Date.now() / 1000),
          priority: 1,
        },
        {
          idx: 3,
          nostrPubkey: "0000000000000000000000000000000000000000000000000000000000000003",
          stakeCapacitySats: settings.bondAmountSats,
          stakeCommitment: {
            amountSats: settings.bondAmountSats,
            bondAddress: "bc1q...",
            status: "confirmed",
            committedAt: Math.floor(Date.now() / 1000),
          },
          wotScore: 80,
          categories: settings.categories,
          registeredAt: Math.floor(Date.now() / 1000),
          priority: 2,
        },
      ]
    : [];

  const handleStartSession = (dispute: BaoCourtDispute) => {
    setSelectedDispute(dispute);
    setSessionOpen(true);
  };

  return (
    <Tabs defaultValue="disputes" className="w-full">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="disputes" className="gap-2">
          <Gavel className="size-4" />
          <span className="hidden sm:inline">Open Disputes</span>
          <span className="sm:hidden">Disputes</span>
        </TabsTrigger>
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
              <DisputeCard key={dispute.disputeId} dispute={dispute} onSelect={handleStartSession} />
            ))}
          </div>
        )}
      </TabsContent>

      <TabsContent value="sessions" className="mt-4 space-y-4">
        {selectedDispute ? (
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{selectedDispute.proposedOutcome}</p>
                  <p className="text-sm text-muted-foreground">
                    {truncatePubkey(selectedDispute.challengerPubkey)}
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
                You have no active juror sessions. Select a dispute from the Open Disputes tab to
                begin.
              </p>
            </CardContent>
          </Card>
        )}
      </TabsContent>

      <TabsContent value="settings" className="mt-4 space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <JurorSettings value={settings} onChange={onSettingsChange} />
          <JurorRegistrationCard
            disputeId={selectedDispute?.disputeId ?? "demo-dispute"}
            marketId={selectedDispute?.marketId ?? "demo-market"}
          />
        </div>
      </TabsContent>

      {selectedDispute && (
        <JurorSessionModal
          key={selectedDispute.disputeId}
          dispute={selectedDispute}
          selectedJurors={demoSelectedJurors}
          myJurorIdx={myJurorIdx}
          demoMode={settings.demoMode}
          open={sessionOpen}
          onOpenChange={setSessionOpen}
        />
      )}
    </Tabs>
  );
}
