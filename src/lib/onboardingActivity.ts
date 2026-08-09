import type { NRelay, NostrEvent } from "@nostrify/nostrify";
import { APP_CURATED_FEED_RELAYS } from "@/lib/appRelays";

const ACTIVITY_WINDOW_SECONDS = 24 * 60 * 60;
const MAX_ACTIVE_PEOPLE = 8;

export interface RelayGroupProvider {
  group(urls: string[]): Pick<NRelay, "query">;
}

/**
 * Find recently active starter accounts on app-owned discovery relays.
 *
 * New accounts may not have a useful personal relay list yet, so activity
 * discovery must not depend on their current pool. Results are constrained to
 * the curated candidate list and revalidated after the relay response.
 */
export async function fetchActiveOnboardingPubkeys(
  nostr: RelayGroupProvider,
  candidates: readonly string[],
  nowSeconds: number,
  signal: AbortSignal,
): Promise<string[]> {
  const since = nowSeconds - ACTIVITY_WINDOW_SECONDS;
  const candidateSet = new Set(candidates);
  const events = await nostr.group(APP_CURATED_FEED_RELAYS).query([{
    kinds: [1],
    authors: [...candidates],
    since,
    limit: 200,
  }], { signal });

  const latestByAuthor = new Map<string, number>();
  for (const event of events) {
    if (!isRecentCandidatePost(event, candidateSet, since, nowSeconds)) continue;
    latestByAuthor.set(
      event.pubkey,
      Math.max(latestByAuthor.get(event.pubkey) ?? 0, event.created_at),
    );
  }

  return [...latestByAuthor.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_ACTIVE_PEOPLE)
    .map(([pubkey]) => pubkey);
}

function isRecentCandidatePost(
  event: NostrEvent,
  candidates: ReadonlySet<string>,
  since: number,
  nowSeconds: number,
): boolean {
  return event.kind === 1
    && candidates.has(event.pubkey)
    && event.created_at >= since
    && event.created_at <= nowSeconds;
}
