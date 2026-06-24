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

import { useEffect, useMemo, useState } from 'react';

/** Average Bitcoin block time in seconds. */
export const PET_BLOCK_TIME_SECONDS = 600;

/** Blocks per Bitcoin difficulty epoch. */
export const PET_EPOCH_BLOCKS = 2016;

export interface PetLife {
  /** Total blocks lived since birth (starts at 1). */
  totalBlocks: number;
  /** Completed/full epochs plus the current one (starts at 1). */
  epochs: number;
  /** Block index within the current epoch (1..2016). */
  blocksInEpoch: number;
  /** Human-readable label, e.g. "1 epoch 42 blocks". */
  label: string;
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

  return {
    totalBlocks,
    epochs,
    blocksInEpoch,
    label: `${epochLabel} ${blockLabel}`,
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
