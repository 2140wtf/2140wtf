const MSG_ID_RE = /^[0-9a-f]{32}$/;
const COMMIT_RE = /^[0-9a-f]{7,64}$/;
const MAX_REFS = 16;
const MAX_URL_CHARS = 2048;
const MAX_FILE_CHARS = 512;
const MAX_BRANCH_CHARS = 256;
const MAX_DIFF_CHARS = 32768;
const MAX_COMMAND_CHARS = 1024;
const MAX_COMMENT_CHARS = 4096;
function isUrlish(s) {
    return s.startsWith('https://') || s.startsWith('http://') || s.startsWith('30617:');
}
function validateRef(r) {
    if (!r || typeof r !== 'object')
        return null;
    const o = r;
    if (o.type !== 'github' && o.type !== 'ngit' && o.type !== 'url')
        return null;
    if (typeof o.url !== 'string' || o.url.length === 0 || o.url.length > MAX_URL_CHARS || !isUrlish(o.url))
        return null;
    const out = { type: o.type, url: o.url };
    if (typeof o.commit === 'string' && COMMIT_RE.test(o.commit))
        out.commit = o.commit;
    if (typeof o.branch === 'string' && o.branch.length > 0 && o.branch.length <= MAX_BRANCH_CHARS)
        out.branch = o.branch;
    if (typeof o.file === 'string' && o.file.length > 0 && o.file.length <= MAX_FILE_CHARS)
        out.file = o.file;
    if (Number.isSafeInteger(o.lineStart) && o.lineStart >= 1)
        out.lineStart = o.lineStart;
    if (Number.isSafeInteger(o.lineEnd) && o.lineEnd >= (out.lineStart ?? 1))
        out.lineEnd = o.lineEnd;
    return out;
}
/** Build a message payload carrying code references (encrypted in-envelope). */
export function buildCodeRefs(refs, opts = {}) {
    const valid = refs.map(validateRef).filter((r) => r !== null).slice(0, MAX_REFS);
    if (valid.length === 0)
        throw new Error('no valid code references');
    const to = (Array.isArray(opts.to) ? opts.to : typeof opts.to === 'string' && opts.to.length > 0 ? [opts.to] : []).filter((t) => typeof t === 'string' && t.length > 0).map((t) => t.toLowerCase()).slice(0, 64);
    return {
        ...(opts.text ? { text: opts.text } : {}),
        codeRefs: valid,
        ...(to.length > 0 ? { to } : {}),
    };
}
/** Parse code references from a payload ([] when none/invalid). */
export function parseCodeRefs(payload) {
    if (!payload || typeof payload !== 'object')
        return [];
    const r = payload.codeRefs;
    if (!Array.isArray(r))
        return [];
    return r.slice(0, MAX_REFS).map(validateRef).filter((x) => x !== null);
}
/** Build a diff payload (encrypted in-envelope). */
export function buildDiff(diff, opts = {}) {
    if (typeof diff !== 'string' || diff.length === 0)
        throw new Error('diff payload requires diff text');
    if (diff.length > MAX_DIFF_CHARS)
        throw new Error(`diff exceeds ${MAX_DIFF_CHARS} chars`);
    const d = { diff };
    if (typeof opts.repo === 'string' && opts.repo.length > 0 && opts.repo.length <= MAX_URL_CHARS)
        d.repo = opts.repo;
    if (typeof opts.commit === 'string' && COMMIT_RE.test(opts.commit))
        d.commit = opts.commit;
    return { ...(opts.text ? { text: opts.text } : {}), diff: d };
}
/** Parse a diff payload, or null when the payload carries no valid diff. */
export function parseDiff(payload) {
    if (!payload || typeof payload !== 'object')
        return null;
    const d = payload.diff;
    if (!d || typeof d !== 'object')
        return null;
    const { diff, repo, commit } = d;
    if (typeof diff !== 'string' || diff.length === 0 || diff.length > MAX_DIFF_CHARS)
        return null;
    const out = { diff };
    if (typeof repo === 'string' && repo.length > 0 && repo.length <= MAX_URL_CHARS)
        out.repo = repo;
    if (typeof commit === 'string' && COMMIT_RE.test(commit))
        out.commit = commit;
    return out;
}
const OPS = ['run', 'apply', 'review-request', 'note'];
/** Build an instruction payload (encrypted in-envelope). */
export function buildInstruction(instruction, opts = {}) {
    if (!OPS.includes(instruction.op))
        throw new Error(`unknown instruction op: ${instruction.op}`);
    const i = { op: instruction.op };
    if (typeof instruction.command === 'string' && instruction.command.length > 0) {
        if (instruction.command.length > MAX_COMMAND_CHARS)
            throw new Error(`command exceeds ${MAX_COMMAND_CHARS} chars`);
        i.command = instruction.command;
    }
    if ((instruction.op === 'run' || instruction.op === 'apply') && !i.command) {
        throw new Error(`${instruction.op} instruction requires a command`);
    }
    if (typeof instruction.repo === 'string' && instruction.repo.length > 0 && instruction.repo.length <= MAX_URL_CHARS)
        i.repo = instruction.repo;
    if (typeof instruction.branch === 'string' && instruction.branch.length > 0 && instruction.branch.length <= MAX_BRANCH_CHARS)
        i.branch = instruction.branch;
    return { ...(opts.text ? { text: opts.text } : {}), instruction: i };
}
/** Parse an instruction payload, or null when absent/invalid. */
export function parseInstruction(payload) {
    if (!payload || typeof payload !== 'object')
        return null;
    const i = payload.instruction;
    if (!i || typeof i !== 'object')
        return null;
    const o = i;
    if (typeof o.op !== 'string' || !OPS.includes(o.op))
        return null;
    const out = { op: o.op };
    if (typeof o.command === 'string' && o.command.length > 0 && o.command.length <= MAX_COMMAND_CHARS)
        out.command = o.command;
    if ((out.op === 'run' || out.op === 'apply') && !out.command)
        return null;
    if (typeof o.repo === 'string' && o.repo.length > 0 && o.repo.length <= MAX_URL_CHARS)
        out.repo = o.repo;
    if (typeof o.branch === 'string' && o.branch.length > 0 && o.branch.length <= MAX_BRANCH_CHARS)
        out.branch = o.branch;
    return out;
}
const VERDICTS = ['approved', 'changes-requested', 'comment'];
/** Build a review payload (encrypted in-envelope). */
export function buildReview(target, verdict, opts = {}) {
    if (!MSG_ID_RE.test(target))
        throw new Error('review target must be an envelope msg_id (32 hex chars)');
    if (!VERDICTS.includes(verdict))
        throw new Error(`unknown review verdict: ${verdict}`);
    const r = { target, verdict };
    if (typeof opts.comment === 'string' && opts.comment.length > 0) {
        if (opts.comment.length > MAX_COMMENT_CHARS)
            throw new Error(`comment exceeds ${MAX_COMMENT_CHARS} chars`);
        r.comment = opts.comment;
    }
    return { review: r };
}
/** Parse a review payload, or null when absent/invalid. */
export function parseReview(payload) {
    if (!payload || typeof payload !== 'object')
        return null;
    const r = payload.review;
    if (!r || typeof r !== 'object')
        return null;
    const o = r;
    if (typeof o.target !== 'string' || !MSG_ID_RE.test(o.target))
        return null;
    if (typeof o.verdict !== 'string' || !VERDICTS.includes(o.verdict))
        return null;
    const out = { target: o.target, verdict: o.verdict };
    if (typeof o.comment === 'string' && o.comment.length > 0 && o.comment.length <= MAX_COMMENT_CHARS)
        out.comment = o.comment;
    return out;
}
/** Extract all code-collaboration content from a payload (null when none). */
export function extractCodeContext(payload) {
    const codeRefs = parseCodeRefs(payload);
    const diff = parseDiff(payload);
    const instruction = parseInstruction(payload);
    const review = parseReview(payload);
    if (codeRefs.length === 0 && !diff && !instruction && !review)
        return null;
    return { codeRefs, diff, instruction, review };
}
