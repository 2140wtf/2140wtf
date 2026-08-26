/**
 * admissionLog — P6b welcomer bookkeeping minimum (plan v3 non-goals table).
 *
 * Append-only JSONL with a per-line sha256 hash CHAIN (seq + prev-hash):
 * tamper-EVIDENCE, not tamper-PROOF — the welcomer key shares the box with
 * the file, so an HMAC adds nothing; a broken chain proves someone edited
 * history. Replay-on-boot tolerates ONE torn trailing line (crash mid-
 * append) and rejects anything else. Rotation = COMPACTION carrying
 * forward live records: naive truncation RESETS invite maxUses and
 * un-burns nullifiers/PoW entries.
 *
 * NEVER logged here by policy (caller must honor it too): IP addresses,
 * link fragments / invite secrets, sub-minute timestamps. Ids passed to
 * append() MUST already be pseudonymized (see pseudonymize.ts).
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';
const GENESIS = '0'.repeat(64);
function lineHash(line) {
    return createHash('sha256').update(`${line.seq}|${line.prev}|${JSON.stringify(line.rec)}`).digest('hex');
}
/** Parse JSONL into records + integrity report. Torn tail tolerated only at EOF. */
export function parseLog(text) {
    const lines = text.split('\n').filter((l) => l.length > 0);
    const records = [];
    let prev = GENESIS;
    let badChainAtSeq = null;
    let tornTail = false;
    for (let i = 0; i < lines.length; i++) {
        let obj;
        try {
            obj = JSON.parse(lines[i]);
        }
        catch {
            // Unparseable LAST line = torn tail (crash mid-append). Anywhere else,
            // or a PARSEABLE line that fails verification below = tampering.
            if (i === lines.length - 1)
                tornTail = true;
            else if (badChainAtSeq === null)
                badChainAtSeq = records.length + 1;
            break;
        }
        const expect = lineHash({ seq: obj.seq, prev: obj.prev, rec: obj.rec });
        const wantSeq = records.length + 1; // strictly contiguous — dup/gap = tampering
        if (obj.seq !== wantSeq || obj.prev !== prev || obj.h !== expect) {
            // Well-formed but fails the chain: tampering wherever it sits.
            // Report the EXPECTED position (attacker controls the claimed seq).
            if (i === lines.length - 1 && i > 0 && obj.seq < wantSeq && obj.prev === GENESIS)
                tornTail = false;
            if (badChainAtSeq === null)
                badChainAtSeq = wantSeq;
            break;
        }
        prev = obj.h;
        records.push(obj.rec);
    }
    return { records, tornTail, badChainAtSeq };
}
export class AdmissionLog {
    constructor(file) {
        this.file = file;
        this.seq = 0;
        this.head = GENESIS;
        mkdirSync(dirname(file), { recursive: true });
        if (!existsSync(file)) {
            writeFileSync(file, '', { mode: 0o600 });
            return;
        }
        const text = readFileSync(file, 'utf8');
        const { records, tornTail, badChainAtSeq } = parseLog(text);
        if (badChainAtSeq !== null && !tornTail) {
            throw new Error(`admission log chain broken at seq ${badChainAtSeq} — refusing to operate on tampered bookkeeping`);
        }
        for (const rec of records) {
            const line = this.makeLine(rec);
            this.commit(line); // deterministic re-derivation == original hashes
        }
        if (tornTail)
            console.error(`[admission-log] torn trailing line dropped during replay (${records.length} live records)`);
    }
    makeLine(rec) {
        const line = { seq: this.seq + 1, prev: this.head, rec };
        return { ...line, h: lineHash(line) };
    }
    commit(line) {
        this.seq = line.seq;
        this.head = line.h;
    }
    /** Append one record durably; returns its sequence number and new chain head. */
    append(rec) {
        const line = this.makeLine(rec);
        mkdirSync(dirname(this.file), { recursive: true });
        appendFileSync(this.file, JSON.stringify(line) + '\n', { mode: 0o600 });
        this.commit(line);
        return { seq: line.seq, head: line.h };
    }
    /** Verify the on-disk chain end-to-end. */
    verify() {
        if (!existsSync(this.file))
            return { ok: true, badAtSeq: null, records: 0 };
        const { records, tornTail, badChainAtSeq } = parseLog(readFileSync(this.file, 'utf8'));
        void tornTail;
        return { ok: badChainAtSeq === null, badAtSeq: badChainAtSeq, records: records.length };
    }
    /**
     * COMPACTION — the ONLY legal rotation. Rewrites the file carrying exactly
     * the live records under a fresh genesis chain. Truncation without
     * carrying counters resets invite maxUses and un-burns spent credentials;
     * compaction exists so operators never truncate.
     */
    compact(liveRecords) {
        this.seq = 0;
        this.head = GENESIS;
        const tmp = `${this.file}.compact-${process.pid}`;
        const lines = liveRecords.map((rec) => {
            const line = this.makeLine(rec);
            this.commit(line);
            return JSON.stringify(line);
        });
        writeFileSync(tmp, lines.length ? lines.join('\n') + '\n' : '', { mode: 0o600 });
        renameSync(tmp, this.file);
    }
}
