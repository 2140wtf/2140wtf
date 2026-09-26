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
export type BotArgType = 'string' | 'int' | 'number' | 'bool' | 'user' | 'choice';
export interface BotCommandArg {
    name: string;
    type: BotArgType;
    description: string;
    required: boolean;
    choices?: string[];
}
export interface BotCommand {
    name: string;
    description: string;
    args: BotCommandArg[];
}
export interface BotManifest {
    v: 1;
    commands: BotCommand[];
}
/**
 * Build a bot-manifest room payload (encrypted in-envelope). Throws on an
 * invalid manifest — bots MUST NOT publish invalid manifests.
 */
export declare function buildBotManifest(commands: BotCommand[]): Record<string, unknown>;
/**
 * Parse and validate a bot-manifest payload. Returns null when the payload
 * carries no manifest or the manifest fails validation — a manifest that
 * fails validation has no usable interface and MUST be ignored.
 */
export declare function parseBotManifest(payload: unknown): BotManifest | null;
export interface ParsedInvocation {
    /** The command name (lowercase). */
    command: string;
    /** Typed argument values by arg name. */
    args: Record<string, string | number | boolean>;
}
export interface InvocationError {
    /** Canonical, client-parseable: "<arg>: <reason>\nusage: <usage-line>". */
    error: string;
    command: string;
}
/** The canonical usage line for a command: /name <req:type> [opt:type]. */
export declare function usageLine(cmd: BotCommand): string;
/**
 * Parse message content as a command invocation against a bot's manifest.
 *
 * Returns:
 *  - ParsedInvocation when the content is a valid invocation,
 *  - InvocationError when it names a declared command but fails validation,
 *  - null when the content is ordinary chat (no leading '/', unknown
 *    command, or malformed quoting) — bots MUST ignore these silently.
 */
export declare function parseInvocation(content: string, manifest: BotManifest): ParsedInvocation | InvocationError | null;
