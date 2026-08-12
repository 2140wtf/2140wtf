import { useState } from "react";
import { Settings2, Beaker, Scale, ChevronDown, ChevronUp } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export interface JurorSettingsState {
  readonly categories: string[];
  readonly bondAmountSats: number;
  readonly demoMode: boolean;
  readonly demoPace: 'guided' | 'fast';
  /** Required stake rail for juror bonds (Spark in the BAO Markets wallet). */
  readonly rail: string;
  /**
   * Run a real independent-juror ceremony using live Nostr messages and
   * on-chain bond verification. Default off until mainnet hardening is complete.
   */
  readonly realMode: boolean;
}

interface JurorSettingsProps {
  value: JurorSettingsState;
  onChange: (value: JurorSettingsState) => void;
}

const DEFAULT_CATEGORIES = [
  "sports",
  "politics",
  "crypto",
  "science",
  "entertainment",
];

export function JurorSettings({ value, onChange }: JurorSettingsProps) {
  const [draftBond, setDraftBond] = useState<string>(String(value.bondAmountSats));
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const toggleCategory = (category: string) => {
    const next = value.categories.includes(category)
      ? value.categories.filter((c) => c !== category)
      : [...value.categories, category];
    onChange({ ...value, categories: next });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Settings2 className="size-5 text-primary" />
          <CardTitle className="text-base">Your jury preferences</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label>Topics you can judge</Label>
          <div className="flex flex-wrap gap-2">
            {DEFAULT_CATEGORIES.map((category) => (
              <Badge
                key={category}
                variant={value.categories.includes(category) ? "default" : "outline"}
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
          <Label htmlFor="default-bond">Refundable security deposit (sats)</Label>
          <input
            id="default-bond"
            type="number"
            min={1000}
            value={draftBond}
            onChange={(e) => {
              setDraftBond(e.target.value);
              const num = Number.parseInt(e.target.value, 10);
              if (!Number.isNaN(num)) {
                onChange({ ...value, bondAmountSats: num });
              }
            }}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          />
          <p className="text-xs text-muted-foreground">
            You get this back when the case closes — it's only forfeited if you're proven to cheat.
          </p>
        </div>

        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <Beaker className="size-4 text-amber-500" />
              <Label htmlFor="demo-mode" className="text-base">
                Practice mode
              </Label>
            </div>
            <p className="text-sm text-muted-foreground">
              Try the full jury experience with fake sats and simulated jurors — a safe way to
              learn the ropes from a single account.
            </p>
          </div>
          <Switch
            id="demo-mode"
            checked={value.demoMode}
            onCheckedChange={(checked) => onChange({ ...value, demoMode: checked })}
          />
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
          <CollapsibleContent className="space-y-6 pt-2">
            <div className="space-y-2">
              <Label htmlFor="juror-rail">Juror stake rail</Label>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="capitalize">
                  {value.rail}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  Spark is the required rail for juror bonds.
                </span>
              </div>
            </div>

            {value.demoMode && (
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <Label htmlFor="demo-pace" className="text-base">
                    Practice pace
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Guided pauses at each step with explanations. Fast runs the whole session
                    automatically.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn('text-sm', value.demoPace === 'guided' && 'font-medium')}>
                    Guided
                  </span>
                  <Switch
                    id="demo-pace"
                    checked={value.demoPace === 'fast'}
                    onCheckedChange={(checked) =>
                      onChange({ ...value, demoPace: checked ? 'fast' : 'guided' })
                    }
                  />
                  <span className={cn('text-sm', value.demoPace === 'fast' && 'font-medium')}>
                    Fast
                  </span>
                </div>
              </div>
            )}

            {import.meta.env.DEV && (
              <div className={cn(
                "flex items-center justify-between rounded-lg border p-4",
                value.demoMode && "opacity-60"
              )}>
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <Scale className="size-4 text-blue-500" />
                    <Label htmlFor="real-mode" className="text-base">
                      Live peer ceremony (₿AO MARKETS custom signet, dev only)
                    </Label>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Run the real independent-juror protocol on the ₿AO MARKETS custom signet network: live DKG
                    shares over Nostr, ₿AO bond verification, and threshold signing. Requires an nsec
                    login and all jurors online. Hidden in production until mainnet infra is ready.
                  </p>
                </div>
                <Switch
                  id="real-mode"
                  checked={value.realMode && !value.demoMode}
                  disabled={value.demoMode}
                  onCheckedChange={(checked) => onChange({ ...value, realMode: checked })}
                />
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
