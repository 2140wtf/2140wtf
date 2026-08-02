import { AlertCircle, GitCommitHorizontal, GitPullRequest, HandCoins, MessageSquareText } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { PatchCard } from "@/components/PatchCard";
import { PullRequestCard } from "@/components/PullRequestCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useNip34Project } from "@/hooks/useNip34Project";
import type { Nip34Artifact, Nip34Status } from "@/lib/nip34Project";
import { cn } from "@/lib/utils";

type Tab = "overview" | "issues" | "changes" | "activity";

const statusClasses: Record<Nip34Status["status"], string> = {
  open: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  applied: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  closed: "bg-muted text-muted-foreground",
  draft: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
};

function StatusBadge({ status }: { status: Nip34Status["status"] | undefined }) {
  if (!status) return null;
  return <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium capitalize", statusClasses[status])}>{status}</span>;
}

function IssueCard({ artifact, status }: { artifact: Nip34Artifact; status: Nip34Status["status"] | undefined }) {
  return (
    <article className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex min-w-0 items-start gap-3">
        <MessageSquareText className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="break-words text-base font-semibold">{artifact.subject}</h3>
            <StatusBadge status={status} />
          </div>
          {artifact.event.content.trim() ? (
            <p className="mt-2 line-clamp-3 whitespace-pre-wrap break-words text-sm text-muted-foreground">{artifact.event.content}</p>
          ) : null}
          {artifact.labels.length ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {artifact.labels.map((label) => <span key={label} className="rounded bg-secondary px-2 py-0.5 text-xs">{label}</span>)}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

/** Public NIP-34 repository activity linked from encrypted community metadata. */
export function ProjectWorkspace2({ repoNaddr, fundId, communityName, repoUrl }: { repoNaddr: string; fundId?: string; communityName: string; repoUrl?: string }) {
  const [tab, setTab] = useState<Tab>("overview");
  const project = useNip34Project(repoNaddr);

  if (project.isLoading) return <div className="mx-auto w-full max-w-4xl flex-1 space-y-4 px-3 py-4 sm:px-6" role="status" aria-label="Loading project"><Skeleton className="h-32 w-full rounded-xl" /><Skeleton className="h-12 w-full rounded-xl" /><div className="grid gap-3 sm:grid-cols-3"><Skeleton className="h-24 rounded-xl" /><Skeleton className="h-24 rounded-xl" /><Skeleton className="h-24 rounded-xl" /></div></div>;
  if (project.isError || !project.data) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 items-center px-4 py-12">
        <div className="w-full rounded-xl border border-dashed p-8 text-center">
          <AlertCircle className="mx-auto size-7 text-destructive" />
          <p className="mt-3 text-base font-medium">Project data could not be loaded</p>
          <p className="mt-1 text-sm text-muted-foreground">{project.error instanceof Error ? project.error.message : "Check the repository relays and try again."}</p>
          <Button variant="outline" className="mt-4" onClick={() => void project.refetch()}>Try again</Button>
        </div>
      </div>
    );
  }

  const data = project.data;
  const name = data.repository.tags.find(([tag]) => tag === "name")?.[1] || data.pointer.identifier;
  const description = data.repository.tags.find(([tag]) => tag === "description")?.[1];
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "overview", label: "Overview" }, { id: "issues", label: `Issues ${data.issues.length}` },
    { id: "changes", label: `Changes ${data.pullRequests.length + data.patches.length}` }, { id: "activity", label: "Activity" },
  ];

  return (
    <div className="flex-1 overflow-y-auto overscroll-contain px-3 pb-safe pt-4 sm:px-6">
      <div className="mx-auto w-full max-w-4xl space-y-5 pb-8">
        <header className="rounded-xl border bg-card p-4 shadow-sm sm:p-6">
          <div className="flex items-start gap-3"><GitCommitHorizontal className="mt-1 size-6 shrink-0 text-primary" /><div className="min-w-0"><h2 className="break-words text-xl font-bold sm:text-2xl">{name}</h2>{description ? <p className="mt-2 break-words text-base text-muted-foreground">{description}</p> : null}<p className="mt-2 text-xs text-muted-foreground">Nostr-native repository · {data.maintainers.size} maintainer{data.maintainers.size === 1 ? "" : "s"}</p></div></div>
        </header>
        <section className="flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3"><HandCoins className="mt-0.5 size-5 shrink-0 text-primary" /><div><h3 className="font-semibold">Project funding</h3><p className="text-sm text-muted-foreground">Funding milestones and public repository evidence remain separate signals; repository status never releases money automatically.</p></div></div>
          <Button asChild className="min-h-11 shrink-0"><Link to={fundId ? `/bao-fund?campaign=${encodeURIComponent(fundId)}` : `/bao-fund?create=1&title=${encodeURIComponent(communityName)}${repoUrl ? `&repo=${encodeURIComponent(repoUrl)}` : ""}`}>{fundId ? "View milestones" : "Create fundraiser"}</Link></Button>
        </section>
        <nav className="flex gap-1 overflow-x-auto rounded-xl bg-muted/60 p-1" aria-label="Project sections">
          {tabs.map((item) => <Button key={item.id} variant="ghost" size="sm" className={cn("shrink-0", tab === item.id && "bg-background shadow-sm")} aria-current={tab === item.id ? "page" : undefined} onClick={() => setTab(item.id)}>{item.label}</Button>)}
        </nav>
        {tab === "overview" ? (
          <div className="grid gap-3 sm:grid-cols-3">{[["Open issues", data.issues.filter((a) => data.statusByArtifact.get(a.event.id)?.status !== "closed").length], ["Pull requests", data.pullRequests.length], ["Patches", data.patches.length]].map(([label, value]) => <div key={label} className="rounded-xl border bg-card p-4"><p className="text-2xl font-bold">{value}</p><p className="text-sm text-muted-foreground">{label}</p></div>)}</div>
        ) : tab === "issues" ? (
          <div className="space-y-3">{data.issues.length ? data.issues.map((a) => <IssueCard key={a.event.id} artifact={a} status={data.statusByArtifact.get(a.event.id)?.status} />) : <Empty label="No issues published yet." />}</div>
        ) : tab === "changes" ? (
          <div className="space-y-4">{data.pullRequests.map((a) => <div key={a.event.id} className="space-y-2"><div className="flex justify-end"><StatusBadge status={data.statusByArtifact.get(a.event.id)?.status} /></div><PullRequestCard event={a.event} preview /></div>)}{data.patches.map((a) => <div key={a.event.id} className="space-y-2"><div className="flex justify-end"><StatusBadge status={data.statusByArtifact.get(a.event.id)?.status} /></div><PatchCard event={a.event} /></div>)}{!data.pullRequests.length && !data.patches.length ? <Empty label="No changes published yet." /> : null}</div>
        ) : (
          <div className="space-y-3">{data.activity.length ? data.activity.map((item) => <div key={item.event.id} className="flex items-center gap-3 rounded-xl border bg-card p-4"><GitPullRequest className="size-5 shrink-0 text-muted-foreground" /><p className="min-w-0 flex-1 truncate text-sm">{"subject" in item ? item.subject : "status" in item ? `Marked ${item.status}` : "Updated pull request"}</p><time className="shrink-0 text-xs text-muted-foreground">{new Date(item.event.created_at * 1000).toLocaleDateString()}</time></div>) : <Empty label="No project activity yet." />}</div>
        )}
      </div>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <div className="rounded-xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">{label}</div>;
}
