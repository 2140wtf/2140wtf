export type AdmissionRecordKind = 'invite-use' | 'pow' | 'nullifier' | 'join';
export interface AdmissionRecord {
    kind: AdmissionRecordKind;
    /** Pseudonymized identifier (pseudonymize() output or random id). */
    id: string;
    /** Coarse wall-clock seconds — minute precision by convention. */
    ts?: number;
}
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
    constructor(file: string);
    private makeLine;
    private commit;
    /** Append one record durably; returns its sequence number and new chain head. */
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
     * compaction exists so operators never truncate.
     */
    compact(liveRecords: AdmissionRecord[]): void;
}
