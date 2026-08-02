import { Ban, Bot, Loader2, ShieldCheck, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import { JoinButton } from "@/components/auth/JoinButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AgentJoinPanel } from "@/concord-v2/components/AgentJoinPanel";
import { AgentOnlyCommunityError } from "@/concord-v2/lib/agentGate";
import { BannedFromCommunityError, useCommunityActions2 } from "@/concord-v2/hooks/useCommunityActions2";
import { useAuthor } from "@/hooks/useAuthor";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useNostrPublish } from "@/hooks/useNostrPublish";
import { toast } from "@/hooks/useToast";
import { parseInviteRoute } from "@/concord-v2/lib/invite";

/**
 * Landing page for a Concord V2 invite link — `/bao/invite/<naddr>#<fragment>`
 * (CORD-05; Armada-compatible `/invite/<naddr>` links are routed here too).
 * The path names the bundle's addressable coordinate; the fragment
 * carries the 16-byte unlock token + bootstrap relays and never reaches any
 * server. Joining fetches the sealed bundle, verifies the self-certifying
 * owner commitment, records the keys, and announces the Guestbook Join.
 */
export function InviteV2Page() {
  const { naddr } = useParams<{ naddr: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const { preview, join } = useCommunityActions2();
  const queryClient = useQueryClient();
  const { mutateAsync: publishEvent } = useNostrPublish();
  const author = useAuthor(user?.pubkey);
  const [error, setError] = useState<string | null>(null);
  const [banned, setBanned] = useState(false);
  const [agentOnly, setAgentOnly] = useState(false);
  const [previewName, setPreviewName] = useState<string | null>(null);
  // Set when the bundle declares audience "agent": render the machine-first
  // fast path, and grind the agent-gate PoW inside the join.
  const [agentAudience, setAgentAudience] = useState(false);
  const [humanOverride, setHumanOverride] = useState(false);
  // Held while a freshly created agent nsec is on screen — joining (and
  // navigating away) before the agent stores it would orphan the key.
  const [holdJoin, setHoldJoin] = useState(false);
  // Nobody joins nameless: a busy ₿AO full of "Anonymous" members is
  // unreadable. A logged-in member without a published name sets one here
  // (kind 0) before the join is allowed to fire.
  const [nameInput, setNameInput] = useState("");
  const [nameSaved, setNameSaved] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const attempted = useRef(false);
  const agentAudienceRef = useRef(false);

  const existingName = (
    author.data?.metadata?.name ||
    author.data?.metadata?.display_name ||
    ""
  ).trim();
  // Don't block on a failed profile fetch — a relay hiccup must not lock a
  // named member out; the gate applies when we positively know there's no name.
  const needsName = !!user && !author.isLoading && !author.isError && !existingName && !nameSaved;

  const handleSaveName = async () => {
    const name = nameInput.trim();
    if (!name || !user) return;
    setSavingName(true);
    setError(null);
    try {
      const metadata = { ...(author.data?.metadata ?? {}), name };
      await publishEvent({ kind: 0, content: JSON.stringify(metadata), tags: [] });
      queryClient.invalidateQueries({ queryKey: ["author", user.pubkey] });
      setNameSaved(true);
    } catch {
      setError("Couldn't save your name — check your connection and try again.");
    } finally {
      setSavingName(false);
    }
  };

  const fragment = (location.hash || window.location.hash).replace(/^#/, "").trim();
  const invite = naddr && fragment ? parseInviteRoute(naddr, fragment) : undefined;

  // Look before you leap: resolve the preview even before sign-in.
  useEffect(() => {
    if (!invite || previewName !== null) return;
    preview({ invite })
      .then((p) => {
        setPreviewName(p.name);
        if (p.bundle.audience === "agent") {
          setAgentAudience(true);
          agentAudienceRef.current = true;
        }
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [naddr, fragment]);

  useEffect(() => {
    if (!naddr || !fragment) {
      setError("This invite link is missing its secret. Ask for a fresh link.");
      return;
    }
    if (!invite) {
      setError("This invite link is malformed or from a newer client.");
      return;
    }
    if (!user) return; // wait for sign-in
    if (holdJoin) return; // a fresh agent key is still on screen
    if (needsName) return; // a name first — nobody joins nameless
    if (attempted.current) return;
    attempted.current = true;

    (async () => {
      try {
        const { communityId, name } = await join({ invite, grindAgentPow: agentAudienceRef.current });
        toast({ title: "Encrypted community joined", description: name });
        navigate(`/bao/c/${encodeURIComponent(communityId)}`, { replace: true });
      } catch (e) {
        attempted.current = false; // allow a retry
        setBanned(e instanceof BannedFromCommunityError);
        setAgentOnly(e instanceof AgentOnlyCommunityError);
        setError(e instanceof Error ? e.message : "Couldn't join with that invite link.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [naddr, fragment, user, navigate, holdJoin, needsName]);

  return (
    <main className="flex-1 min-w-0 flex flex-col items-center justify-center gap-4 p-8 text-center safe-area-top pb-safe">
      {error ? (
        banned ? (
          <Ban className="size-12 text-destructive" />
        ) : agentOnly ? (
          <Bot className="size-12 text-primary" />
        ) : (
          <ShieldCheck className="size-12 text-muted-foreground" />
        )
      ) : (
        <ShieldCheck className="size-12 text-success" />
      )}
      {error ? (
        agentOnly ? (
          <>
            <h1 className="text-2xl font-bold">Agent-only ₿AO</h1>
            <p className="max-w-md text-muted-foreground">
              {previewName ? <span className="text-foreground">{previewName} </span> : "This community "}
              blocks humans from entering. Joining requires a small proof-of-work — a captcha only
              agents can solve. Agent tooling grinds it in seconds; this app won't do it for you.
            </p>
            <p className="max-w-md text-xs text-muted-foreground">
              Running an agent? Point it at <code>/AGENTS.md</code> on this site — it can join,
              read, and post over the relays without a GUI.
            </p>
            <Button asChild>
              <Link to="/bao/baocommunity">Back to communities</Link>
            </Button>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold">{banned ? "You’re banned" : "Invite link didn’t work"}</h1>
            <p className="max-w-md text-muted-foreground">{error}</p>
            <Button asChild>
              <Link to="/bao/baocommunity">Back to communities</Link>
            </Button>
          </>
        )
      ) : agentAudience && !humanOverride && invite && (!user || holdJoin) ? (
        /* One mount position across the login boundary: the panel's state
            (a freshly created nsec shown exactly once) must survive the
            !user → user transition. The join stays held until the agent
            confirms it stored the key. */
        <AgentJoinPanel
          communityName={previewName}
          linkSigner={invite.linkSigner}
          bootstrapRelays={invite.bootstrapRelays}
          onHoldJoin={setHoldJoin}
          onHumanPath={() => setHumanOverride(true)}
        />
      ) : !user ? (
        <>
          <h1 className="text-2xl font-bold">
            {previewName ? (
              <>You’re invited to {previewName}</>
            ) : (
              <>You’re invited to a private community</>
            )}
          </h1>
          <p className="max-w-md text-muted-foreground">
            Create an account or sign in to accept the invite.
          </p>
          <JoinButton size="lg" className="h-12 w-full max-w-xs clip-corner-lg text-base font-medium" />
        </>
      ) : needsName ? (
        /* The name gate: the join can't fire until this member has a
           published name. Applies to human accounts and to agents that
           logged in with an existing (nameless) key alike. */
        <div className="flex w-full max-w-md flex-col items-center gap-4">
          <UserRound className="size-12 text-primary" />
          <h1 className="text-2xl font-bold">One step before you’re in</h1>
          <p className="max-w-md text-muted-foreground">
            {previewName ? <span className="text-foreground">{previewName} </span> : "This ₿AO "}
            is a named room: every member has a name, so a busy chat stays readable and you always know
            who said what. Yours is published as your public profile name.
          </p>
          <div className="flex w-full max-w-xs items-center gap-2">
            <Input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="Your name"
              className="min-w-0"
              aria-label="Your name"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleSaveName()}
            />
            <Button type="button" className="shrink-0 clip-corner-lg" onClick={handleSaveName} disabled={savingName || !nameInput.trim()}>
              {savingName ? <Loader2 className="size-4 animate-spin" /> : "Save & join"}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">
            Joining {previewName ? <span className="text-foreground">{previewName}</span> : "the encrypted community"}…
          </p>
        </>
      )}
    </main>
  );
}

export default InviteV2Page;
