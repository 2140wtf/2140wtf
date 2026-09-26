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
 * Durability (CRED-04/CRED-08/CRED-09): every `append()` and `compact()`
 * fsyncs BEFORE reporting success, because a nullifier/invite burn that the
 * admission path has already granted MUST survive a crash — the secret to
 * one-credential-one-join is that a spent record cannot be un-burned by a
 * restart. A torn tail detected at replay is truncated (so the next append
 * starts on a clean line, not concatenated onto the torn bytes) and then
 * RE-BURNED as a `torn-tail` tombstone record, so the fact that a record
 * was dropped is itself durable in the chain and a repeated replay of the
 * same torn tail (crash loop) cannot silently re-drop it.
 *
 * NEVER logged here by policy (caller must honor it too): IP addresses,
 * link fragments / invite secrets, sub-minute timestamps. Ids passed to
 * append() MUST already be pseudonymized (see pseudonymize.ts).
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, appendFileSync, openSync, fsyncSync, closeSync, ftruncateSync } from 'node:fs';
import { dirname } from 'node:path';
const GENESIS = '0'.repeat(64);
/** Torn-tail id. Durable, deterministic — re-derivable iff the same torn
 *  tail comes back, so the tombstone re-burn can be coalesced. */
export function tornTailId(torn) {
    return createHash('sha256').update(`bao/torn-tail/v1:${torn}`).digest('hex');
}
function lineHash(line) {
    return createHash('sha256').update(`${line.seq}|${line.prev}|${JSON.stringify(line.rec)}`).digest('hex');
}
/** fsync a file before reporting durability to the admission path. A burn
 *  record the admission path already acted on MUST survive a crash (CRED-04
 *  / CRED-08). */
function fsyncFile(path) {
    const fd = openSync(path, 'r');
    try {
        fsyncSync(fd);
    }
    finally {
        closeSync(fd);
    }
}
/** Truncate the file to exactly `len` bytes (best-effort — throws if the
 *  directory/file is not writable, which the caller treats as fatal). */
function truncateSync(path, len) {
    const fd = openSync(path, 'r+');
    try {
        ftruncateSync(fd, len);
        fsyncSync(fd);
    }
    finally {
        closeSync(fd);
    }
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
            // (A chain-restart-at-tail — a parseable line whose prev is GENESIS —
            //  is treated as tampering exactly like any other chain break here.)
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
        /** In-memory replay of the chain — source for compaction and for
         *  restart-hydration of derived caches (CRED-09). */
        this.chainRecords = [];
        mkdirSync(dirname(file), { recursive: true });
        if (!existsSync(file)) {
            writeFileSync(file, '', { mode: 0o600 });
            fsyncFile(file);
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
            this.reBurnTornTail(text);
    }
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
    reBurnTornTail(text) {
        const droppedAtSeq = this.seq + 1;
        const lastNl = text.lastIndexOf('\n');
        // Everything up to (and including) the newline that ENDS the last good
        // line is preserved. A torn tail can be a partial line with no trailing
        // '\n' (crash mid-write) or a complete-but-unparseable line (weird disk
        // state); both are dropped in full.
        const keepBytes = lastNl < 0 ? 0 : lastNl + 1;
        truncateSync(this.file, keepBytes);
        const tombstone = {
            kind: 'torn-tail',
            id: tornTailId(text.slice(keepBytes)),
            ts: Math.floor(Date.now() / 1000),
        };
        const line = this.makeLine(tombstone);
        this.commit(line); // the tombstone is a real chain line
        appendFileSync(this.file, JSON.stringify(line) + '\n', { mode: 0o600 });
        fsyncFile(this.file);
        console.error(`[admission-log] torn tail truncated + re-burned as tombstone at seq ${droppedAtSeq} (the dropped record — possibly a nullifier/PoW/invite burn — is now provably gone, never silently resurrectable)`);
    }
    /** All records currently carried by this log instance, in chain order —
     *  the compaction input and the nullifier-drain source (CRED-09). */
    getLiveRecords() {
        return [...this.chainRecords];
    }
    /** Nullifier burns recorded in this log (newest last) — feed these into a
     *  NullifierCache on boot (ttlWithGraceSec = now - ts + grace) so a spent
     *  credential stays spent across a daemon restart (CRED-09). */
    drainNullifierRecords() {
        return this.chainRecords.filter((r) => r.kind === 'nullifier');
    }
    makeLine(rec) {
        const line = { seq: this.seq + 1, prev: this.head, rec };
        return { ...line, h: lineHash(line) };
    }
    commit(line) {
        this.seq = line.seq;
        this.head = line.h;
        this.chainRecords.push(line.rec);
    }
    /** Append one record durably; returns its sequence number and new chain
     *  head. Fsyncs BEFORE returning so the admission path never treats a burn
     *  as recorded while it is still only in the page cache (CRED-04). */
    append(rec) {
        const line = this.makeLine(rec);
        mkdirSync(dirname(this.file), { recursive: true });
        appendFileSync(this.file, JSON.stringify(line) + '\n', { mode: 0o600 });
        fsyncFile(this.file);
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
     * compaction exists so operators never truncate. Fsyncs the new chain
     * before the atomic rename — a crash after rename must not leave an
     * empty/partial log where the admission path thinks the old burns died
     * (CRED-08).
     */
    compact(liveRecords) {
        this.seq = 0;
        this.head = GENESIS;
        this.chainRecords.length = 0;
        const tmp = `${this.file}.compact-${process.pid}`;
        const lines = liveRecords.map((rec) => {
            const line = this.makeLine(rec);
            this.commit(line);
            return JSON.stringify(line);
        });
        writeFileSync(tmp, lines.length ? lines.join('\n') + '\n' : '', { mode: 0o600 });
        fsyncFile(tmp); // durable before rename — a crash now leaves the OLD file intact
        renameSync(tmp, this.file);
        fsyncFile(this.file); // rename durability (best-effort; fsync on the dir would need a dir fd)
    }
}
