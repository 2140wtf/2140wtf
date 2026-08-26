/**
 * credits — room-private compute/work funding (protocol §7, agent lane).
 *
 * The ₿AO compute-credit state machine, carried INSIDE encrypted room
 * payloads instead of public event kinds. Semantics (clean-room from the
 * public bao_fund design; the wire shape is ours):
 *
 *   1. REQUEST   — an agent posts {credit:{op:'request',…}} naming an
 *                  amount and purpose.
 *   2. FULFILL   — a funder posts {credit:{op:'fulfill',…}} referencing the
 *                  request id. The Cashu token itself travels SEALED:
 *                  nested NIP-44 from funder to requester inside the same
 *                  payload (`sealedToken`). Room members see that funding
 *                  happened; only the requester can unwrap and spend.
 *   3. RECEIPT   — the requester posts {credit:{op:'receipt',…}} confirming
 *                  what they redeemed/spent. Self-signed, never proof of
 *                  payment.
 *
 * Reputation rules (same discipline as the public design):
 *   - "funded" requires BOTH a non-self fulfill AND the requester's own
 *     receipt for the same request id — a lone claim by either side is
 *     not funding.
 *   - Receipt `funders` tags are credibility-laundering unless named in a
 *     non-self fulfill for the same request (corroboratedFunders).
 *   - Receipts dedupe per request (N receipts for one request = 1).
 *
 * All of it rides the encrypted scroll: the relay sees no amounts, no
 * purposes, no tokens — nothing.
 */
import { encryptDm, decryptDm, bytesToHex, defaultRng } from './crypto.js';
const ID_RE = /^[0-9a-f]{16,64}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const MAX_PURPOSE_CHARS = 512;
const MAX_NOTE_CHARS = 512;
const MAX_PROVIDER_CHARS = 64;
const MAX_SEALED_CHARS = 8192;
const MAX_FUNDERS = 16;
/** 21M BTC supply in sats (21e6 BTC × 1e8 sats/BTC) — the request/fulfill/receipt amount ceiling. */
const MAX_AMOUNT_SATS = 21_000_000 * 100_000_000;
// ─── Sealed delivery (shared primitive for tokens, API keys, grants) ────────
/**
 * Seal a secret string (Cashu token, API key, …) to a recipient pubkey
 * with nested NIP-44 — safe to embed in an encrypted room payload: room
 * members see ciphertext-in-ciphertext, only the recipient unwraps.
 */
