/**
 * botCommands — discoverable bot capabilities INSIDE encrypted rooms (§7).
 *
 * Bots publish a command manifest as an encrypted room payload
 * (`payload.botManifest`) instead of a public relay event — only room
 * members can discover what a bot does. The relay sees ciphertext, exactly
 * as with mentions/replies/reactions/code payloads. No new kinds, no new
 * tags, no wire change.
 *
 * Addressing maps onto the existing encrypted mention field: an invocation
 * posted with `payload.to = [botPub]` is addressed at that bot; an
 * invocation without `to` is a broadcast any bot may answer. Addressing is
 * routing, never authorization — bots authorize by the envelope author,
 * never by the presence of a `to` entry.
 *
 * Invocation grammar (transport-agnostic, content-level):
 *   content := "/" name ( SP arg )*
 * The command word folds to lowercase; argument values keep their case.
 * Tokens are whitespace-separated with shell-style quoting ("…", \" and \\
 * escapes). When the FINAL declared argument has type string and the next
 * input character is not a quote, that argument takes the raw remainder of
 * the line verbatim (greedy tail) — so /say hello there works unquoted.
 *
 * Errors are canonical and client-parseable:
 *   <arg>: <reason>
 *   usage: /name <arg:type> [opt:type]
 *
 * Caps: manifests are validated on build AND parse; every bound exists so a
 * hostile manifest or invocation cannot make clients do unbounded work.
 */
const NAME_RE = /^[a-z0-9_-]{1,32}$/;
const ARG_TYPES = ['string', 'int', 'number', 'bool', 'user', 'choice'];
const MAX_COMMANDS = 64;
const MAX_ARGS = 8;
const MAX_DESC_BYTES = 200;
const MAX_CHOICES = 32;
const MAX_CHOICE_BYTES = 32;
const MAX_MANIFEST_BYTES = 32768;
function byteLen(s) {
    return new TextEncoder().encode(s).length;
}
/** Validate a raw manifest object; returns the normalized manifest or an error string. */
function validateManifest(raw) {
    if (!raw || typeof raw !== 'object')
        return 'manifest is not an object';
    const m = raw;
    if (m.v !== 1)
        return 'unsupported manifest version';
    const cmds = m.commands;
    if (cmds === undefined)
        return { v: 1, commands: [] };
    if (!Array.isArray(cmds))
        return 'commands is not an array';
    if (cmds.length > MAX_COMMANDS)
        return `more than ${MAX_COMMANDS} commands`;
    const seen = new Set();
    const out = [];
    for (const c of cmds) {
        if (!c || typeof c !== 'object')
            return 'command is not an object';
        const co = c;
        if (typeof co.name !== 'string' || !NAME_RE.test(co.name))
            return `bad command name: ${String(co.name)}`;
        if (seen.has(co.name))
            return `duplicate command: ${co.name}`;
        seen.add(co.name);
        const description = typeof co.description === 'string' ? co.description : '';
        if (byteLen(description) > MAX_DESC_BYTES)
            return `description too long on ${co.name}`;
        const rawArgs = co.args === undefined ? [] : co.args;
        if (!Array.isArray(rawArgs))
            return `args is not an array on ${co.name}`;
        if (rawArgs.length > MAX_ARGS)
            return `more than ${MAX_ARGS} args on ${co.name}`;
        const argSeen = new Set();
        const args = [];
        let sawOptional = false;
        for (const a of rawArgs) {
            if (!a || typeof a !== 'object')
                return `arg is not an object on ${co.name}`;
            const ao = a;
            if (typeof ao.name !== 'string' || !NAME_RE.test(ao.name))
                return `bad arg name on ${co.name}`;
            if (argSeen.has(ao.name))
                return `duplicate arg ${ao.name} on ${co.name}`;
            argSeen.add(ao.name);
            if (typeof ao.type !== 'string' || !ARG_TYPES.includes(ao.type))
                return `bad arg type on ${co.name}.${ao.name}`;
            const type = ao.type;
            const required = ao.required === true;
            // Positional-parse contract: required args MUST precede optional ones.
            if (required && sawOptional)
                return `required arg after optional on ${co.name}`;
            if (!required)
                sawOptional = true;
            const argDesc = typeof ao.description === 'string' ? ao.description : '';
            if (byteLen(argDesc) > MAX_DESC_BYTES)
                return `arg description too long on ${co.name}.${ao.name}`;
            const arg = { name: ao.name, type, description: argDesc, required };
            if (type === 'choice') {
                if (!Array.isArray(ao.choices) || ao.choices.length < 1 || ao.choices.length > MAX_CHOICES) {
                    return `bad choices on ${co.name}.${ao.name}`;
                }
                for (const ch of ao.choices) {
                    if (typeof ch !== 'string' || ch.length < 1 || byteLen(ch) > MAX_CHOICE_BYTES)
                        return `bad choice on ${co.name}.${ao.name}`;
                }
                arg.choices = ao.choices;
            }
            args.push(arg);
        }
        out.push({ name: co.name, description, args });
    }
    return { v: 1, commands: out };
}
/**
 * Build a bot-manifest room payload (encrypted in-envelope). Throws on an
 * invalid manifest — bots MUST NOT publish invalid manifests.
 */
