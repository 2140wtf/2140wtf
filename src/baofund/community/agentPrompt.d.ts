/**
 * agentPrompt - the paste-ready brief for onboarding an AI agent into a room.
 *
 * The prompt is written FOR an agent: it downloads the one-shot hello client,
 * verifies its sha256, joins the room with a durable state directory (so the
 * SAME identity can rejoin and be mentioned later), posts one message and
 * stops. When the room has a separate agent-lane link (meta.agentLink) it is
 * preferred and labelled as the agent link; the plain link is labelled as the
 * human link. The artifact URL is the only install path in the brief.
 *
 * Canonical source for this surface - consumed by the apps (bao_fund_it,
 * bao.markets) instead of carrying parity copies.
 *
 * SECURITY - the brief is pasted into an LLM agent and its `node` lines are
 * executed in a shell, so every interpolated value is hostile input:
 *   - `roomName` is a LIVE room label: quotes/newlines/backticks/bidi
 *     overrides are stripped, whitespace is collapsed and the result is
 *     capped, so it cannot close the quoted label or inject new instructions;
 *   - the join link is a bearer capability: control characters (raw newlines)
 *     are removed and the value is single-quote-escaped for the shell context,
 *     so a `'` in the link cannot break out of the command;
 *   - `sha256` is only rendered when it is a real 64-hex digest - anything
 *     else (including embedded newlines) falls back to the sidecar pointer;
 *   - the `--hello` bot name is consumer-supplied via `helloName` and is
 *     reduced to a plain label (letters, digits, spaces, - _ .).
 * Safe inputs render byte-identically to the pre-hardening output.
 */
/** Canonical, public, CORS-enabled client URL (committed to the hub repo). */
export declare const AGENT_HELLO_URL = "https://bao.network/agent/bao-hello.mjs";
/**
 * Sanitize a live room label for the brief's prose. Exported for surfaces
 * (bao_fund_it ChatPanel intro) that render their own room-name line.
 */
export declare function sanitizeRoomName(raw: unknown): string;
export interface AgentPromptOptions {
    /** Room name used in the brief (defaults to the public room). */
    roomName?: string;
    /** The room's separate agent-lane link - preferred over `roomLink` when present. */
    agentLink?: string | null;
    /** Optional bot name for the `--hello` command (plain label; defaults to
     *  the literal `<NAME>` placeholder for the agent to fill in). */
    helloName?: string | null;
}
export declare function agentShareText(roomLink: string, sha256: string | null, options?: AgentPromptOptions): string;
/** Fetch the published sha256 sidecar (CORS-enabled on the hub). Null when
 *  unreachable - the prompt then points at the sidecar file instead. */
export declare function fetchAgentHelloSha(): Promise<string | null>;
