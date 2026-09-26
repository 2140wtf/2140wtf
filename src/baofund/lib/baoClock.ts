/**
 * Quorum-time helper and deterministic test clock (spec §3, review R08).
 * Distinct IDs are required; IDs alone cannot prove operational independence.
 * Callers must configure independent authenticated sources. A correlated
 * majority can still bias this estimator: it is not a trusted time oracle.
 * Campaign-window semantics and mint-side enforcement remain separate work.
 */
export interface ClockSample {
  id: string;
  /** Nonnegative Unix seconds, fractional seconds permitted. */
  time: number;
}

export type QuorumTimeResult =
  | { ok: true; time: number; agreeing: string[] }
  | {
      ok: false;
      code: 'quorum_time_disagreement';
      retryable: true;
      /** Seconds before a caller should retry source collection. */
      retryAfter: number;
      detail: {
        reason: 'invalid_input' | 'duplicate_source' | 'insufficient_sources' | 'no_majority';
        clocks: Array<{ id: string; time: number | null }>;
        median: number | null;
        spread: number | null;
      };
    };

export const MIN_QUORUM_CLOCKS = 3;
const validTime = (time: unknown): time is number =>
  typeof time === 'number' && Number.isFinite(time) && time >= 0 && time <= Number.MAX_SAFE_INTEGER;

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : sorted[mid - 1] + (sorted[mid] - sorted[mid - 1]) / 2;
}

export function quorumTime(samples: ClockSample[], toleranceSecs: number): QuorumTimeResult {
  const input: unknown[] = Array.isArray(samples) ? Array.from(samples) : [];
  const clocks = input.map(sample => {
    const value = sample && typeof sample === 'object' ? sample as Partial<ClockSample> : {};
    return { id: typeof value.id === 'string' ? value.id : '', time: validTime(value.time) ? value.time : null };
  });
  const times = clocks.flatMap(clock => clock.time === null ? [] : [clock.time]).sort((a, b) => a - b);
  const fail = (reason: Extract<QuorumTimeResult, { ok: false }>['detail']['reason']): QuorumTimeResult => ({
    ok: false, code: 'quorum_time_disagreement', retryable: true, retryAfter: 1,
    detail: { reason, clocks, median: times.length ? median(times) : null, spread: times.length ? times[times.length - 1] - times[0] : null },
  });
  if (!Array.isArray(samples) || !validTime(toleranceSecs) || clocks.some(c => !c.id.trim() || c.id !== c.id.trim() || c.time === null)) return fail('invalid_input');
  if (new Set(clocks.map(c => c.id)).size !== clocks.length) return fail('duplicate_source');
  if (clocks.length < MIN_QUORUM_CLOCKS) return fail('insufficient_sources');
  const med = median(times);
  const agreeing = samples.filter(sample => Math.abs(sample.time - med) <= toleranceSecs);
  if (agreeing.length <= samples.length / 2) return fail('no_majority');
  return { ok: true, time: med, agreeing: agreeing.map(s => s.id).sort() };
}

/** Floor valid Unix seconds; reject values that could silently unlock early. */
export function floorToSecond(time: number): number {
  if (!validTime(time)) throw new TypeError('Unix seconds must be finite, nonnegative and safely representable');
  return Math.floor(time);
}

/** Client-side predicate only; it cannot authorize mint spends or refunds. */
export function isLocktimeReached(locktimeUnix: number, quorumTimeNow: number | undefined): boolean {
  if (!validTime(locktimeUnix) || !validTime(quorumTimeNow)) return false;
  return floorToSecond(quorumTimeNow) >= floorToSecond(locktimeUnix);
}

/** Explicitly controlled seconds clock for deterministic boundary tests.
 * No wall-clock reads or implicit timers. setSeconds allows simulated skew. */
export class VirtualClock {
  private time: number;
  constructor(initialSeconds = 0) {
    floorToSecond(initialSeconds);
    this.time = initialSeconds;
  }
  nowSeconds(): number { return this.time; }
  setSeconds(seconds: number): void {
    floorToSecond(seconds);
    this.time = seconds;
  }
  advanceSeconds(seconds: number): void {
    if (!validTime(seconds)) throw new TypeError('Clock advance must be finite and nonnegative');
    this.setSeconds(this.time + seconds);
  }
}