export function buildBotManifest(commands) {
    const validated = validateManifest({ v: 1, commands });
    if (typeof validated === 'string')
        throw new Error(`invalid bot manifest: ${validated}`);
    const json = JSON.stringify(validated);
    if (byteLen(json) > MAX_MANIFEST_BYTES)
        throw new Error(`manifest exceeds ${MAX_MANIFEST_BYTES} bytes`);
    return { botManifest: validated };
}
/**
 * Parse and validate a bot-manifest payload. Returns null when the payload
 * carries no manifest or the manifest fails validation — a manifest that
 * fails validation has no usable interface and MUST be ignored.
 */
export function parseBotManifest(payload) {
    if (!payload || typeof payload !== 'object')
        return null;
    const m = payload.botManifest;
    if (m === undefined)
        return null;
    const validated = validateManifest(m);
    return typeof validated === 'string' ? null : validated;
}
const TYPE_RENDER = {
    string: 'text',
    int: 'int',
    number: 'number',
    bool: 'true|false',
    user: 'npub',
    choice: 'choice',
};
/** The canonical usage line for a command: /name <req:type> [opt:type]. */
export function usageLine(cmd) {
    const parts = cmd.args.map((a) => (a.required ? `<${a.name}:${TYPE_RENDER[a.type]}>` : `[${a.name}:${TYPE_RENDER[a.type]}]`));
    return `/${cmd.name}${parts.length > 0 ? ' ' + parts.join(' ') : ''}`;
}
function fail(cmd, arg, reason) {
    return { command: cmd.name, error: `${arg}: ${reason}\nusage: ${usageLine(cmd)}` };
}
/** Shell-style tokenize. Returns null on unterminated quote (malformed). */
function tokenize(input) {
    const out = [];
    let i = 0;
    const n = input.length;
    while (i < n) {
        while (i < n && /\s/.test(input[i]))
            i++;
        if (i >= n)
            break;
        const rest = input.slice(i);
        if (input[i] === '"') {
            i++;
            let value = '';
            let closed = false;
            while (i < n) {
                const ch = input[i];
                if (ch === '\\' && i + 1 < n && (input[i + 1] === '"' || input[i + 1] === '\\')) {
                    value += input[i + 1];
                    i += 2;
                }
                else if (ch === '"') {
                    closed = true;
                    i++;
                    break;
                }
                else {
                    value += ch;
                    i++;
                }
            }
            if (!closed)
                return null;
            out.push({ value, rest });
        }
        else {
            let value = '';
            while (i < n && !/\s/.test(input[i])) {
                value += input[i];
                i++;
            }
            out.push({ value, rest });
        }
    }
    return out;
}
const NPUB_RE = /^npub1[02-9ac-hj-np-z]{10,}$/;
function coerceArg(cmd, arg, raw) {
    switch (arg.type) {
        case 'string':
            return { ok: true, value: raw };
        case 'int': {
            if (!/^-?\d+$/.test(raw))
                return { ok: false, err: fail(cmd, arg.name, 'not an integer') };
            const v = Number(raw);
            if (!Number.isSafeInteger(v))
                return { ok: false, err: fail(cmd, arg.name, 'not an integer') };
            return { ok: true, value: v };
        }
        case 'number': {
            if (!/^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(raw))
                return { ok: false, err: fail(cmd, arg.name, 'not a number') };
            const v = Number(raw);
            if (!Number.isFinite(v))
                return { ok: false, err: fail(cmd, arg.name, 'not a number') };
            return { ok: true, value: v };
        }
        case 'bool': {
            const v = raw.toLowerCase();
            if (v === 'true' || v === 'yes' || v === '1')
                return { ok: true, value: true };
            if (v === 'false' || v === 'no' || v === '0')
                return { ok: true, value: false };
            return { ok: false, err: fail(cmd, arg.name, 'not a boolean') };
        }
        case 'user': {
            const npub = raw.startsWith('nostr:') ? raw.slice(6) : raw;
            if (!NPUB_RE.test(npub))
                return { ok: false, err: fail(cmd, arg.name, 'not an npub') };
            return { ok: true, value: npub };
        }
        case 'choice': {
            const choices = arg.choices ?? [];
            if (!choices.includes(raw))
                return { ok: false, err: fail(cmd, arg.name, `not one of ${choices.join(', ')}`) };
            return { ok: true, value: raw };
        }
    }
}
/**
 * Parse message content as a command invocation against a bot's manifest.
 *
 * Returns:
 *  - ParsedInvocation when the content is a valid invocation,
 *  - InvocationError when it names a declared command but fails validation,
 *  - null when the content is ordinary chat (no leading '/', unknown
 *    command, or malformed quoting) — bots MUST ignore these silently.
 */
