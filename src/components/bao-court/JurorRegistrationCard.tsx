import { useState } from "react";
import { Shield, Loader2, Zap } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  "world",
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
  const [selectedCategories, setSelectedCategories] = useState<string[]>(["world"]);
  const [bondAmount, setBondAmount] = useState<string>(String(defaultBondAmountSats));
  const [bondAddress, setBondAddress] = useState<string>(realMode ? "" : "spark:demo");
  const [bondTxid, setBondTxid] = useState<string>("");
  const [bondVout, setBondVout] = useState<string>("");
  const [rail] = useState<string>(requiredRail);

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
        title: "Registered as juror",
        description: "Your candidacy event has been published.",
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
          <CardTitle className="text-base">Register as juror</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Categories you can judge</Label>
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
        </div>

        <div className="space-y-2">
          <Label htmlFor="bond-amount">{realMode ? "Bond amount (sats)" : "Mock bond amount (sats)"}</Label>
          <Input
            id="bond-amount"
            type="number"
            min={1000}
            value={bondAmount}
            onChange={(e) => setBondAmount(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {realMode
              ? "The on-chain UTXO must pay at least this amount to the bond address."
              : "Demo mode: this is a mock stake commitment for UI testing."}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="bond-address">{realMode ? "Bond address" : "Mock bond address"}</Label>
          <Input
            id="bond-address"
            value={bondAddress}
            onChange={(e) => setBondAddress(e.target.value)}
            placeholder={realMode ? "tb1q…" : "spark:demo"}
          />
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

        <Button onClick={handleRegister} disabled={isPending} className="w-full">
          {isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
          Register candidacy
        </Button>
      </CardContent>
    </Card>
  );
}
