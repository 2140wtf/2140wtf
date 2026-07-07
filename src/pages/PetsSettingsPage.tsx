import { useMemo, useState } from 'react';
import { useSeoMeta } from '@unhead/react';
import { Link } from 'react-router-dom';
import { Egg, Baby, Cat, Sparkles } from 'lucide-react';

import { PageHeader } from '@/components/PageHeader';
import { IntroImage } from '@/components/IntroImage';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppContext } from '@/hooks/useAppContext';
import { useEncryptedSettings } from '@/hooks/useEncryptedSettings';
import { usePetssCollection } from '@/pets/core/hooks/usePetssCollection';
import { PetsStageVisual, type PetsReaction } from '@/pets/ui/PetsStageVisual';
import { adjustSeedForAdultType } from '@/pets/core/lib/pets';
import { ADULT_FORMS, type AdultForm } from '@/pets/adult-pets/types/adult.types';
import type { PetsCompanion, PetsStage } from '@/pets/core/lib/pets';
import { PetsSpeciesCreator } from '@/pets/creator/components/PetsSpeciesCreator';

const STAGES: { id: PetsStage; label: string; icon: typeof Egg }[] = [
  { id: 'egg', label: 'Egg', icon: Egg },
  { id: 'baby', label: 'Baby', icon: Baby },
  { id: 'adult', label: 'Adult', icon: Cat },
];

const REACTIONS: PetsReaction[] = ['idle', 'listening', 'swaying', 'singing', 'happy'];

export function PetsSettingsPage() {
  const { user } = useCurrentUser();
  const { config } = useAppContext();
  const { settings, updateSettings } = useEncryptedSettings();
  const { companions, isLoading } = usePetssCollection();

  useSeoMeta({
    title: `Pets | Settings | ${config.appName}`,
    description: 'Preview and test every NOSTR PET form',
  });

  const baseCompanion = companions[0];

  const [stage, setStage] = useState<PetsStage>('adult');
  const [adultForm, setAdultForm] = useState<AdultForm>(ADULT_FORMS[0]);
  const [reaction, setReaction] = useState<PetsReaction>('idle');
  const [animated, setAnimated] = useState(true);

  const previewCompanion: PetsCompanion | null = useMemo(() => {
    if (!baseCompanion) return null;

    const baseSeed = baseCompanion.seed ?? '';
    const seed =
      stage === 'adult'
        ? adjustSeedForAdultType(baseSeed, adultForm)
        : baseSeed;

    return {
      ...baseCompanion,
      stage,
      seed,
      adultType: stage === 'adult' ? adultForm : baseCompanion.adultType,
      state: 'active' as const,
      progressionState: 'none' as const,
    };
  }, [baseCompanion, stage, adultForm]);

  return (
    <main>
      <PageHeader
        backTo="/settings"
        alwaysShowBack
        titleContent={
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold">NOSTR PETS Preview</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Swap stage and adult form locally to test how every pet looks and behaves.
            </p>
          </div>
        }
      />

      <div className="p-4">
        <div className="flex items-center gap-4 px-3 pt-2 pb-6">
          <IntroImage src="/community-intro.png" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">Testing Sandbox</h2>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Previews are rendered locally and are not published. Choose a stage,
              pick an adult form, and try different reactions.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 px-2 pb-5">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/40 to-primary/60" />
          <Sparkles className="size-3 text-primary/50" />
          <div className="h-px flex-1 bg-gradient-to-l from-transparent via-primary/40 to-primary/60" />
        </div>

        {!user && (
          <div className="rounded-xl border border-dashed p-6 text-center">
            <p className="text-sm text-muted-foreground">
              Log in to load your companions for preview.
            </p>
          </div>
        )}

        {user && isLoading && (
          <div className="rounded-xl border border-dashed p-6 text-center">
            <p className="text-sm text-muted-foreground">Loading your pets…</p>
          </div>
        )}

        {user && !isLoading && companions.length === 0 && (
          <div className="rounded-xl border border-dashed p-6 text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              You don&apos;t have a pet yet. Adopt one first to use the preview sandbox.
            </p>
            <Button asChild>
              <Link to="/pets">Adopt a NOSTR PET</Link>
            </Button>
          </div>
        )}

        {previewCompanion && (
          <div className="space-y-6">
            {/* Preview */}
            <div className="flex flex-col items-center gap-4 rounded-xl border bg-card/30 p-6">
              <div className="size-48 rounded-2xl bg-muted/40 flex items-center justify-center">
                <PetsStageVisual
                  companion={previewCompanion}
                  size="lg"
                  animated={animated}
                  reaction={reaction}
                />
              </div>
              <div className="text-center space-y-1">
                <p className="text-sm font-medium">
                  {previewCompanion.name}
                  <span className="text-muted-foreground ml-2">
                    {stage === 'adult' ? adultForm : stage}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Reaction: {reaction}
                </p>
              </div>
            </div>

            {/* Controls */}
            <div className="space-y-4 rounded-xl border p-4">
              {/* Stage selector */}
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Stage
                </Label>
                <div className="flex gap-2">
                  {STAGES.map(({ id, label, icon: Icon }) => (
                    <Button
                      key={id}
                      type="button"
                      variant={stage === id ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setStage(id)}
                      className="flex-1 gap-1.5"
                    >
                      <Icon className="size-4" />
                      {label}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Adult form selector */}
              {stage === 'adult' && (
                <div className="space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Adult form
                  </Label>
                  <Select value={adultForm} onValueChange={(v) => setAdultForm(v as AdultForm)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ADULT_FORMS.map((form) => (
                        <SelectItem key={form} value={form}>
                          {form}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Reaction selector */}
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Reaction
                </Label>
                <Select value={reaction} onValueChange={(v) => setReaction(v as PetsReaction)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REACTIONS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Animated toggle */}
              <div className="flex items-center justify-between">
                <Label
                  htmlFor="pets-preview-animated"
                  className="text-xs font-semibold uppercase tracking-wider text-muted-foreground cursor-pointer"
                >
                  Animated
                </Label>
                <Switch
                  id="pets-preview-animated"
                  checked={animated}
                  onCheckedChange={setAnimated}
                />
              </div>

              {/* 3D rendering toggle */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label
                    htmlFor="pets-3d-enabled"
                    className="text-xs font-semibold uppercase tracking-wider text-muted-foreground cursor-pointer"
                  >
                    Enable 3D pets
                  </Label>
                  <p className="text-[10px] text-muted-foreground">
                    Render adult pets as Blossom-hosted GLB models. Falls back to SVG when off or unavailable.
                  </p>
                </div>
                <Switch
                  id="pets-3d-enabled"
                  checked={settings?.pets3dEnabled ?? false}
                  onCheckedChange={(checked) =>
                    updateSettings.mutate({ pets3dEnabled: checked })
                  }
                />
              </div>
            </div>

            <PetsSpeciesCreator baseCompanion={previewCompanion ?? baseCompanion} />
          </div>
        )}
      </div>
    </main>
  );
}