export function sealTo(secret, fromSecretKey, toPubkey, rng = defaultRng) {
    if (!HEX64.test(toPubkey))
        throw new Error('sealTo requires a 64-hex recipient pubkey');
    if (secret.length === 0 || secret.length > MAX_SEALED_CHARS)
        throw new Error('secret length out of bounds');
    return encryptDm(secret, fromSecretKey, toPubkey, rng);
}
/** Unseal a secret addressed to us. Throws when undecryptable (not ours / forged). */
export function unseal(sealed, toSecretKey, fromPubkey) {
    if (!HEX64.test(fromPubkey))
        throw new Error('unseal requires a 64-hex sender pubkey');
    return decryptDm(sealed, toSecretKey, fromPubkey);
}
function checkAmount(n) {
    return typeof n === 'number' && Number.isSafeInteger(n) && n > 0 && n <= MAX_AMOUNT_SATS;
}
export function buildCreditRequest(args) {
    if (!ID_RE.test(args.id))
        throw new Error('request id must be 16-64 hex chars');
    if (!checkAmount(args.amountSats))
        throw new Error('invalid amount');
    const purpose = args.purpose.trim();
    if (purpose.length === 0 || purpose.length > MAX_PURPOSE_CHARS)
        throw new Error('purpose required (≤512 chars)');
    if (args.from !== undefined && !HEX64.test(args.from))
        throw new Error('from must be the requester durable pubkey (64 hex)');
    return { credit: { op: 'request', id: args.id, amountSats: args.amountSats, purpose, ...(args.from ? { from: args.from.toLowerCase() } : {}) } };
}
export function buildCreditFulfill(args) {
    if (!ID_RE.test(args.requestId))
        throw new Error('requestId must be 16-64 hex chars');
    if (!checkAmount(args.amountSats))
        throw new Error('invalid amount');
    if (!HEX64.test(args.to))
        throw new Error('fulfill requires the requester pubkey (64 hex)');
    if (args.from !== undefined && !HEX64.test(args.from))
        throw new Error('from must be the funder durable pubkey (64 hex)');
    if (args.sealedToken !== undefined && (args.sealedToken.length === 0 || args.sealedToken.length > MAX_SEALED_CHARS)) {
        throw new Error('sealedToken length out of bounds');
    }
    if (args.sealedToken && !args.from)
        throw new Error('sealedToken requires from (funder durable pubkey) — the recipient unseals with it');
    return {
        credit: {
            op: 'fulfill',
            requestId: args.requestId,
            amountSats: args.amountSats,
            to: args.to.toLowerCase(),
            ...(args.from ? { from: args.from.toLowerCase() } : {}),
            ...(args.sealedToken ? { sealedToken: args.sealedToken } : {}),
        },
    };
}
export function buildCreditReceipt(args) {
    if (!ID_RE.test(args.requestId))
        throw new Error('requestId must be 16-64 hex chars');
    if (!checkAmount(args.amountSats))
        throw new Error('invalid amount');
    const note = args.note.trim();
    if (note.length === 0 || note.length > MAX_NOTE_CHARS)
        throw new Error('note required (≤512 chars)');
    if (args.provider !== undefined && args.provider.trim().length > MAX_PROVIDER_CHARS)
        throw new Error('provider too long');
    const funders = [...new Set((args.funders ?? []).filter((f) => HEX64.test(f)).map((f) => f.toLowerCase()))].slice(0, MAX_FUNDERS);
    return {
        credit: {
            op: 'receipt',
            requestId: args.requestId,
            amountSats: args.amountSats,
            note,
            ...(args.provider?.trim() ? { provider: args.provider.trim() } : {}),
            ...(funders.length > 0 ? { funders } : {}),
        },
    };
}
/** Parse any credit payload, or null when absent/invalid. */
export function parseCredit(payload) {
    if (!payload || typeof payload !== 'object')
        return null;
    const c = payload.credit;
    if (!c || typeof c !== 'object')
        return null;
    const o = c;
    if (o.op === 'request') {
        if (typeof o.id !== 'string' || !ID_RE.test(o.id))
            return null;
        if (!checkAmount(o.amountSats))
            return null;
        if (typeof o.purpose !== 'string' || o.purpose.trim().length === 0 || o.purpose.length > MAX_PURPOSE_CHARS)
            return null;
        if (o.from !== undefined && (typeof o.from !== 'string' || !HEX64.test(o.from)))
            return null;
        return { op: 'request', id: o.id, amountSats: o.amountSats, purpose: o.purpose.trim(), ...(typeof o.from === 'string' ? { from: o.from.toLowerCase() } : {}) };
    }
    if (o.op === 'fulfill') {
        if (typeof o.requestId !== 'string' || !ID_RE.test(o.requestId))
            return null;
        if (!checkAmount(o.amountSats))
            return null;
        if (typeof o.to !== 'string' || !HEX64.test(o.to))
            return null;
        if (o.from !== undefined && (typeof o.from !== 'string' || !HEX64.test(o.from)))
            return null;
        if (o.sealedToken !== undefined && (typeof o.sealedToken !== 'string' || o.sealedToken.length === 0 || o.sealedToken.length > MAX_SEALED_CHARS))
            return null;
        // NO sealed-without-`from` rejection here: legacy scrolls carry sealed
        // tokens without the sealer key reference, and rejecting them would
        // silently drop old funding claims out of foldCredits. New fulfills are
        // strict at BUILD time (buildCreditFulfill); parsing stays v1-tolerant.
        return {
            op: 'fulfill',
            requestId: o.requestId,
            amountSats: o.amountSats,
            to: o.to.toLowerCase(),
            ...(typeof o.from === 'string' ? { from: o.from.toLowerCase() } : {}),
            ...(typeof o.sealedToken === 'string' ? { sealedToken: o.sealedToken } : {}),
        };
    }
    if (o.op === 'receipt') {
        if (typeof o.requestId !== 'string' || !ID_RE.test(o.requestId))
            return null;
        if (!checkAmount(o.amountSats))
            return null;
        if (typeof o.note !== 'string' || o.note.trim().length === 0 || o.note.length > MAX_NOTE_CHARS)
            return null;
        if (o.provider !== undefined && (typeof o.provider !== 'string' || o.provider.length > MAX_PROVIDER_CHARS))
            return null;
        const funders = Array.isArray(o.funders)
            ? [...new Set(o.funders.filter((f) => typeof f === 'string' && HEX64.test(f)).map((f) => f.toLowerCase()))].slice(0, MAX_FUNDERS)
            : undefined;
        return {
            op: 'receipt',
            requestId: o.requestId,
            amountSats: o.amountSats,
            note: o.note.trim(),
            ...(typeof o.provider === 'string' && o.provider.trim() ? { provider: o.provider.trim() } : {}),
            ...(funders && funders.length > 0 ? { funders } : {}),
        };
    }
    return null;
}
/** Fresh random request id (16 bytes hex). */
export function newCreditId(rng = defaultRng) {
    return bytesToHex(rng(16));
}
/**
 * Fold credit ops from a merged scroll into per-request state. Redacted
 * messages are excluded (governance removal). Fulfill/receipt authorship
 * is the envelope author — the same trust anchor as every other fold.
 */
