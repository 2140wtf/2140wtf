import type { NostrEvent } from '@nostrify/nostrify';

import {
  KIND_PETS_INTERACTION,
  parseInteractionEvent,
  type PetsInteraction,
} from '@/pets/core/lib/pets-interaction';

export type BattleMode = 'demo-sats' | 'btc-sats' | 'real-sats';

export interface PetsBattleInteraction extends PetsInteraction {
  action: 'battle';
  fighterCoordinates: [string, string];
  fighterDTags: [string, string];
  winnerDTag: string | 'draw';
  mode: BattleMode;
  prizeAmount: number;
  durationSeconds: number;
  p1Health: number;
  p2Health: number;
}

export interface BattleInteractionParams {
  /** Pubkey of the Pets owner (both fighters must belong to this owner in local mode). */
  ownerPubkey: string;
  /** Canonical d-tags of the two fighters. */
  fighterDTags: [string, string];
  /** D-tag of the winning pet, or "draw" if the match ended in a draw. */
  winnerDTag: string | 'draw';
  /** Demo BAO credits or real Cashu sats. */
  mode: BattleMode;
  /** Number of credits awarded to the winner. */
  prizeAmount: number;
  /** Round duration in seconds. */
  durationSeconds: number;
  /** Final health of fighter 1. */
  p1Health: number;
  /** Final health of fighter 2. */
  p2Health: number;
}

/**
 * Build a kind 1124 event template that logs a completed pet battle.
 *
 * This extends the standard Pets Social Interaction schema with battle-specific
 * tags so clients can query and render fight history.
 */
export function buildBattleInteractionEventTemplate(
  params: BattleInteractionParams,
): {
  kind: number;
  content: string;
  tags: string[][];
} {
  const tags: string[][] = [
    ['a', `31124:${params.ownerPubkey}:${params.fighterDTags[0]}`],
    ['a', `31124:${params.ownerPubkey}:${params.fighterDTags[1]}`],
    ['p', params.ownerPubkey],
    ['action', 'battle'],
    ['source', 'battle-arena'],
    ['winner', params.winnerDTag],
    ['mode', params.mode],
    ['prize', params.prizeAmount.toString()],
    ['duration', params.durationSeconds.toString()],
    ['p1_health', params.p1Health.toString()],
    ['p2_health', params.p2Health.toString()],
    [
      'alt',
      params.winnerDTag === 'draw'
        ? 'Pet battle ended in a draw'
        : `Pet battle won by ${params.winnerDTag}`,
    ],
  ];

  return {
    kind: KIND_PETS_INTERACTION,
    content: '',
    tags,
  };
}

function parseCoordinateDTag(coordinate: string | undefined): string | undefined {
  if (!coordinate) return undefined;
  const parts = coordinate.split(':');
  return parts[2];
}

/**
 * Parse a kind 1124 event into a typed battle interaction.
 *
 * Returns undefined if the event is not a well-formed battle log.
 */
export function parseBattleInteractionEvent(
  event: NostrEvent,
): PetsBattleInteraction | undefined {
  const base = parseInteractionEvent(event);
  if (!base || base.action !== 'battle') return undefined;

  const aTags = event.tags
    .filter(([name]) => name === 'a')
    .map((tag) => tag[1]);
  if (aTags.length < 2) return undefined;

  const winnerTag = event.tags.find(([name]) => name === 'winner')?.[1];
  if (!winnerTag) return undefined;

  const rawModeTag = event.tags.find(([name]) => name === 'mode')?.[1];
  const modeTag: BattleMode | undefined =
    rawModeTag === 'demo-sats' || rawModeTag === 'btc-sats'
      ? rawModeTag
      : rawModeTag === 'demo'
        ? 'demo-sats'
        : rawModeTag === 'real' || rawModeTag === 'bao'
          ? 'btc-sats'
          : undefined;
  if (!modeTag) return undefined;

  const prize = Number(event.tags.find(([name]) => name === 'prize')?.[1]);
  const duration = Number(event.tags.find(([name]) => name === 'duration')?.[1]);
  const p1Health = Number(event.tags.find(([name]) => name === 'p1_health')?.[1]);
  const p2Health = Number(event.tags.find(([name]) => name === 'p2_health')?.[1]);

  if (
    !Number.isFinite(prize) ||
    !Number.isFinite(duration) ||
    !Number.isFinite(p1Health) ||
    !Number.isFinite(p2Health)
  ) {
    return undefined;
  }

  const dTags = aTags
    .map(parseCoordinateDTag)
    .filter((d): d is string => typeof d === 'string' && d.length > 0);
  if (dTags.length < 2) return undefined;

  return {
    ...base,
    action: 'battle',
    fighterCoordinates: [aTags[0]!, aTags[1]!] as [string, string],
    fighterDTags: [dTags[0]!, dTags[1]!] as [string, string],
    winnerDTag: winnerTag,
    mode: modeTag,
    prizeAmount: prize,
    durationSeconds: duration,
    p1Health,
    p2Health,
  };
}

/**
 * Fire-and-forget helper to publish a kind 1124 battle log event.
 *
 * Publication failures are logged but do not block the caller.
 */
export function emitBattleInteractionEvent(
  publishEvent: (template: {
    kind: number;
    content: string;
    tags: string[][];
  }) => Promise<unknown>,
  params: BattleInteractionParams,
): void {
  const template = buildBattleInteractionEventTemplate(params);
  publishEvent(template).catch((err: unknown) => {
    console.warn('[Pets Battle] Failed to publish battle interaction event:', err);
  });
}
