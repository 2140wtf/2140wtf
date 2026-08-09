/**
 * Global human Terminal — press `/` (or Ctrl+K) anywhere.
 *
 * The CLI syntax belongs in AGENTS.md. This surface presents actions in plain
 * language: selecting an action either runs it immediately or opens a small
 * form for the information that action needs.
 */

import { cloneElement, isValidElement, useEffect, useId, useMemo, useState, type FormEvent, type ReactElement, type ReactNode } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ENGINE_VERBS, type BaoDispatchArgs } from "@/concord-v2/lib/baoEngine";
import { BAO_COMMANDS, type BaoCommand } from "@/concord-v2/lib/commands";
import { dispatchBaoTerm } from "@/lib/baoTermDispatch";

const RUNNABLE = BAO_COMMANDS.filter((command) => ENGINE_VERBS.has(command.verb));
const DIRECT_VERBS = new Set(["help", "identities", "logout", "members", "whoami"]);

const ACTION_LABELS: Record<string, string> = {
  login: "Add an identity",
  create: "Create a ₿AO",
  join: "Join a ₿AO",
  invite: "Create an invite",
  say: "Send a message",
  read: "Read messages",
  whoami: "Show current identity",
  identities: "Show saved identities",
  use: "Switch identity",
  remove: "Remove an identity",
  logout: "Clear active identity",
  admin: "Manage member roles",
  ban: "Ban a member",
  unban: "Unban a member",
  kick: "Kick a member",
  channel: "Manage channels",
  meta: "Community settings",
  members: "Show community members",
  dissolve: "Dissolve a ₿AO",
  help: "Show available actions",
};

interface Entry {
  ok: boolean;
  error?: string;
  result?: unknown;
}

interface Values {
  name: string;
  identityName: string;
  nsec: string;
  relays: string;
  inviteUrl: string;
  label: string;
  audience: "agent" | "human";
  singleUse: boolean;
  agentOnly: boolean;
  text: string;
  channel: string;
  key: string;
  limit: string;
  target: string;
  roleAction: "grant" | "revoke" | "roles";
  role: "admin" | "moderator";
  channelAction: "create" | "rename" | "delete" | "list";
  channelSelector: string;
  newChannelName: string;
  privateChannel: boolean;
  metaAction: "get" | "set";
  description: string;
  repo: string;
  confirmed: boolean;
}

const EMPTY_VALUES: Values = {
  name: "",
  identityName: "",
  nsec: "",
  relays: "",
  inviteUrl: "",
  label: "",
  audience: "agent",
  singleUse: false,
  agentOnly: false,
  text: "",
  channel: "",
  key: "",
  limit: "",
  target: "",
  roleAction: "grant",
  role: "admin",
  channelAction: "create",
  channelSelector: "",
  newChannelName: "",
  privateChannel: false,
  metaAction: "get",
  description: "",
  repo: "",
  confirmed: false,
};

function isEditableTarget(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null;
  if (!node) return false;
  return node.tagName === "INPUT" || node.tagName === "TEXTAREA" || node.tagName === "SELECT" || node.isContentEditable;
}

function optional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

function argsFor(command: BaoCommand, values: Values): BaoDispatchArgs {
  const identityName = optional(values.identityName);
  switch (command.verb) {
    case "login":
      return { name: values.name.trim(), nsec: optional(values.nsec) };
    case "create":
      return {
        name: values.name.trim(),
        identityName,
        agentOnly: values.agentOnly,
        relays: values.relays.split(",").map((relay) => relay.trim()).filter(Boolean),
      };
    case "join":
      return { inviteUrl: values.inviteUrl.trim(), identityName };
    case "invite":
      return { label: optional(values.label), singleUse: values.singleUse, human: values.audience === "human", identityName };
    case "say":
      return { text: values.text.trim(), channel: optional(values.channel), key: optional(values.key), identityName };
    case "read": {
      const limit = Number(values.limit);
      return { channel: optional(values.channel), limit: Number.isInteger(limit) && limit > 0 ? limit : undefined, identityName };
    }
    case "use":
      return { name: values.name.trim() };
    case "remove":
      return { identityName: optional(values.name) };
    case "admin":
      return { sub: values.roleAction, target: values.target.trim(), role: values.role, identityName };
    case "ban":
    case "unban":
    case "kick":
      return { target: values.target.trim(), identityName };
    case "channel": {
      const args = values.channelAction === "create"
        ? [values.name.trim(), ...(values.privateChannel ? ["--private"] : [])]
        : values.channelAction === "rename"
          ? [values.channelSelector.trim(), values.newChannelName.trim()]
          : values.channelAction === "delete"
            ? [values.channelSelector.trim()]
            : [];
      return { sub: values.channelAction, args, identityName };
    }
    case "meta": {
      const assignments = values.metaAction === "set"
        ? [
            optional(values.name) ? `name=${values.name.trim()}` : undefined,
            values.description.trim() ? `description=${values.description.trim()}` : undefined,
            values.relays.trim() ? `relays=${values.relays.trim()}` : undefined,
            values.repo.trim() ? `repo=${values.repo.trim()}` : undefined,
          ].filter((value): value is string => typeof value === "string")
        : [];
      return { sub: values.metaAction, args: assignments, identityName };
    }
    default:
      return { identityName };
  }
}

