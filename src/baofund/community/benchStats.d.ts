/**
 * benchStats — pure aggregation for scripts/bench.mjs (plan P5).
 *
 * Deterministic by construction: same latency set → same report. The
 * philosophy borrowed from SAM's bench: reproducible workloads are
 * instruments; a difference between two runs is a difference in the mesh.
 */
export interface BenchReport {
    clients: number;
    messagesPerClient: number;
    totalMessages: number;
    receiptRate: number;
    p50Ms: number;
    p95Ms: number;
    maxMs: number;
}
/** Nearest-rank percentile (no interpolation). Sorts defensively — input
 *  order must never change the answer. */
export declare function percentile(sample: number[], p: number): number;
export declare function aggregate(clients: number, perClient: number, latenciesMs: number[], receiptsOk: number): BenchReport;
export interface Thresholds {
    maxP95Ms?: number;
    minReceiptRate?: number;
}
export declare function violatesThresholds(r: BenchReport, t: Thresholds): string[];
