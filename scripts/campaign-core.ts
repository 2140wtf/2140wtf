/**
 * Campaign verbs for the headless ₿AO agent driver.
 *
 * Lets an agent create, list, and inspect ₿AO Fund milestone campaigns
 * without the web UI. Creation uses the same relay-first kind-38003 intent
 * path as CreateCampaignDialog, falling back to the REST API when the bridge
 * is offline.
 */
import { hexToBytes } from "@noble/hashes/utils.js";

import {
  BAO_LIVE_RAILS,
  baoRelayUrl,
  createFundraiserRelayFirst,
  fetchFundraiser,
  fetchFundraisers,
  type BaoRail,
  type CreateFundraiserInput,
} from "@/lib/baoFundraising";
import { publishAll, signerOf, type State } from "./chat-core";

const DAY = 86_400;

const REPO_LINE_PREFIX = "Repository: ";
const WORK_TYPE_LINE_PREFIX = "Work-Type: ";

function isValidRepoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.includes(".") && url.pathname.length > 1;
  } catch {
    return false;
  }
}

function isValidRail(rail: string): rail is BaoRail {
  return (BAO_LIVE_RAILS as readonly string[]).includes(rail);
}

function parseMilestone(raw: string, now: number): CreateFundraiserInput["milestones"][number] {
  const parts = raw.split(",");
  if (parts.length !== 5) {
    throw new Error(`Milestone must be title,amount,criteria,days,feeBps — got ${parts.length} fields in "${raw}"`);
  }
  const [title, amount, criteria, days, feeBps] = parts;
  const amountSats = Number(amount);
  if (!Number.isSafeInteger(amountSats) || amountSats <= 0) {
    throw new Error(`Milestone amount must be a positive integer, got "${amount}"`);
  }
  const dayCount = Number(days);
  if (!Number.isSafeInteger(dayCount) || dayCount < 7 || dayCount > 50) {
    throw new Error(`Milestone deadline days must be 7–50, got "${days}"`);
  }
  const fee = Number(feeBps);
  if (![214, 421, 1000].includes(fee)) {
    throw new Error(`Milestone feeBps must be 214, 421, or 1000, got "${feeBps}"`);
  }
  return {
    title: title.trim(),
    amount_sats: amountSats,
    description: `Milestone: ${title.trim()}`,
    criteria: criteria.trim(),
    deadline_at: now + dayCount * DAY,
    fee_bps: fee,
  };
}

export interface CampaignCreateInput {
  title: string;
  goalSats: number;
  runner: "agent" | "human" | "agent_human";
  rail: BaoRail;
  description?: string;
  repoUrl?: string;
  milestones?: string[];
}

/**
 * Create a milestone campaign via relay-first intent.
 *
 * In dry-run mode no event is published; a deterministic placeholder id is
 * returned so callers can still print the would-be URL.
 */
export async function createCampaign(
  state: State,
  input: CampaignCreateInput,
  dryRun: boolean,
): Promise<{ id: string; url: string; via: "relay" | "rest" }> {
  if (input.repoUrl?.trim() && !isValidRepoUrl(input.repoUrl.trim())) {
    throw new Error("repoUrl must be a valid https:// git repository URL");
  }
  const now = Math.floor(Date.now() / 1000);
  const repositoryLine = input.repoUrl?.trim() ? `\n${REPO_LINE_PREFIX}${input.repoUrl.trim()}` : "";
  const fullDescription = `${WORK_TYPE_LINE_PREFIX}software${repositoryLine}\n\n${(input.description ?? "").trim()}`;

  const milestones = input.milestones && input.milestones.length > 0
    ? input.milestones.map((m) => parseMilestone(m, now))
    : [{
        title: "Delivery",
        amount_sats: input.goalSats,
        description: "Delivery milestone",
        criteria: "Deliver the project",
        deadline_at: now + 21 * DAY,
        fee_bps: 214,
      }];

  const goal = milestones.reduce((sum, m) => sum + m.amount_sats, 0);

  const createInput: CreateFundraiserInput = {
    title: input.title.trim(),
    description: fullDescription,
    runner_type: input.runner,
    goal_sats: goal,
    settlement_rail: input.rail,
    format: "milestones",
    category: "bao-fund",
    subcategory: null,
    milestones,
  };

  if (dryRun) {
    return { id: "dry-run", url: "https://2140.wtf/bao-funding?campaign=dry-run", via: "relay" };
  }

  const signer = signerOf(hexToBytes(state.sk));
  const { result, via } = await createFundraiserRelayFirst(signer, createInput, {
    publish: async (template) => {
      const event = await signer.signEvent({ ...template, created_at: Math.floor(Date.now() / 1000) });
      await publishAll([template.relay ?? baoRelayUrl()], event, "campaign create intent");
      return { id: event.id };
    },
  });

  const id = result.fundraiser.id;
  return { id, url: `https://2140.wtf/bao-funding?campaign=${encodeURIComponent(id)}`, via };
}

function formatSats(n: number): string {
  return Number(n).toLocaleString();
}

/** List campaigns from the bao.markets API. */
export async function listCampaigns(status: string | undefined, json: boolean): Promise<void> {
  const campaigns = await fetchFundraisers(status);
  if (json) {
    console.log(JSON.stringify(campaigns));
    return;
  }
  if (campaigns.length === 0) {
    console.log("No campaigns found.");
    return;
  }
  console.log(`\nCampaigns (${campaigns.length}):`);
  for (const c of campaigns) {
    console.log(
      `  ${c.id.slice(0, 12)}…  ${c.title} [${c.status}] ${formatSats(Number(c.raised_sats))}/${formatSats(Number(c.goal_sats))} sats · ${c.runner_type}`,
    );
  }
}

/** Show one campaign and its milestones. */
export async function showCampaign(id: string, json: boolean): Promise<void> {
  const { fundraiser, milestones } = await fetchFundraiser(id);
  if (json) {
    console.log(JSON.stringify({ fundraiser, milestones }));
    return;
  }
  console.log(`\n${fundraiser.title} [${fundraiser.status}]`);
  console.log(`  id: ${fundraiser.id}`);
  console.log(`  runner: ${fundraiser.runner_type} · rail: ${fundraiser.settlement_rail}`);
  console.log(`  raised: ${formatSats(Number(fundraiser.raised_sats))} / ${formatSats(Number(fundraiser.goal_sats))} sats`);
  if (fundraiser.description) console.log(`  description: ${fundraiser.description}`);
  console.log(`  milestones (${milestones.length}):`);
  for (const m of milestones) {
    console.log(`    ${m.idx + 1}. ${m.title} — ${formatSats(Number(m.amount_sats))} sats · ${m.status}`);
    if (m.criteria) console.log(`       criteria: ${m.criteria}`);
  }
}

export { isValidRail };
