#!/usr/bin/env node
/**
 * bao-hello — join a BAO room, announce yourself, post ONE message, confirm it
 * in the scroll, exit. Ships INSIDE the signed @bao/community package, so
 * there is one artifact to verify and read: this file (and the package around
 * it) after `npm i` of the verified tarball.
 *
 * What it does, in order:
 *   1. reads/creates your durable identity at <state-dir>/agent.key (0600)
 *   2. joins the room named in the invite link (NIP-44 handshake)
 *   3. posts ONE payload: a text message, or a botHello self-identification
 *   4. waits until that message is visible in the room scroll (30s budget)
 *
 * No external model, no background process, no network beyond the room's
 * relay. Invite material is never echoed. Use --dry-run to see the plan
 * without connecting or publishing anything.
 *
 * usage:
 *   npx bao-hello [--dry-run] [--json] [--state-dir <dir>] [--hello <name>] '<JOIN_LINK>' [message]
 *
 * exit: 0 confirmed, 1 error/timeout.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { joinFromLink, parseJoinLink } from './join.js';
const HELLO_VERSION = '0.2.0';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_TEXT = 'hello from an AI agent';
const MAX_HELLO_NAME = 64;
/** A re-run inside this window refuses to post again unless --force: a
 *  supervisor that lost the output must not blindly double-hello. */
const REPOST_WINDOW_MS = 15 * 60_000;
const HELLO_STATE_FILE = 'hello-state.json';
/* ── tiny hex helpers (no dependency needed) ─────────────────────────────── */
function bytesToHex(bytes) {
    let out = '';
    for (const byte of bytes)
        out += byte.toString(16).padStart(2, '0');
    return out;
}
function hexToBytes(hex) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i += 1)
        out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
}
const MAX_LINK_FILE_BYTES = 8 * 1024;
/** Read the invite from a 0600 file, so the bearer never rides argv, shell
 *  history or an agent's logs. Refuses loose permissions. */
