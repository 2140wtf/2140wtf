import { Ban, Loader2, ShieldOff } from "lucide-react";
import { useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useModeration2 } from "@/concord-v2/hooks/useModeration2";
import type { CommunityV2 } from "@/concord-v2/lib/types";
import { useAuthor } from "@/hooks/useAuthor";
import { useScopedDisplayName } from "@/hooks/useScopedDisplayName";
import { toast } from "@/hooks/useToast";

/**
 * The community's banlist as a management surface — CORD-04 §4.
 *
 * This is the ONLY unban surface: the roster fold subtracts banned members,
 * so they have no member-list row to act on. Rendered as a full-column view
 * (community menu), sibling to the audit log and invite links.
 */
export function BannedView({ community }: { community: CommunityV2 }) {
  const { banned, unban, canBan } = useModeration2(community, []);
  const [pending, setPending] = useState<string | null>(null);

  const handleUnban = async (pubkey: string) => {
    setPending(pubkey);
    try {
      await unban({ target: pubkey });
      toast({ title: "Member unbanned", description: "They can take part in the community again." });
    } catch (e) {
      toast({
        title: "Couldn't unban",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setPending(null);
    }
  };

  const list = [...banned].sort();

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
      <p className="text-sm text-muted-foreground">
        Banned members are silenced and hidden for everyone in this community. Unbanning lets
        them take part again.
      </p>
      {list.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md bg-foreground/5 px-4 py-8 text-sm text-muted-foreground">
          <Ban className="size-5" />
          Nobody is banned.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {list.map((pubkey) => (
            <BannedRow
              key={pubkey}
              pubkey={pubkey}
              canUnban={canBan(pubkey)}
              busy={pending === pubkey}
              onUnban={() => handleUnban(pubkey)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function BannedRow({
  pubkey,
  canUnban,
  busy,
  onUnban,
}: {
  pubkey: string;
  canUnban: boolean;
  busy: boolean;
  onUnban: () => void;
}) {
  const author = useAuthor(pubkey);
  const name = useScopedDisplayName(pubkey, author.data?.metadata);
  return (
    <li className="flex items-center gap-2.5 rounded-md bg-foreground/5 px-3 py-2 text-sm">
      <Avatar className="size-6 shrink-0">
        <AvatarImage src={author.data?.metadata?.picture} alt={name} />
        <AvatarFallback className="bg-destructive/20 text-[10px] text-destructive">
          {name[0]?.toUpperCase() ?? "?"}
        </AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
      {canUnban && (
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onUnban}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldOff className="size-3.5" />}
          Unban
        </Button>
      )}
    </li>
  );
}
