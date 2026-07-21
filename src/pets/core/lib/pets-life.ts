/**
 * Pet life calculation in Bitcoin-block time.
 *
 * A pet's life is measured in 10-minute "blocks". Every 2016 blocks (one
 * Bitcoin difficulty epoch) the block counter resets and the epoch counter
 * increments. Display format:
 *
 *   1 epoch 1 block  →  1 epoch 2016 blocks  →  2 epochs 1 block  → ...
 *
 * The birth timestamp is currently taken from the pet event's `created_at`.
 * If a dedicated `birth_at` tag is added later, this helper can prefer that
 * value without changing callers.
 */

import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { fetchBlockHeight } from '@/lib/bitcoin';
import { DEFAULT_ESPLORA_APIS } from '@/lib/esplora';

/** Tag key for the on-chain birth block height stored on pet state events. */
export const BIRTH_BLOCK_TAG = 'birth_block';

/** Average Bitcoin block time in seconds. */
export const PET_BLOCK_TIME_SECONDS = 600;

/** Blocks per Bitcoin difficulty epoch. */
export const PET_EPOCH_BLOCKS = 2016;

/** Block interval at which to celebrate a pet birthday. */
export const BIRTHDAY_MILESTONE_BLOCKS = 100_000;

export interface PetLife {
  /** Total blocks lived since birth (starts at 1). */
  totalBlocks: number;
  /** Completed/full epochs plus the current one (starts at 1). */
  epochs: number;
  /** Block index within the current epoch (1..2016). */
  blocksInEpoch: number;
  /** Human-readable label, e.g. "1 epoch 42 blocks". */
  label: string;
  /** Compact Bitcoin-block label, e.g. "1b" or "2e+1b". */
  shortLabel: string;
  /** Human-readable chronological age, e.g. "12m" or "3h 4m". */
  ageLabel: string;
  /** Whether the pet has hit a 100,000-block birthday milestone right now. */
  isBirthdayMilestone: boolean;
  /** The milestone block count, e.g. 100000, 200000, or undefined. */
  milestoneBlocks: number | undefined;
}

/**
 * Compute a pet's life in blocks and epochs from its birth timestamp.
 *
 * @param birthTimestampSeconds - Unix timestamp (seconds) when the pet was born.
 * @param nowSeconds - Current Unix timestamp (seconds).
 * @returns PetLife breakdown, or undefined if birth timestamp is missing/invalid.
 */
export function getPetLife(
  birthTimestampSeconds: number | undefined,
  nowSeconds: number,
): PetLife | undefined {
  if (birthTimestampSeconds === undefined || Number.isNaN(birthTimestampSeconds)) {
    return undefined;
  }

  const elapsedSeconds = Math.max(0, nowSeconds - birthTimestampSeconds);
  // First block starts immediately at birth (block 1), then ticks every 10 min.
  const totalBlocks = Math.floor(elapsedSeconds / PET_BLOCK_TIME_SECONDS) + 1;

  const epochs = Math.floor((totalBlocks - 1) / PET_EPOCH_BLOCKS) + 1;
  const blocksInEpoch = ((totalBlocks - 1) % PET_EPOCH_BLOCKS) + 1;

  const epochLabel = epochs === 1 ? '1 epoch' : `${epochs} epochs`;
  const blockLabel = blocksInEpoch === 1 ? '1 block' : `${blocksInEpoch} blocks`;
  const shortLabel = epochs === 1 ? `${blocksInEpoch}b` : `${epochs}e+${blocksInEpoch}b`;
  const ageLabel = formatAgeLabel(elapsedSeconds);
  const milestoneBlocks =
    totalBlocks > 0 && totalBlocks % BIRTHDAY_MILESTONE_BLOCKS === 0
      ? totalBlocks
      : undefined;

  return {
    totalBlocks,
    epochs,
    blocksInEpoch,
    label: `${epochLabel} ${blockLabel}`,
    shortLabel,
    ageLabel,
    isBirthdayMilestone: milestoneBlocks !== undefined,
    milestoneBlocks,
  };
}

/**
 * React hook that returns a live-updating pet life breakdown.
 *
 * Recomputes every minute so the block counter ticks without needing a full
 * component re-render from other state changes.
 */
export function usePetLife(birthTimestampSeconds: number | undefined): PetLife | undefined {
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    setNowSeconds(Math.floor(Date.now() / 1000));
    const interval = setInterval(() => {
      setNowSeconds(Math.floor(Date.now() / 1000));
    }, 60_000);

    return () => clearInterval(interval);
  }, []);

  return useMemo(
    () => getPetLife(birthTimestampSeconds, nowSeconds),
    [birthTimestampSeconds, nowSeconds],
  );
}

