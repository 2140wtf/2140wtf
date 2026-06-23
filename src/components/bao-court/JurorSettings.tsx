import { useState } from "react";
import { Settings2, Beaker } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export interface JurorSettingsState {
  readonly categories: string[];
  readonly bondAmountSats: number;
  readonly demoMode: boolean;
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
  "world",
];

export function JurorSettings({ value, onChange }: JurorSettingsProps) {
  const [draftBond, setDraftBond] = useState<string>(String(value.bondAmountSats));

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
          <CardTitle className="text-base">Juror settings</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label>Default categories</Label>
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
        </div>

        <div className="space-y-2">
          <Label htmlFor="default-bond">Default bond amount (sats)</Label>
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
        </div>

        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <Beaker className="size-4 text-amber-500" />
              <Label htmlFor="demo-mode" className="text-base">
                Demo simulation mode
              </Label>
            </div>
            <p className="text-sm text-muted-foreground">
              Simulate the other jurors locally so the full GUI flow works with a single user.
            </p>
          </div>
          <Switch
            id="demo-mode"
            checked={value.demoMode}
            onCheckedChange={(checked) => onChange({ ...value, demoMode: checked })}
          />
        </div>
      </CardContent>
    </Card>
  );
}
