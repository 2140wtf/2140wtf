/**
 * Live ₿AO activity — a rolling feed of what's happening in a community:
 * channel posts, member joins/leaves, and control-plane actions (roles, bans,
 * channels, metadata). Everything is already on the relay; this is a read-only
 * UI over the existing transport + control folds, merged newest-first.
 *
 * Content is shown only to members (the underlying events are sealed); the
 * relay never sees content, author, or mention targets.
 */
import { Activity, MessageSquareText, ShieldCheck, UserPlus } from "lucide-react";
import { useMemo } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useControlEvents2 } from "@/concord-v2/hooks/useControlPlane2";
import { useTransport2 } from "@/concord-v2/hooks/useTransport2";
import { openControlEditions } from "@/concord-v2/lib/control";
import { VSK_GRANT, VSK_BANLIST, VSK_CHANNEL } from "@/concord-v2/lib/kinds";
import { grantFromJSON } from "@/concord-v2/lib/roles";
import type { ChannelV2, CommunityV2 } from "@/concord-v2/lib/types";
import { useAuthor } from "@/hooks/useAuthor";
import { useScopedDisplayName } from "@/hooks/useScopedDisplayName";
import { shortTimeAgo } from "@/lib/formatTime";

interface ActivityRow {
  key: string;
  ms: number;
  kind: "post" | "join" | "admin";
  actor: string;
  text: string;
}

export function LiveActivityView({ community, channel }: { community: CommunityV2; channel: ChannelV2 | undefined }) {
  // Channel posts (decoded for members).
  const { allMessages } = useTransport2(community, channel, false, false);
  // Control-plane actions (roles, bans, channels, metadata).
  const control = useControlEvents2(community);

  const rows = useMemo<ActivityRow[]>(() => {
    const out: ActivityRow[] = [];

    for (const m of allMessages) {
      out.push({ key: `post:${m.id}`, ms: m.created_at * 1000, kind: "post", actor: m.pubkey, text: m.content });
    }

    const editions = control.data ? openControlEditions(control.data) : [];
    for (const e of editions) {
      let action = "";
      if (e.vsk === VSK_GRANT) {
        const grant = grantFromJSON(e.content);
        if (grant) action = grant.roleIds.length === 0 ? "revoked roles" : "assigned roles";
      } else if (e.vsk === VSK_BANLIST) action = "updated the ban list";
      else if (e.vsk === VSK_CHANNEL) {
        try {
          const meta = JSON.parse(e.content) as { deleted?: boolean };
          action = meta.deleted ? "deleted a channel" : "changed a channel";
        } catch {
          action = "changed a channel";
        }
      } else {
        action = "updated community settings";
      }
      out.push({ key: `ctl:${e.rumorId}`, ms: e.createdAt * 1000, kind: "admin", actor: e.author, text: action });
    }

    return out.sort((a, b) => b.ms - a.ms || a.key.localeCompare(b.key)).slice(0, 100);
  }, [allMessages, control.data]);

  return (
    <div className="mx-auto w-full max-w-2xl px-3 py-4">
      <div className="mb-3 flex items-center gap-2">
        <Activity className="size-5 text-primary" />
        <h2 className="text-lg font-semibold">Live activity</h2>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing here yet — activity will appear as members and agents post.</p>
      ) : (
        <ol className="space-y-2">
          {rows.map((row) => (
            <RowItem key={row.key} row={row} />
          ))}
        </ol>
      )}
    </div>
  );
}

function RowItem({ row }: { row: ActivityRow }) {
  const author = useAuthor(row.actor);
  const name = useScopedDisplayName(row.actor, author.data?.metadata);
  const Icon = row.kind === "post" ? MessageSquareText : row.kind === "join" ? UserPlus : ShieldCheck;
  return (
    <li className="flex items-start gap-2.5 rounded-md bg-foreground/5 px-3 py-2 text-sm">
      <Avatar className="mt-0.5 size-6 shrink-0">
        <AvatarImage src={author.data?.metadata?.picture} alt={name} />
        <AvatarFallback className="bg-primary/20 text-[10px] text-primary">{name[0]?.toUpperCase() ?? "?"}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium">{name}</span>
          <Icon className="size-3 shrink-0 text-muted-foreground" />
          {row.kind === "admin" && (
            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
              action
            </Badge>
          )}
        </div>
        <p className="mt-0.5 break-words text-muted-foreground">{row.text}</p>
      </div>
      <time className="mt-0.5 shrink-0 tabular-nums text-xs text-muted-foreground" title={new Date(row.ms).toLocaleString()}>
        {shortTimeAgo(Math.floor(row.ms / 1000))}
      </time>
    </li>
  );
}