/**
 * Fetch the current Bitcoin block height from Esplora APIs.
 *
 * Uses the provided URLs, or falls back to the public defaults. The result is
 * cached and refetched every 60 minutes to keep Esplora API usage low.
 */
/**
 * Format a chronological age from elapsed seconds into a compact label.
 *
 * Examples: "new" (<1 min), "12m", "1h 5m", "2d", "3w", "1y".
 */
function formatAgeLabel(elapsedSeconds: number): string {
  if (elapsedSeconds < 60) return 'new';
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(elapsedSeconds / 3600);
  const remMinutes = Math.floor((elapsedSeconds % 3600) / 60);
  if (hours < 24) return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`;

  const days = Math.floor(elapsedSeconds / 86400);
  if (days < 7) return `${days}d`;

  const weeks = Math.floor(elapsedSeconds / 604800);
  if (weeks < 52) return `${weeks}w`;

  const years = Math.floor(elapsedSeconds / 31_536_000);
  return `${years}y`;
}

export function useCurrentBlockHeight(baseUrls?: string[]): number | undefined {
  const urls = baseUrls?.length ? baseUrls : [...DEFAULT_ESPLORA_APIS];
  const { data } = useQuery({
    queryKey: ['bitcoin', 'block-height', urls],
    queryFn: async ({ signal }) => fetchBlockHeight(urls, signal),
    staleTime: 60 * 60 * 1000,
    refetchInterval: 60 * 60 * 1000,
    retry: 1,
  });

  return data;
}

/**
 * Read a stored birth block height from pet event tags.
 *
 * @param tags - Event tags to inspect.
 * @returns The stored block height, or undefined if missing/invalid.
 */
export function getStoredBirthBlockHeight(tags: string[][] | undefined): number | undefined {
  if (!tags) return undefined;
  const tag = tags.find((t) => t[0] === BIRTH_BLOCK_TAG);
  if (!tag) return undefined;
  const val = Number(tag[1]);
  return Number.isFinite(val) && val >= 0 ? val : undefined;
}

/**
 * Build a birth_block tag for a pet state event.
 *
 * @param blockHeight - The current Bitcoin block height at egg creation.
 */
export function makeBirthBlockTag(blockHeight: number): string[] {
  return [BIRTH_BLOCK_TAG, blockHeight.toString()];
}

/**
 * Compute the approximate Bitcoin block height at which a pet was born.
 *
 * This assumes a constant 10-minute block time between the pet's birth and the
 * current tip. In reality block times vary, so this is an estimate.
 *
 * @param birthTimestampSeconds - Unix timestamp (seconds) when the pet was born.
 * @param currentBlockHeight - Current Bitcoin block height.
 * @returns Estimated birth block height, or undefined if inputs are missing.
 */
export function getBirthBlockHeight(
  birthTimestampSeconds: number | undefined,
  currentBlockHeight: number | undefined,
): number | undefined {
  if (birthTimestampSeconds === undefined || currentBlockHeight === undefined) {
    return undefined;
  }

  const life = getPetLife(birthTimestampSeconds, Math.floor(Date.now() / 1000));
  if (!life) return undefined;

  // Birth block = current tip minus blocks lived since birth.
  return Math.max(0, currentBlockHeight - (life.totalBlocks - 1));
}

/**
 * Whether a pet has lived long enough for at least one real Bitcoin block to
 * have been mined since its birth. Used to gate hatching/evolution so a pet
 * can't transition before ~10 minutes of block time have passed.
 *
 * @param birthTimestampSeconds - Unix timestamp (seconds) when the pet was born.
 * @param currentBlockHeight - Current Bitcoin block height from Esplora.
 * @returns True when the current chain tip is strictly greater than the
 *          estimated birth block height.
 */
export function isPetOldEnough(
  birthTimestampSeconds: number | undefined,
  currentBlockHeight: number | undefined,
  storedBirthBlockHeight?: number,
): boolean {
  if (currentBlockHeight === undefined) return false;
  let birthBlockHeight: number | undefined;
  if (storedBirthBlockHeight !== undefined) {
    birthBlockHeight = storedBirthBlockHeight;
  } else {
    birthBlockHeight = getBirthBlockHeight(birthTimestampSeconds, currentBlockHeight);
  }
  if (birthBlockHeight === undefined) return false;
  return currentBlockHeight > birthBlockHeight;
}

