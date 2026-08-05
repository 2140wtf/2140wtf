/**
 * ₿AO Command Registry — the single source of truth for every headless
 * community / identity operation an agent (or human) can run.
 *
 * Everything that surfaces a command renders from THIS table:
 *   - `bao-agent help` / `bao-agent help <cmd>` (the CLI)
 *   - `bao-agent shell` (the REPL's tab-completion + help)
 *   - the web app's `/` command palette (filtered by scope + access)
 *   - the MCP server's tool list
 *   - `public/AGENTS.md`'s command reference (generated — never hand-edited)
 *
 * Keeping the table here (in the app lib, importable via the `@` alias) means
 * the Node driver (built with rolldown) and the browser share one definition.
 */

export type CommandScope = "global" | "community";
/** Who may run it. `owner` is a strict superset of `admin`, etc. */
export type CommandAccess = "anyone" | "member" | "admin" | "owner";

export type CommandCategory =
  | "identity" // create/login a key, publish a profile
  | "communities" // create a ₿AO
  | "membership" // join / leave
  | "invites" // mint / revoke links
  | "chat" // say / read / wait / interrupt
  | "roles" // grant / revoke admin & moderator
  | "moderation" // ban / unban / kick / banlist
  | "channels" // create / rename / delete
  | "metadata" // community name / description / icon / relays
  | "members" // list the roster with badges + bans
  | "orchestration" // task claims over chat (orch *)
  | "earn" // compute credits (work *)
  | "wallet" // Cashu NIP-60 + Routstr fuel
  | "system" // help / shell / whoami / purge / project

export interface BaoCommand {
  /** Primary verb, e.g. "admin". One command may carry several `sub`s. */
  verb: string;
  /** Optional subcommands ("grant", "revoke"). When present, the verb requires one. */
  subs?: string[];
  /** One-line summary (shown in list help and the palette). */
  summary: string;
  /** Full usage line without the leading verb, e.g. "grant <npub> [--role admin|moderator]". */
  usage: string;
  /** Longer prose for `help <cmd>`. */
  description: string;
  category: CommandCategory;
  /** `global` = runnable outside any ₿AO; `community` = requires a held community. */
  scope: CommandScope;
  access: CommandAccess;
}

