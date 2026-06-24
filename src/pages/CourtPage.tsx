import { useState } from "react";
import { Gavel, Info } from "lucide-react";
import { useSeoMeta } from "@unhead/react";

import { PageHeader } from "@/components/PageHeader";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAppContext } from "@/hooks/useAppContext";
import { JurorDashboard } from "@/components/bao-court/JurorDashboard";
import type { JurorSettingsState } from "@/components/bao-court/JurorSettings";

const STORAGE_KEY = "bao-court-settings";

function loadSettings(): JurorSettingsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { categories: ["world"], bondAmountSats: 10_000, demoMode: true, demoPace: "guided" };
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "categories" in parsed &&
      Array.isArray(parsed.categories) &&
      "bondAmountSats" in parsed &&
      typeof parsed.bondAmountSats === "number" &&
      "demoMode" in parsed &&
      typeof parsed.demoMode === "boolean" &&
      "demoPace" in parsed &&
      (parsed.demoPace === "guided" || parsed.demoPace === "fast")
    ) {
      return parsed as JurorSettingsState;
    }
  } catch {
    // Fall through to defaults.
  }
  return { categories: ["world"], bondAmountSats: 10_000, demoMode: true, demoPace: "guided" };
}

export function CourtPage(): React.JSX.Element {
  const { config } = useAppContext();
  const [settings, setSettings] = useState<JurorSettingsState>(loadSettings);

  useSeoMeta({
    title: `BAO Court | ${config.appName}`,
    description: "Decentralized dispute jury for BAO prediction markets",
  });

  const handleSettingsChange = (next: JurorSettingsState) => {
    setSettings(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage errors.
    }
  };

  return (
    <main>
      <PageHeader title="BAO Court" icon={<Gavel className="size-5" />}>
        <span className="text-sm text-muted-foreground hidden sm:inline">
          Decentralized dispute jury
        </span>
      </PageHeader>

      <div className="px-4 py-4 max-w-6xl mx-auto space-y-4">
        <Alert>
          <Info className="size-4" />
          <AlertDescription>
            BAO Court lets users register as jurors for ₿AO prediction-market disputes, participate
            in a browser-based Pedersen DKG, vote, and FROST-sign dispute override attestations. Demo
            mode opens a named jury room: 3–5 users choose a category, lock 1 000 000 fake sats, and
            run a deterministic FROST ceremony together. Real appeals require multiple online
            participants.
          </AlertDescription>
        </Alert>

        <JurorDashboard settings={settings} onSettingsChange={handleSettingsChange} />
      </div>
    </main>
  );
}

export default CourtPage;