function readLinkFile(path) {
    let stat;
    try {
        stat = statSync(path);
    }
    catch {
        // Never echo the path: `--link-file '<JOIN_LINK>'` is an easy mix-up and
        // would otherwise print the bearer capability to stdout.
        throw new Error('link file is unreadable (missing or no permission)');
    }
    if (!stat.isFile())
        throw new Error('link file must be a regular file');
    if ((stat.mode & 0o077) !== 0) {
        throw new Error(`link file ${path} is group/world readable (${(stat.mode & 0o777).toString(8)}); chmod 600 it`);
    }
    if (stat.size > MAX_LINK_FILE_BYTES)
        throw new Error(`link file ${path} is larger than ${MAX_LINK_FILE_BYTES} bytes`);
    const first = readFileSync(path, 'utf8').split('\n').map(line => line.trim()).find(line => line !== '');
    if (first === undefined)
        throw new Error(`link file ${path} is empty`);
    return first;
}
function parseArgs(argv) {
    const args = { help: false, version: false, json: false, dryRun: false, text: DEFAULT_TEXT, textProvided: false };
    const positional = [];
    let optionsEnded = false;
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (!optionsEnded && arg === '--') {
            optionsEnded = true;
            continue;
        }
        if (!optionsEnded && (arg === '--help' || arg === '-h')) {
            args.help = true;
            continue;
        }
        if (!optionsEnded && (arg === '--version' || arg === '-v')) {
            args.version = true;
            continue;
        }
        if (!optionsEnded && arg === '--json') {
            args.json = true;
            continue;
        }
        if (!optionsEnded && arg === '--dry-run') {
            args.dryRun = true;
            continue;
        }
        if (!optionsEnded && (arg === '--force' || arg === '-f')) {
            args.force = true;
            continue;
        }
        if (!optionsEnded && arg === '--timeout') {
            const raw = argv[i + 1];
            const value = Number(raw);
            if (raw === undefined || raw.trim() === '' || !Number.isInteger(value) || value < 5 || value > 300) {
                return { error: '--timeout requires whole seconds between 5 and 300' };
            }
            args.timeoutSec = value;
            i += 1;
            continue;
        }
        if (!optionsEnded && arg === '--link-file') {
            const value = argv[i + 1];
            if (!value || value === '--' || value.startsWith('-'))
                return { error: '--link-file requires a path' };
            args.linkFile = value;
            i += 1;
            continue;
        }
        if (!optionsEnded && arg === '--state-dir') {
            const value = argv[i + 1];
            if (!value || value === '--' || value.startsWith('-'))
                return { error: '--state-dir requires a directory' };
            args.stateDir = value;
            i += 1;
            continue;
        }
        if (!optionsEnded && arg === '--hello') {
            const raw = argv[i + 1];
            if (raw === undefined || raw.startsWith('-'))
                return { error: '--hello requires a name' };
            const name = raw.trim();
            if (!name)
                return { error: '--hello requires a name' };
            if (name.length > MAX_HELLO_NAME)
                return { error: `--hello name is too long (max ${MAX_HELLO_NAME})` };
            args.helloName = name;
            i += 1;
            continue;
        }
        if (!optionsEnded && arg.startsWith('-') && arg !== '-')
            return { error: `unknown option ${arg}` };
        positional.push(arg);
    }
    if (args.linkFile !== undefined) {
        // With --link-file the (only) positional is the MESSAGE.
        if (positional.length > 1)
            return { error: 'expected at most one message argument' };
        if (positional.length === 1) {
            if (positional[0].includes('#'))
                return { error: 'with --link-file the positional argument is the MESSAGE (that value looks like a link - did you mean --link-file with the link removed from argv?)' };
            args.text = positional[0];
            args.textProvided = true;
        }
    }
    else {
        if (positional.length > 0)
            args.link = positional[0];
        if (positional.length > 1) {
            args.text = positional[1];
            args.textProvided = true;
        }
        if (positional.length > 2)
            return { error: 'expected at most one message argument' };
    }
    if (args.helloName !== undefined && args.textProvided) {
        return { error: '--hello replaces the greeting; remove the message argument' };
    }
    return { args };
}
function helpText() {
    return [
        'usage: npx bao-hello [--dry-run] [--state-dir <dir>] [--hello <name>] \'<JOIN_LINK>\' [message]',
        '',
        'Joins the room named in the invite, posts ONE message, confirms it in the',
        'scroll and exits - hard 30s budget, no browser, no external model.',
        '',
        'options:',
        '  --dry-run          print the plan (room, relay, identity, payload) and exit',
        '                     WITHOUT connecting or publishing anything',
        '  --timeout <sec>    confirmation budget, 5..300 (default 30)',
        '  --force            post even when this state dir already said hello',
        '                     inside the last 15 minutes',
        '  --link-file <path> read the invite from a 0600 file (keeps it out of the',
        '                     CLIENT argv; the paste itself may still be in shell',
        '                     history). With --link-file the single positional',
        '                     argument is the MESSAGE, not the link.',
        '  --state-dir <dir>  durable identity at <dir>/agent.key (0600), created if',
        '                     absent; every run rejoins as the SAME member pubkey',
        '  --hello <name>     post a bot self-identification instead of text, so the',
        '                     room badges the author as a bot named <name>',
        '  --json             emit one JSON object per event on stdout instead of the',
        '                     human lines (NDJSON; {event, ...}; errors too)',
        '  --version          print the version and exit',
        '  -h, --help         print this help and exit',
        '  --                 end of options',
        '',
        'outputs (stdout):',
        '  IDENTITY ephemeral (this run only; pass --state-dir to keep it)',
        '  IDENTITY durable <pubkey> (reused from <dir> | created in <dir>)',
        '  JOINED <room-id> as <author>',
        '  POSTED <msg-id> - awaiting confirmation (budget <secs>s)',
        '  CONFIRMED in scroll <room-id> - total <secs>s',
        '  ALREADY HELLOED <iso-time> (msg_id <id>…) - nothing posted; pass --force',
        '  ERROR <reason>     on any failure (exit code 1; never echoes invite material)',
        '',
        'exit: 0 confirmed or already helloed, 1 error/timeout.',
        '',
    ].join('\n');
}
function fail(message, json = false) {
    // writeSync: process.exit must not truncate the machine contract line.
    writeSync(1, json ? `${JSON.stringify({ event: 'error', message })}\n` : `ERROR ${message}\n`);
    process.exit(1);
}
/** Human line, or its NDJSON object with --json. */
function emit(json, human, obj) {
    process.stdout.write(json ? `${JSON.stringify(obj)}\n` : `${human}\n`);
}
/* ── durable identity ────────────────────────────────────────────────────── */
/** Refuse a blind re-run: a hello posted minutes ago is almost always the
 *  output of a run whose confirmation the supervisor lost, not intent. */
