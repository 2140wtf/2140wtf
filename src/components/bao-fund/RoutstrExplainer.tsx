import { Route, Search, ShieldCheck, Trophy } from 'lucide-react';

const PILLARS = [
  {
    icon: Search,
    title: 'Node Discovery',
    body: 'Routstr nodes announce themselves on Nostr. Discovery keeps scanning the network in the background — it always knows where the good nodes are.',
  },
  {
    icon: Route,
    title: 'Auto-Routing',
    body: 'Finds the cheapest available provider for the model you want, and falls back to the next best on availability.',
  },
  {
    icon: Trophy,
    title: 'Open Competition',
    body: 'Nodes compete on price, latency, and uptime — the competition is heating up, so you always get the best deal without thinking about it.',
  },
  {
    icon: ShieldCheck,
    title: 'Zero Permissions',
    body: 'No KYC, no credit cards, no sign-ups. A Cashu token becomes an sk_… compute key — that’s the whole account.',
  },
] as const;

/**
 * "How Routstr works" explainer, modeled on routstr.com/routstrd.
 *
 * The Compute credits tab asks funders to send REAL sats to strangers — the
 * least we can do is explain where those sats go: an open market of competing
 * AI-inference nodes paid in ecash, not a company.
 */
export function RoutstrExplainer() {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">How Routstr works</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Bitcoiners get the best price — and the best experience. Routstr nodes compete for your sats, so the
          market does the negotiating.{' '}
          <a
            href="https://routstr.com/routstrd"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            routstr.com/routstrd
          </a>
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {PILLARS.map(({ icon: Icon, title, body }) => (
          <div key={title} className="rounded-lg border p-3 space-y-2">
            <div className="flex size-8 items-center justify-center rounded-md border bg-muted/40">
              <Icon className="size-4 text-primary" />
            </div>
            <p className="text-sm font-medium">{title}</p>
            <p className="text-[11px] leading-relaxed text-muted-foreground">{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
