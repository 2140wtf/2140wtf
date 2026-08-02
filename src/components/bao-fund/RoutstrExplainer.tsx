import { ChevronDown, Route, Search, ShieldCheck, Trophy } from 'lucide-react';

import { openUrl } from '@/lib/downloadFile';

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
    <details className="group rounded-lg border bg-card">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
        <span>How Routstr works</span>
        <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <section className="space-y-3 border-t px-4 pb-4 pt-3">
        <p className="text-xs text-muted-foreground">
          Paid in <span className="text-green-600 dark:text-green-400 font-medium">real Bitcoin mainnet Cashu</span> — never ₿AO testnet sats.
          Bitcoiners get the best price — and the best experience. Routstr nodes compete for your sats, so the
          market does the negotiating.{' '}
          <button
            type="button"
            onClick={() => openUrl('https://routstr.com/routstrd')}
            className="underline underline-offset-2 hover:text-foreground cursor-pointer"
          >
            routstr.com/routstrd
          </button>
        </p>
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
    </details>
  );
}
