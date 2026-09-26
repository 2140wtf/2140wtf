export type AdmissionRecordKind = 'invite-use' | 'pow' | 'nullifier' | 'join' | 'torn-tail';
export interface AdmissionRecord {
    kind: AdmissionRecordKind;
    /** Pseudonymized identifier (pseudonymize() output or random id). */
    id: string;
    /** Coarse wall-clock seconds — minute precision by convention. */
    ts?: number;
}
/** Torn-tail id. Durable, deterministic — re-derivable iff the same torn
 *  tail comes back, so the tombstone re-burn can be coalesced. */
export declare function tornTailId(torn: string): string;
/** Parse JSONL into records + integrity report. Torn tail tolerated only at EOF. */
export declare function parseLog(text: string): {
    records: AdmissionRecord[];
    tornTail: boolean;
    badChainAtSeq: number | null;
};
export declare class AdmissionLog {
    private readonly file;
    private seq;
    private head;
    /** In-memory replay of the chain — source for compaction and for
     *  restart-hydration of derived caches (CRED-09). */
    private readonly chainRecords;
    constructor(file: string);
    /**
     * CRED-04: a torn tail is not just dropped — the drop is made DURABLE.
     * The torn bytes are truncated from the file (so the next append starts
     * on a clean line instead of concatenating onto them, which would mutate
     * records on every boot), then a `torn-tail` TOMBSTONE record is folded
     * into the same hash chain and fsynced. On a subsequent replay the
     * tombstone replays as a normal record, so the same torn tail can never
     * re-trip this branch and silently shed another live record — a spent
     * nullifier/PoW/invite burn that was lost to the crash stays provably
     * dropped (a hard marker in the chain both above and below it).
     */
    private reBurnTornTail;
    /** All records currently carried by this log instance, in chain order —
     *  the compaction input and the nullifier-drain source (CRED-09). */
    getLiveRecords(): AdmissionRecord[];
    /** Nullifier burns recorded in this log (newest last) — feed these into a
     *  NullifierCache on boot (ttlWithGraceSec = now - ts + grace) so a spent
     *  credential stays spent across a daemon restart (CRED-09). */
    drainNullifierRecords(): AdmissionRecord[];
    private makeLine;
    private commit;
    /** Append one record durably; returns its sequence number and new chain
     *  head. Fsyncs BEFORE returning so the admission path never treats a burn
     *  as recorded while it is still only in the page cache (CRED-04). */
    append(rec: AdmissionRecord): {
        seq: number;
        head: string;
    };
    /** Verify the on-disk chain end-to-end. */
    verify(): {
        ok: boolean;
        badAtSeq: number | null;
        records: number;
    };
    /**
     * COMPACTION — the ONLY legal rotation. Rewrites the file carrying exactly
     * the live records under a fresh genesis chain. Truncation without
     * carrying counters resets invite maxUses and un-burns spent credentials;
     * compaction exists so operators never truncate. Fsyncs the new chain
     * before the atomic rename — a crash after rename must not leave an
     * empty/partial log where the admission path thinks the old burns died
     * (CRED-08).
     */
    compact(liveRecords: AdmissionRecord[]): void;
}