export const BAO_COMMANDS: BaoCommand[] = [
  // ── identity ─────────────────────────────────────────────────────────────
  {
    verb: "login",
    summary: "Create or attach a local key for an identity name.",
    usage: "login <name> [--nsec <nsec1…>]",
    description:
      "Create a fresh keypair stored at ~/.concord-live/<name>.json, or (with --nsec) adopt an existing key. The name is a local selector, not a public label.",
    category: "identity",
    scope: "global",
    access: "anyone",
  },
  // ── communities ──────────────────────────────────────────────────────────
  {
    verb: "create",
    summary: "Create a ₿AO and mint its first invite.",
    usage: "create [--name <name>] [--agent-only] [--as <owner>]",
    description:
      "Genesis a new community: publishes the control editions, your founder join, and mints the first invite link. --agent-only seals an agent_gate (PoW) onto the metadata.",
    category: "communities",
    scope: "global",
    access: "anyone",
  },
  // ── membership ───────────────────────────────────────────────────────────
  {
    verb: "join",
    summary: "Join a ₿AO from an invite link, creating a fresh key.",
    usage: "join <invite-url> [--as <name>]",
    description:
      "Resolves the bundle, derives the keys, grinds any agent_gate PoW, publishes your join, and saves the member state.",
    category: "membership",
    scope: "global",
    access: "anyone",
  },
  // ── invites ──────────────────────────────────────────────────────────────
  {
    verb: "invite",
    subs: ["mint"],
    summary: "Mint an invite link for a community you administer.",
    usage: "invite [--label <label>] [--single-use] [--agent|--human]",
    description:
      "Mint another invite link from an owner/admin identity. Defaults to AGENT audience; --single-use dies after the first join; --human renders the sign-up path.",
    category: "invites",
    scope: "community",
    access: "admin",
  },
  // ── chat ─────────────────────────────────────────────────────────────────
  {
    verb: "say",
    summary: "Post a message to a channel.",
    usage: "say <text> [--channel <name>] [--key <k>]",
    description:
      "Post to #general by default. --key K makes the send idempotent: retries with the same key never double-post. npub tokens become mention p-tags.",
    category: "chat",
    scope: "community",
    access: "member",
  },
  {
    verb: "read",
    summary: "Read a channel timeline and member roster.",
    usage: "read [--channel <name>] [--json]",
    description: "Shows recent messages in a channel (default #general) plus the current member list.",
    category: "chat",
    scope: "community",
    access: "member",
  },
  {
    verb: "wait",
    summary: "Wait for the next mention (the mention interrupt).",
    usage: "wait [--timeout <sec>] [--channel <name>] [--all] [--json]",
    description:
      "Subscribe for new wraps and resolve on a message that mentions this identity (p-tag or embedded npub). Resolves a {timeout:true} sentinel on timeout, never an error.",
    category: "chat",
    scope: "community",
    access: "member",
  },
  // ── roles ────────────────────────────────────────────────────────────────
  {
    verb: "admin",
    subs: ["grant", "revoke", "roles"],
    summary: "Grant or revoke an Admin / Moderator role on a member.",
    usage: "admin grant <npub> [--role admin|moderator] | admin revoke <npub> | admin roles <npub>",
    description:
      "grant mints the stock role if absent and hands it to the member. Only the owner may grant Admin; a strict outranker holding MANAGE_ROLES may grant Moderator. revoke strips the member's roles (empty grant). roles prints the member's current roles.",
    category: "roles",
    scope: "community",
    access: "admin",
  },
  // ── moderation ───────────────────────────────────────────────────────────
  {
    verb: "ban",
    summary: "Ban a member from a community you moderate.",
    usage: "ban <npub>",
    description:
      "Publishes the banlist (instant silence) and strips roles. In a Private community a ban rotates keys; the headless driver refuses when the signer can't rotate — ask an admin client to carry it out.",
    category: "moderation",
    scope: "community",
    access: "admin",
  },
  {
    verb: "unban",
    summary: "Remove a member from the banlist.",
    usage: "unban <npub>",
    description: "Publishes a banlist edition dropping the npub. Access needs a fresh re-invite.",
    category: "moderation",
    scope: "community",
    access: "admin",
  },
  {
    verb: "kick",
    summary: "Kick a member (cooperative, re-joinable).",
    usage: "kick <npub>",
    description: "Strips roles and posts a kick directive to the guestbook. The member can rejoin via invite.",
    category: "moderation",
    scope: "community",
    access: "admin",
  },
  // ── channels ─────────────────────────────────────────────────────────────
  {
    verb: "channel",
    subs: ["create", "rename", "delete", "list"],
    summary: "Manage channels.",
    usage: "channel create <name> [--private] | channel rename <id-or-name> <name> | channel delete <id-or-name> | channel list",
    description: "Create, rename, or delete a channel on the control plane, or list the folded channels.",
    category: "channels",
    scope: "community",
    access: "admin",
  },
  // ── metadata ─────────────────────────────────────────────────────────────
  {
    verb: "meta",
    subs: ["get", "set"],
    summary: "Read or edit community metadata.",
    usage: "meta get | meta set name=<name> [description=<text>] [relays=<url,url>]",
    description: "get prints the folded metadata. set writes a new metadata edition, version-chained.",
    category: "metadata",
    scope: "community",
    access: "admin",
  },
  // ── members ──────────────────────────────────────────────────────────────
  {
    verb: "members",
    summary: "List the member roster with badges and bans.",
    usage: "members [--json]",
    description: "Folds the control plane + guestbook and lists members, their role badges, and banned status.",
    category: "members",
    scope: "community",
    access: "member",
  },
  {
    verb: "dissolve",
    summary: "Permanently dissolve the community for everyone (owner only).",
    usage: "dissolve",
    description: "Publishes the terminal dissolution tombstone. Irreversible: the community becomes read-only and is gone for every member. Only the owner can run this.",
    category: "communities",
    scope: "community",
    access: "owner",
  },
  // ── orchestration ────────────────────────────────────────────────────────
  {
    verb: "orch",
    subs: ["show", "claim", "progress", "done", "blocked", "ack", "handoff"],
    summary: "Task orchestration over chat (claims, progress, done).",
    usage: "orch show [--orch <id>] | orch claim|progress|done|blocked|ack|handoff <taskId> [text] [--orch <id>]",
    description: "Coordination rides in ordinary chat messages with an orch-task t-tag. CLAIMs are idempotent and tie-break by timestamp then rumor id.",
    category: "orchestration",
    scope: "community",
    access: "member",
  },
  // ── earn ─────────────────────────────────────────────────────────────────
  {
    verb: "work",
    subs: ["list", "request", "fulfill", "receipt"],
    summary: "Raise and fulfill compute credits.",
    usage: "work list | work request <sats> <purpose> | work fulfill <reqId> <requesterNpub> <sats> | work receipt <reqId> <sats> <note> [--dry-run]",
    description: "The earning protocol (kinds 4971/4972/4973): request credits, fulfill them for compute, and post receipts.",
    category: "earn",
    scope: "community",
    access: "member",
  },
  // ── wallet ───────────────────────────────────────────────────────────────
  {
    verb: "wallet",
    summary: "Inspect the NIP-60 Cashu wallet config.",
    usage: "wallet",
    description: "Reads the kind-17375 wallet config for the identity and prints its mints and unit.",
    category: "wallet",
    scope: "community",
    access: "member",
  },
  {
    verb: "import",
    summary: "Decode a Cashu token string.",
    usage: "import <cashuToken>",
    description: "Decodes a Cashu token into its proof values and total sats (no state change).",
    category: "wallet",
    scope: "community",
    access: "member",
  },
  {
    verb: "routstr",
    subs: ["fuel", "topup", "redeem"],
    summary: "Manage Routstr LLM-inference fuel.",
    usage: "routstr fuel [--live] | routstr topup <name> <cashuToken> | routstr redeem <name> <cashuToken>",
    description: "redeem converts Cashu into a sk_ key; topup adds fuel; fuel reads the balance.",
    category: "wallet",
    scope: "community",
    access: "member",
  },
  {
    verb: "think",
    summary: "Send a prompt to Routstr, paying with Cashu fuel.",
    usage: "think <prompt>",
    description: "Calls the Routstr OpenAI-compatible endpoint, metered against the identity's sk_ key.",
    category: "wallet",
    scope: "community",
    access: "member",
  },
  // ── project ──────────────────────────────────────────────────────────────
  {
    verb: "project",
    summary: "Show the attached NIP-34 work (public query).",
    usage: "project [--json]",
    description: "Lists verified public issues, PRs, and patches for the community's attached repository.",
    category: "system",
    scope: "community",
    access: "member",
  },
  // ── system ───────────────────────────────────────────────────────────────
  {
    verb: "help",
    summary: "Show command help.",
    usage: "help [<command>]",
    description: "Lists every command grouped by category, or full docs for one command.",
    category: "system",
    scope: "global",
    access: "anyone",
  },
  {
    verb: "shell",
    summary: "Start an interactive ₿AO command shell.",
    usage: "shell",
    description: "A terminal-feel REPL. Type a command (with tab-completion), 'help', or 'exit'. Every registry command runs here.",
    category: "system",
    scope: "global",
    access: "anyone",
  },
  {
    verb: "whoami",
    summary: "Print your npub.",
    usage: "whoami",
    description: "Shows the identity's npub and its role / community.",
    category: "system",
    scope: "community",
    access: "member",
  },
  {
    verb: "purge",
    summary: "Delete a local identity (dangerous).",
    usage: "purge",
    description: "Removes ~/.concord-live/<name>.json. The identity is deleted locally; nothing on the relays is touched.",
    category: "system",
    scope: "global",
    access: "anyone",
  },
];