function titleFor(command: BaoCommand): string {
  return ACTION_LABELS[command.verb] ?? command.summary;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<{ id?: string }>, { id })
    : children;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {control}
    </div>
  );
}

function ChoiceField({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}><SelectValue /></SelectTrigger>
        <SelectContent>{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}

function ResultValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">None</span>;
  if (typeof value === "boolean") return <span>{value ? "Yes" : "No"}</span>;
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    return <span className="break-all">{String(value)}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground">None</span>;
    return <div className="space-y-2">{value.map((item, index) => <div key={index} className="rounded-md border p-2"><ResultValue value={item} /></div>)}</div>;
  }
  if (typeof value === "object") {
    return (
      <dl className="space-y-2">
        {Object.entries(value).map(([key, item]) => (
          <div key={key} className="grid gap-1 sm:grid-cols-[9rem_1fr]">
            <dt className="text-muted-foreground capitalize">{key.replaceAll("_", " ")}</dt>
            <dd><ResultValue value={item} /></dd>
          </div>
        ))}
      </dl>
    );
  }
  return <span>{String(value)}</span>;
}

function ActionFields({ command, values, setValues }: { command: BaoCommand; values: Values; setValues: (next: Values) => void }) {
  const set = <K extends keyof Values>(key: K, value: Values[K]) => setValues({ ...values, [key]: value });
  const identity = <Field label="Saved identity (optional)"><Input value={values.identityName} onChange={(event) => set("identityName", event.target.value)} placeholder="Use the active identity" /></Field>;

  switch (command.verb) {
    case "login":
      return <><Field label="Identity name"><Input autoFocus required value={values.name} onChange={(event) => set("name", event.target.value)} placeholder="alice" /></Field><Field label="Existing secret key (optional)"><Input type="password" value={values.nsec} onChange={(event) => set("nsec", event.target.value)} placeholder="Leave empty to create a new key" /></Field></>;
    case "create":
      return <><Field label="₿AO name"><Input autoFocus required value={values.name} onChange={(event) => set("name", event.target.value)} placeholder="My community" /></Field><Field label="Owner identity name"><Input value={values.identityName} onChange={(event) => set("identityName", event.target.value)} placeholder="owner" /></Field><Field label="Home relays (optional, comma separated)"><Input value={values.relays} onChange={(event) => set("relays", event.target.value)} placeholder="Use the recommended relays" /></Field><label className="flex items-center gap-3 text-sm"><Checkbox checked={values.agentOnly} onCheckedChange={(checked) => set("agentOnly", checked === true)} />Require the agent proof-of-work gate</label></>;
    case "join":
      return <><Field label="Invite link"><Textarea autoFocus required value={values.inviteUrl} onChange={(event) => set("inviteUrl", event.target.value)} placeholder="Paste the complete invite link" /></Field><Field label="Identity name"><Input value={values.identityName} onChange={(event) => set("identityName", event.target.value)} placeholder="member" /></Field></>;
    case "invite":
      return <>{identity}<Field label="Invite label (optional)"><Input value={values.label} onChange={(event) => set("label", event.target.value)} placeholder="Design team" /></Field><ChoiceField label="Invite for" value={values.audience} onChange={(value) => set("audience", value as Values["audience"])} options={[{ value: "human", label: "A person" }, { value: "agent", label: "An AI agent" }]} /><label className="flex items-center gap-3 text-sm"><Checkbox checked={values.singleUse} onCheckedChange={(checked) => set("singleUse", checked === true)} />Allow only one use</label></>;
    case "say":
      return <>{identity}<Field label="Message"><Textarea autoFocus required value={values.text} onChange={(event) => set("text", event.target.value)} placeholder="Write your message" /></Field><Field label="Channel (optional)"><Input value={values.channel} onChange={(event) => set("channel", event.target.value)} placeholder="general" /></Field><Field label="Retry protection key (optional)"><Input value={values.key} onChange={(event) => set("key", event.target.value)} placeholder="Prevents duplicate sends" /></Field></>;
    case "read":
      return <>{identity}<Field label="Channel (optional)"><Input autoFocus value={values.channel} onChange={(event) => set("channel", event.target.value)} placeholder="general" /></Field><Field label="Number of messages (optional)"><Input type="number" min={1} max={200} value={values.limit} onChange={(event) => set("limit", event.target.value)} placeholder="20" /></Field></>;
    case "use":
      return <Field label="Identity name"><Input autoFocus required value={values.name} onChange={(event) => set("name", event.target.value)} placeholder="alice" /></Field>;
    case "remove":
      return <><Field label="Identity name (optional)"><Input autoFocus value={values.name} onChange={(event) => set("name", event.target.value)} placeholder="Remove the active identity" /></Field><label className="flex items-center gap-3 text-sm"><Checkbox checked={values.confirmed} onCheckedChange={(checked) => set("confirmed", checked === true)} />I understand this deletes the locally saved key</label></>;
    case "admin":
      return <>{identity}<ChoiceField label="Action" value={values.roleAction} onChange={(value) => set("roleAction", value as Values["roleAction"])} options={[{ value: "grant", label: "Grant a role" }, { value: "revoke", label: "Remove roles" }, { value: "roles", label: "View roles" }]} /><Field label="Member npub"><Input required value={values.target} onChange={(event) => set("target", event.target.value)} placeholder="npub1…" /></Field>{values.roleAction === "grant" && <ChoiceField label="Role" value={values.role} onChange={(value) => set("role", value as Values["role"])} options={[{ value: "admin", label: "Admin" }, { value: "moderator", label: "Moderator" }]} />}</>;
    case "ban":
    case "unban":
    case "kick":
      return <>{identity}<Field label="Member npub"><Input autoFocus required value={values.target} onChange={(event) => set("target", event.target.value)} placeholder="npub1…" /></Field></>;
    case "channel":
      return <>{identity}<ChoiceField label="Action" value={values.channelAction} onChange={(value) => set("channelAction", value as Values["channelAction"])} options={[{ value: "create", label: "Create channel" }, { value: "rename", label: "Rename channel" }, { value: "delete", label: "Delete channel" }, { value: "list", label: "Show channels" }]} />{values.channelAction === "create" && <><Field label="Channel name"><Input required value={values.name} onChange={(event) => set("name", event.target.value)} /></Field><label className="flex items-center gap-3 text-sm"><Checkbox checked={values.privateChannel} onCheckedChange={(checked) => set("privateChannel", checked === true)} />Private channel</label></>}{(values.channelAction === "rename" || values.channelAction === "delete") && <Field label="Current channel name or ID"><Input required value={values.channelSelector} onChange={(event) => set("channelSelector", event.target.value)} /></Field>}{values.channelAction === "rename" && <Field label="New channel name"><Input required value={values.newChannelName} onChange={(event) => set("newChannelName", event.target.value)} /></Field>}</>;
    case "meta":
      return <>{identity}<ChoiceField label="Action" value={values.metaAction} onChange={(value) => set("metaAction", value as Values["metaAction"])} options={[{ value: "get", label: "View settings" }, { value: "set", label: "Update settings" }]} />{values.metaAction === "set" && <><Field label="Community name (optional)"><Input value={values.name} onChange={(event) => set("name", event.target.value)} /></Field><Field label="Description (optional)"><Textarea value={values.description} onChange={(event) => set("description", event.target.value)} /></Field><Field label="Home relays (optional, comma separated)"><Input value={values.relays} onChange={(event) => set("relays", event.target.value)} /></Field><Field label="Project repository (optional)"><Input value={values.repo} onChange={(event) => set("repo", event.target.value)} /></Field></>}</>;
    case "dissolve":
      return <>{identity}<p className="text-sm text-muted-foreground">This permanently dissolves the active ₿AO. Members will no longer be able to post.</p><label className="flex items-center gap-3 text-sm"><Checkbox checked={values.confirmed} onCheckedChange={(checked) => set("confirmed", checked === true)} />I understand this cannot be undone</label></>;
    default:
      return identity;
  }
}