export function parseInvocation(content, manifest) {
    if (typeof content !== 'string' || !content.startsWith('/'))
        return null;
    const m = /^\/([A-Za-z0-9_-]{1,32})(?:\s|$)/.exec(content);
    if (!m)
        return null;
    const name = m[1].toLowerCase();
    const cmd = manifest.commands.find((c) => c.name === name);
    if (!cmd)
        return null;
    const rest = content.slice(m[0].length);
    const tokens = tokenize(rest);
    if (tokens === null)
        return null; // unterminated quote — ordinary chat, not an invocation
    const values = {};
    let ti = 0;
    for (let ai = 0; ai < cmd.args.length; ai++) {
        const arg = cmd.args[ai];
        const isLast = ai === cmd.args.length - 1;
        if (ti >= tokens.length) {
            if (arg.required)
                return fail(cmd, arg.name, 'required');
            continue; // optional absent
        }
        // Greedy tail: final declared string arg absorbs the raw remainder —
        // but only when the remainder does not start with a quote (a quoted
        // span keeps its parsed value).
        const greedy = isLast && arg.type === 'string' && !tokens[ti].rest.startsWith('"');
        const raw = greedy ? tokens[ti].rest : tokens[ti].value;
        if (byteLen(raw) > 1024)
            return fail(cmd, arg.name, 'value too long');
        const coerced = coerceArg(cmd, arg, raw);
        if (!coerced.ok)
            return coerced.err;
        values[arg.name] = coerced.value;
        ti = greedy ? tokens.length : ti + 1;
    }
    if (ti < tokens.length)
        return fail(cmd, cmd.name, 'unexpected extra input');
    return { command: cmd.name, args: values };
}
