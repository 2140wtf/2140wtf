/**
 * benchStats — pure aggregation for scripts/bench.mjs (plan P5).
 *
 * Deterministic by construction: same latency set → same report. The
 * philosophy borrowed from SAM's bench: reproducible workloads are
 * instruments; a difference between two runs is a difference in the mesh.
 */
/** Nearest-rank percentile (no interpolation). Sorts defensively — input
 *  order must never change the answer. */
export function percentile(sample, p) {
    if (sample.length === 0)
        throw new Error('percentile of empty sample');
    const sorted = [...sample].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[idx];
}
export function aggregate(clients, perClient, latenciesMs, receiptsOk) {
    const sorted = [...latenciesMs].sort((a, b) => a - b);
    const empty = sorted.length === 0;
    return {
        clients,
        messagesPerClient: perClient,
        totalMessages: latenciesMs.length,
        receiptRate: latenciesMs.length === 0 ? 0 : receiptsOk / latenciesMs.length,
        p50Ms: empty ? 0 : percentile(sorted, 50),
        p95Ms: empty ? 0 : percentile(sorted, 95),
        maxMs: sorted[sorted.length - 1] ?? 0,
    };
}
export function violatesThresholds(r, t) {
    const violations = [];
    if (t.maxP95Ms !== undefined && r.p95Ms > t.maxP95Ms) {
        violations.push(`p95 ${r.p95Ms}ms > ${t.maxP95Ms}ms`);
    }
    if (t.minReceiptRate !== undefined && r.receiptRate < t.minReceiptRate) {
        violations.push(`receiptRate ${r.receiptRate} < ${t.minReceiptRate}`);
    }
    return violations;
}