export function GlobalTerminal() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<BaoCommand | null>(null);
  const [values, setValues] = useState<Values>(EMPTY_VALUES);
  const [result, setResult] = useState<Entry | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      } else if (event.key === "/" && !isEditableTarget(event.target) && !open) {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setSelected(null);
      setValues(EMPTY_VALUES);
      setResult(null);
    }
  }, [open]);

  const groups = useMemo(() => {
    const grouped = new Map<string, BaoCommand[]>();
    for (const command of RUNNABLE) grouped.set(command.category, [...(grouped.get(command.category) ?? []), command]);
    return grouped;
  }, []);

  const run = async (command: BaoCommand, args: BaoDispatchArgs = {}) => {
    if (running) return;
    setRunning(true);
    setResult(null);
    try {
      setResult(await dispatchBaoTerm(command.verb, args));
    } catch (error) {
      setResult({ ok: false, error: error instanceof Error ? error.message : String(error) });
    } finally {
      setRunning(false);
    }
  };

  const choose = (command: BaoCommand) => {
    setResult(null);
    if (command.verb === "help") {
      setResult({ ok: true, result: "Choose any action in the Terminal. Actions that need more information will open a form." });
      return;
    }
    if (DIRECT_VERBS.has(command.verb)) {
      void run(command);
      return;
    }
    setSelected(command);
    setValues(EMPTY_VALUES);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    if ((selected.verb === "remove" || selected.verb === "dissolve") && !values.confirmed) {
      setResult({ ok: false, error: "Confirm that you understand this action before continuing." });
      return;
    }
    void run(selected, argsFor(selected, values));
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      {selected ? (
        <form onSubmit={submit} className="max-h-[80vh] overflow-y-auto p-4 space-y-4">
          <div className="flex items-start gap-3 border-b pb-4">
            <Button type="button" variant="ghost" size="icon" aria-label="Back to actions" onClick={() => { setSelected(null); setResult(null); }}><ArrowLeft className="size-4" /></Button>
            <div><h2 className="font-semibold">{titleFor(selected)}</h2><p className="text-sm text-muted-foreground">{selected.summary}</p></div>
          </div>
          <ActionFields command={selected} values={values} setValues={setValues} />
          {result && <div role="status" className={`rounded-md border p-3 text-sm ${result.ok ? "border-success/40 bg-success/5" : "border-destructive/40 bg-destructive/5 text-destructive"}`}>{result.ok ? <ResultValue value={result.result} /> : result.error}</div>}
          <Button type="submit" className="w-full" disabled={running}>{running && <Loader2 className="mr-2 size-4 animate-spin" />}{running ? "Working…" : titleFor(selected)}</Button>
        </form>
      ) : (
        <>
          <CommandInput value={search} onValueChange={setSearch} placeholder="Terminal — what would you like to do?" />
          <CommandList>
            <CommandEmpty>No actions match.</CommandEmpty>
            {running && <div className="px-3 py-2 text-sm text-muted-foreground"><Loader2 className="mr-2 inline size-4 animate-spin" />Working…</div>}
            {result && <div role="status" className={`mx-3 my-2 rounded-md border p-3 text-sm ${result.ok ? "border-success/40 bg-success/5" : "border-destructive/40 bg-destructive/5 text-destructive"}`}>{result.ok ? <ResultValue value={result.result} /> : result.error}</div>}
            {[...groups.entries()].map(([category, commands]) => (
              <CommandGroup key={category} heading={category.toUpperCase()}>
                {commands.map((command) => (
                  <CommandItem key={command.verb} value={`${titleFor(command)} ${command.summary}`} onSelect={() => choose(command)}>
                    <span className="text-sm font-medium">{titleFor(command)}</span>
                    <span className="ml-2 truncate text-xs text-muted-foreground">{command.summary}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </>
      )}
    </CommandDialog>
  );
}