export function foldCredits(messages) {
    const requests = new Map();
    const pending = [];
    for (const m of messages) {
        if (m.redacted)
            continue;
        const op = parseCredit(m.envelope.payload);
        if (!op)
            continue;
        if (op.op === 'request') {
            if (!requests.has(op.id)) {
                requests.set(op.id, { request: op, requester: m.envelope.author, funderClaims: new Map(), receipts: [], funded: false });
            }
        }
        else {
            pending.push({ author: m.envelope.author, op });
        }
    }
    for (const { author, op } of pending) {
        const state = requests.get(op.requestId);
        if (!state)
            continue; // references an unknown/redacted request
        if (op.op === 'fulfill') {
            if (author.toLowerCase() === state.requester.toLowerCase())
                continue; // self-fulfill is not funding
            // The token must be sealed to the requester's declared durable key: a
            // fulfill to a different key can never be unsealed by the requester, so
            // it must not count as funding (the requester simply cannot spend it).
            if (state.request.from && op.to.toLowerCase() !== state.request.from.toLowerCase())
                continue;
            state.funderClaims.set(author, op);
        }
        else {
            if (author.toLowerCase() !== state.requester.toLowerCase())
                continue; // receipts are self-reports
            state.receipts.push(op);
        }
    }
    const fundedIds = [];
    for (const [id, state] of requests) {
        state.funded = state.funderClaims.size > 0 && state.receipts.length > 0;
        if (state.funded)
            fundedIds.push(id);
    }
    return { requests, fundedIds };
}
/**
 * Filter a receipt's claimed funders to those with a non-self fulfill for
 * the same request — the only names a UI may render as "funded by X".
 */
export function corroboratedFunders(state, receipt) {
    const claimers = new Set([...state.funderClaims.keys()].map((k) => k.toLowerCase()));
    return (receipt.funders ?? []).filter((f) => claimers.has(f.toLowerCase()));
}