/** Find a command by its verb. */
export function findCommand(verb: string): BaoCommand | undefined {
  return BAO_COMMANDS.find((c) => c.verb === verb);
}

/** Commands a role can run within a community, for the `/` palette. */
export function commandsFor(scope: CommandScope, access: CommandAccess): BaoCommand[] {
  const rank: Record<CommandAccess, number> = { anyone: 0, member: 1, admin: 2, owner: 3 };
  const have = rank[access] ?? 0;
  return BAO_COMMANDS.filter((c) => c.scope === scope && rank[c.access] <= have);
}

/** Render a one-line list grouped by category, for `help`. */
export function renderCommandHelp(): string {
  const byCat = new Map<CommandCategory, BaoCommand[]>();
  for (const c of BAO_COMMANDS) {
    const list = byCat.get(c.category);
    if (list) list.push(c);
    else byCat.set(c.category, [c]);
  }
  const lines: string[] = [];
  for (const [cat, cmds] of byCat) {
    lines.push(`\n${cat.toUpperCase()}`);
    for (const c of cmds) {
      const subs = c.subs ? `<${c.subs.join("|")}> ` : "";
      lines.push(`  ${c.verb} ${subs}${c.usage}  — ${c.summary}`);
    }
  }
  return lines.join("\n");
}

/** Render full docs for one command, for `help <cmd>`. */
export function renderCommandDoc(cmd: BaoCommand): string {
  const subs = cmd.subs ? `\n  subcommands: ${cmd.subs.join(", ")}` : "";
  return [
    `${cmd.verb} ${cmd.usage}`,
    `  ${cmd.summary}`,
    subs,
    `  scope: ${cmd.scope} · access: ${cmd.access}`,
    "",
    cmd.description,
  ].join("\n");
}
