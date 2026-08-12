import { useState } from "react";
import { Shield, Loader2, Zap, ChevronDown, ChevronUp } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/useToast";
import { useJurorRegistration } from "@/hooks/useJurorRegistration";

interface JurorRegistrationCardProps {
  disputeId: string;
  marketId: string;
  defaultBondAmountSats?: number;
  requiredRail?: string;
  realMode?: boolean;
  onRegistered?: () => void;
}

const DEFAULT_CATEGORIES = [
  "sports",
  "politics",
  "crypto",
  "science",
  "entertainment",
];

export function JurorRegistrationCard({
  disputeId,
  marketId,
  defaultBondAmountSats = 10_000,
  requiredRail = "spark",
  realMode = false,
  onRegistered,
}: JurorRegistrationCardProps) {
  const { toast } = useToast();
  const { mutateAsync: register, isPending } = useJurorRegistration();
  const [selectedCategories, setSelectedCategories] = useState<string[]>(["sports"]);
  const [bondAmount, setBondAmount] = useState<string>(String(defaultBondAmountSats));
  const [bondAddress, setBondAddress] = useState<string>(realMode ? "" : "spark:demo");
  const [bondTxid, setBondTxid] = useState<string>("");
  const [bondVout, setBondVout] = useState<string>("");
  const [rail] = useState<string>(requiredRail);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const toggleCategory = (category: string) => {
    setSelectedCategories((prev) =>
      prev.includes(category)
        ? prev.filter((c) => c !== category)
        : [...prev, category],
    );
  };

  const handleRegister = async () => {
    try {
      await register({
        disputeId,
        marketId,
        categories: selectedCategories,
        bondAmountSats: Number.parseInt(bondAmount, 10) || 10_000,
        bondAddress: bondAddress.trim() || (realMode ? "" : "spark:demo"),
        bondTxid: bondTxid.trim() || undefined,
        bondVout: bondVout.trim() ? Number.parseInt(bondVout, 10) : undefined,
        rail,
      });
      toast({
        title: "You're on the jury roll",
        description: "Your juror registration has been published.",
      });
      onRegistered?.();
    } catch (error) {
      toast({
        title: "Registration failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Shield className="size-5 text-primary" />
          <CardTitle className="text-base">Become a juror</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Review evidence in disputes and vote on the outcome. It costs nothing but a small
          refundable deposit — everything below is pre-filled, so you can just hit the button.
        </p>

        <div className="space-y-2">
          <Label>Topics you can judge</Label>
          <div className="flex flex-wrap gap-2">
            {DEFAULT_CATEGORIES.map((category) => (
              <Badge
                key={category}
                variant={selectedCategories.includes(category) ? "default" : "outline"}
                className="cursor-pointer capitalize"
                onClick={() => toggleCategory(category)}
              >
                {category}
              </Badge>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            You'll only be called for disputes in the topics you pick.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="bond-amount">Refundable security deposit (sats)</Label>
          <Input
            id="bond-amount"
            type="number"
            min={1000}
            value={bondAmount}
            onChange={(e) => setBondAmount(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            You get this back when the case closes — it's only forfeited if you're proven to cheat.
            {!realMode && " Practice mode uses fake sats, so there's no real money involved."}
          </p>
        </div>

        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between px-3 h-auto py-2">
              <span className="text-sm font-medium">Advanced</span>
              {advancedOpen ? (
                <ChevronUp className="size-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="size-4 text-muted-foreground" />
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="bond-address">{realMode ? "Bond address" : "Mock bond address"}</Label>
              <Input
                id="bond-address"
                value={bondAddress}
                onChange={(e) => setBondAddress(e.target.value)}
                placeholder={realMode ? "tb1q…" : "spark:demo"}
              />
              <p className="text-xs text-muted-foreground">
                {realMode
                  ? "The on-chain UTXO must pay at least the deposit amount to this bond address."
                  : "Demo mode: this is a mock stake commitment for UI testing."}
              </p>
            </div>

            {realMode && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="bond-txid">Bond UTXO txid</Label>
                  <Input
                    id="bond-txid"
                    value={bondTxid}
                    onChange={(e) => setBondTxid(e.target.value)}
                    placeholder="0000…"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bond-vout">Bond UTXO vout</Label>
                  <Input
                    id="bond-vout"
                    type="number"
                    min={0}
                    value={bondVout}
                    onChange={(e) => setBondVout(e.target.value)}
                  />
                </div>
              </>
            )}

            <div className="space-y-2">
              <Label htmlFor="juror-rail">Stake rail</Label>
              <div className="flex items-center gap-2 rounded-md border px-3 py-2">
                <Zap className="size-4 text-amber-500" />
                <span className="text-sm font-medium capitalize">{rail}</span>
                <span className="text-xs text-muted-foreground">(required)</span>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        <Button onClick={handleRegister} disabled={isPending} className="w-full">
          {isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
          Serve on a jury
        </Button>
      </CardContent>
    </Card>
  );
}