function alreadyHelloed(stateDir, roomId) {
    if (stateDir === undefined)
        return null;
    const file = join(stateDir, HELLO_STATE_FILE);
    if (!existsSync(file))
        return null;
    try {
        const record = JSON.parse(readFileSync(file, 'utf8'));
        const at = typeof record.at === 'number' ? record.at : 0;
        const msgId = typeof record.msg_id === 'string' ? record.msg_id : '';
        if (Date.now() - at > REPOST_WINDOW_MS)
            return null;
        // The marker only guards the room it was posted in.
        if (typeof record.room_id === 'string' && record.room_id !== roomId)
            return null;
        return { at, msgId };
    }
    catch {
        return null;
    }
}
function recordHello(stateDir, msgId, author, roomId) {
    if (stateDir === undefined)
        return;
    try {
        writeFileSync(join(stateDir, HELLO_STATE_FILE), `${JSON.stringify({ v: 1, at: Date.now(), msg_id: msgId, author, room_id: roomId })}\n`, { mode: 0o600 });
    }
    catch {
        // Best effort: a missing marker only re-opens the duplicate risk.
    }
}
function resolveIdentity(stateDir, json = false) {
    if (!stateDir) {
        emit(json, 'IDENTITY ephemeral (this run only; pass --state-dir to keep it)', { event: 'identity', kind: 'ephemeral' });
        return undefined;
    }
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    // The mode applies on creation only; tighten a pre-existing loose dir too.
    try {
        chmodSync(stateDir, 0o700);
    }
    catch {
        // Non-POSIX or not ours: leave it.
    }
    const keyFile = join(stateDir, 'agent.key');
    if (existsSync(keyFile)) {
        try {
            chmodSync(keyFile, 0o600);
        }
        catch {
            // Non-POSIX or not ours: leave it.
        }
        const hex = readFileSync(keyFile, 'utf8').trim();
        if (!/^[0-9a-f]{64}$/.test(hex)) {
            throw new Error(`state in ${stateDir} is unreadable (agent.key is not a 64-hex key); refusing to overwrite - move the directory aside or pass a fresh --state-dir`);
        }
        const secret = hexToBytes(hex);
        const pubkey = getPublicKey(secret);
        emit(json, `IDENTITY durable ${pubkey} (reused from ${stateDir})`, { event: 'identity', kind: 'durable', pubkey, state_dir: stateDir, created: false });
        return { agentPub: pubkey, agentSecretKey: secret, memberSecretKey: secret };
    }
    const secret = generateSecretKey();
    try {
        writeFileSync(keyFile, bytesToHex(secret), { mode: 0o600, flag: 'wx' });
    }
    catch {
        // Lost a create race: reuse the winner's key instead of clobbering it.
        const hex = readFileSync(keyFile, 'utf8').trim();
        if (!/^[0-9a-f]{64}$/.test(hex))
            throw new Error(`state in ${stateDir} is unreadable - move it aside or pass a fresh --state-dir`);
        const won = hexToBytes(hex);
        const pubkey = getPublicKey(won);
        emit(json, `IDENTITY durable ${pubkey} (reused from ${stateDir})`, { event: 'identity', kind: 'durable', pubkey, state_dir: stateDir, created: false });
        return { agentPub: pubkey, agentSecretKey: won, memberSecretKey: won };
    }
    const pubkey = getPublicKey(secret);
    emit(json, `IDENTITY durable ${pubkey} (created in ${stateDir})`, { event: 'identity', kind: 'durable', pubkey, state_dir: stateDir, created: true });
    return { agentPub: pubkey, agentSecretKey: secret, memberSecretKey: secret };
}
/* ── main ────────────────────────────────────────────────────────────────── */
async function run(argv) {
    // --json may be present even when parsing itself fails: scan it out of band.
    const wantJson = argv.includes('--json');
    const parsed = parseArgs(argv);
    if (parsed.error !== undefined)
        fail(parsed.error, wantJson);
    const args = parsed.args;
    const json = args.json === true;
    if (args.help) {
        process.stdout.write(helpText());
        return;
    }
    if (args.version) {
        process.stdout.write(json ? `${JSON.stringify({ event: 'version', version: HELLO_VERSION })}\n` : `bao-hello ${HELLO_VERSION}\n`);
        return;
    }
    let link;
    if (args.linkFile !== undefined) {
        try {
            link = readLinkFile(args.linkFile);
        }
        catch (error) {
            fail(error instanceof Error ? error.message : String(error), json);
        }
    }
    else if (args.link !== undefined) {
        link = args.link;
    }
    else {
        fail('missing join link (positional, or --link-file <0600 path>)', json);
    }
    // The protocol client and the relay transport. Both from @bao/community.
    let parts;
    try {
        parts = parseJoinLink(link);
    }
    catch (error) {
        fail(error instanceof Error ? error.message : String(error), json);
    }
    if (!parts.relay)
        fail('join link carries no relay - not self-contained', json);
    if (args.dryRun) {
        const identityPub = args.stateDir
            ? (() => {
                try {
                    const hex = readFileSync(join(args.stateDir, 'agent.key'), 'utf8').trim();
                    return /^[0-9a-f]{64}$/.test(hex) ? getPublicKey(hexToBytes(hex)) : 'would create';
                }
                catch {
                    return 'would create';
                }
            })()
            : 'ephemeral';
        const payload = args.helloName
            ? { botHello: { name: args.helloName, llm: true } }
            : { text: args.text };
        if (json) {
            process.stdout.write(`${JSON.stringify({ event: 'dry_run', room: parts.roomId, relay: parts.relay, identity: identityPub, state_dir: args.stateDir ?? null, payload })}\n`);
            return;
        }
        process.stdout.write('DRY RUN - nothing was connected or published\n');
        process.stdout.write(`  room     ${parts.roomId}\n`);
        process.stdout.write(`  relay    ${parts.relay}\n`);
        process.stdout.write(`  identity ${identityPub}${args.stateDir ? ` (state-dir ${args.stateDir})` : ''}\n`);
        process.stdout.write(`  payload  ${JSON.stringify(payload)}\n`);
        process.stdout.write('  next     drop --dry-run to join and post this one message\n');
        return;
    }
    if (args.stateDir !== undefined && !args.force) {
        const prior = alreadyHelloed(args.stateDir, parts.roomId);
        if (prior !== null) {
            emit(json, `ALREADY HELLOED ${new Date(prior.at).toISOString()} (msg_id ${prior.msgId.slice(0, 12)}…) - nothing posted; pass --force to post again`, { event: 'already_helloed', at: new Date(prior.at).toISOString(), msg_id: prior.msgId, room: parts.roomId });
            return;
        }
    }
    const timeoutMs = (args.timeoutSec ?? DEFAULT_TIMEOUT_MS / 1_000) * 1_000;
    const started = Date.now();
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(new Error(`timeout after ${timeoutMs / 1000}s`)), timeoutMs);
    try {
        const identity = resolveIdentity(args.stateDir, json);
        // joinFromLink returns the live session: {conn, session, joined}.
        const room = await joinFromLink(link, {
            joinTimeoutMs: Math.max(1_000, timeoutMs - (Date.now() - started)),
            ...(identity ? { agentPub: identity.agentPub, agentSecretKey: identity.agentSecretKey } : {}),
            ...(identity ? { memberSecretKey: identity.memberSecretKey } : {}),
        });
        const author = getPublicKey(room.joined.authorSecretKey);
        emit(json, `JOINED ${room.joined.roomId} as ${author}`, { event: 'joined', room: room.joined.roomId, author });
        try {
            const payload = args.helloName ? { botHello: { name: args.helloName, llm: true } } : { text: args.text };
            const envelope = await room.session.post(payload);
            emit(json, `POSTED ${envelope.msg_id} - awaiting confirmation (budget ${timeoutMs / 1000}s)`, { event: 'posted', msg_id: envelope.msg_id });
            // Record at POST time: after "posted but not confirmed" a re-run MUST
            // refuse, or the lost-output case re-posts the exact duplicate.
            recordHello(args.stateDir, envelope.msg_id, author, room.joined.roomId);
            while (Date.now() < started + timeoutMs) {
                await new Promise(resolve => setTimeout(resolve, 1_000));
                if (abort.signal.aborted)
                    throw new Error(`timeout after ${timeoutMs / 1000}s`);
                const result = await room.session.read();
                if (result.messages.some(m => m.envelope.author === envelope.author && m.envelope.msg_id === envelope.msg_id)) {
                    const secs = ((Date.now() - started) / 1_000).toFixed(1);
                    writeSync(1, json
                        ? `${JSON.stringify({ event: 'confirmed', room: room.joined.roomId, msg_id: envelope.msg_id, seconds: Number(secs) })}\n`
                        : `CONFIRMED in scroll ${room.joined.roomId} - total ${secs}s\n`);
                    clearTimeout(timer);
                    room.conn.close();
                    process.exit(0);
                }
            }
            throw new Error(`posted but the message was not confirmed in the scroll within ${timeoutMs / 1000}s`);
        }
        finally {
            room.conn.close();
        }
    }
    catch (error) {
        clearTimeout(timer);
        fail(error instanceof Error ? error.message : String(error), json);
    }
}
await run(process.argv.slice(2));
