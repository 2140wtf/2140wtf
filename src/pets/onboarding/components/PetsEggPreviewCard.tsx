/**
 * PetsEggPreviewCard - Egg preview display during adoption flow
 *
 * Shows the preview egg with visual traits and action buttons for
 * rerolling (generating another) or adopting.
 *
 * Includes a name input so users can customize their Pets's name
 * before adoption. The name in the preview becomes the final name.
 */

import { Loader2, RefreshCw, Heart, Coins, Sparkles, Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PetsStageVisual } from '@/pets/ui/PetsStageVisual';
import { cn, formatCompactNumber } from '@/lib/utils';
import {
  PETS_PREVIEW_REROLL_SATS,
  PETS_ADOPTION_SATS,
} from '@/pets/core/lib/pets';

import type { PetsEggPreview } from '../lib/pets-preview';
import { previewToPetsCompanion } from '../lib/pets-preview';

interface PetsEggPreviewCardProps {
  /** The preview data to display */
  preview: PetsEggPreview;
  /** Current demo-sat balance */
  sats: number;
  /** Whether this is the first (free) preview */
  isFirstPreview: boolean;
  /** Whether an action is in progress */
  isProcessing: boolean;
  /** Which action is in progress */
  actionInProgress: 'reroll' | 'adopt' | null;
  /** Called when user wants to generate another preview */
  onReroll: () => void;
  /** Called when user wants to adopt this egg */
  onAdopt: () => void;
  /** Called when user changes the name */
  onNameChange: (name: string) => void;
}

export function PetsEggPreviewCard({
  preview,
  sats,
  isFirstPreview,
  isProcessing,
  actionInProgress,
  onReroll,
  onAdopt,
  onNameChange,
}: PetsEggPreviewCardProps) {
  // Convert preview to companion for visual rendering
  const companionForVisual = previewToPetsCompanion(preview);

  const rerollCostSats = PETS_PREVIEW_REROLL_SATS;
  const adoptionCostSats = PETS_ADOPTION_SATS;

  const canAffordReroll = sats >= rerollCostSats;
  const canAffordAdopt = sats >= adoptionCostSats;

  // Validate name - must not be empty after trim
  const trimmedName = preview.name.trim();
  const isValidName = trimmedName.length > 0;

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6">
      <div className="flex flex-col items-center gap-6 text-center max-w-md w-full">
        {/* Sats Display */}
        <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-amber-100 border border-amber-200 dark:bg-amber-900/40 dark:border-amber-800">
          <Coins className="size-4 text-amber-800 dark:text-amber-200 shrink-0" />
          <span className="font-semibold text-amber-950 dark:text-amber-100 whitespace-nowrap">
            {formatCompactNumber(sats)} demo sats
          </span>
        </div>

        {/* Title */}
        <div className="space-y-1">
          <h1 className="text-2xl sm:text-3xl font-bold">
            Meet Your 2140 PET!
          </h1>
          <p className="text-muted-foreground text-sm sm:text-base">
            {isFirstPreview
              ? "Here's your first egg preview - this one's free!"
              : "Here's another egg to consider adopting."
            }
          </p>
        </div>

        {/* Name Input */}
        <div className="w-full max-w-xs space-y-2">
          <Label htmlFor="pets-name" className="text-sm font-medium flex items-center gap-1">
            <Pencil className="size-3" />
            Name Your 2140 PET
          </Label>
          <Input
            id="pets-name"
            type="text"
            value={preview.name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Enter a name..."
            disabled={isProcessing}
            className="text-center font-medium"
            maxLength={32}
          />
          {!isValidName && (
            <p className="text-xs text-destructive">Please enter a name for your 2140 PET</p>
          )}
        </div>

        {/* Visible colored name display above egg */}
        {trimmedName && (
          <p
            className="text-xl font-semibold text-center"
            style={{ color: preview.visualTraits.baseColor }}
          >
            {trimmedName}
          </p>
        )}

        {/* Egg Preview Visual */}
        <div className="relative">
          {/* Glow effect */}
          <div className="absolute inset-0 -m-8 bg-primary/5 rounded-full blur-3xl" />

        {/* Main visual - key forces remount on preview change */}
            <div className={cn(
              "relative transition-all duration-300",
              isProcessing && "opacity-50"
            )}>
              <PetsStageVisual
                key={preview.d}
                companion={companionForVisual}
                size="lg"
                animated={!isProcessing}
                className="size-48 sm:size-56"
              />
            </div>

          {/* Processing overlay */}
          {isProcessing && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="size-8 animate-spin text-primary" />
            </div>
          )}
        </div>

        {/* Visual Traits Badges */}
        <div className="flex flex-wrap justify-center gap-2">
          <Badge variant="outline" className="capitalize">
            {preview.visualTraits.pattern}
          </Badge>
          {preview.visualTraits.specialMark !== 'none' && (
            <Badge variant="outline" className="capitalize">
              <Sparkles className="size-3 mr-1" />
              {preview.visualTraits.specialMark}
            </Badge>
          )}
          <Badge variant="outline" className="capitalize">
            {preview.visualTraits.size}
          </Badge>
        </div>

        {/* Action Buttons */}
        <div className="w-full space-y-3 mt-4">
          {/* Adopt Button */}
          <Button
            size="lg"
            onClick={onAdopt}
            disabled={!canAffordAdopt || isProcessing || !isValidName}
            className="w-full"
          >
            {actionInProgress === 'adopt' ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                Adopting...
              </>
            ) : (
              <>
                <Heart className="size-4 mr-2" />
                Adopt {trimmedName || 'This 2140 PET'} ({formatCompactNumber(adoptionCostSats)} demo sats)
              </>
            )}
          </Button>

          {/* Reroll Button */}
          <Button
            variant="outline"
            size="lg"
            onClick={onReroll}
            disabled={!canAffordReroll || isProcessing}
            className="w-full"
          >
            {actionInProgress === 'reroll' ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <RefreshCw className="size-4 mr-2" />
                Try Another ({formatCompactNumber(rerollCostSats)} demo sats)
              </>
            )}
          </Button>
        </div>

        {/* Insufficient Sats Warning */}
        {!canAffordAdopt && (
          <p className="text-sm text-destructive">
            You need {formatCompactNumber(adoptionCostSats - sats)} more demo sats to adopt.
          </p>
        )}
        {canAffordAdopt && !canAffordReroll && (
          <p className="text-sm text-muted-foreground">
            Not enough demo sats to try another preview.
          </p>
        )}

        {/* Cost Explanation */}
        <p className="text-xs text-muted-foreground mt-2">
          Adopting costs {formatCompactNumber(adoptionCostSats)} demo sats. Trying another costs {formatCompactNumber(rerollCostSats)} demo sats.
        </p>
      </div>
    </div>
  );
}
