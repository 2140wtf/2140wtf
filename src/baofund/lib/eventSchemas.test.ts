/**
 * Event-schema conformance (WS-7, "Blocker 0").
 *
 * The published JSON Schemas in `/schemas` are the portable contract for
 * external implementers. These tests validate REAL builder output against
 * those exact files (no parallel copy), so a schema and its implementation
 * cannot drift apart silently. The mini-validator is intentionally a subset
 * (see schemas/README.md).
 *
 * Normative context: `docs/bao-normative-spec-v0.md` §1.5 (canonicalization)
 * and §1.6 (event content schemas).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateSecretKey } from 'nostr-tools/pure';
import { validateAgainstSchema } from './jsonSchema';
import { buildFundraiserCardContent } from './baoCards';
import { buildMilestoneStatusContent } from './baoStatusPublish';
import { validateLedgerEntry } from './baoLedger39805';
import { signLedgerChain } from './baoLedgerPublish';

const here = dirname(fileURLToPath(import.meta.url));
const loadSchema = (file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(here, '..', '..', 'schemas', file), 'utf8')) as Record<string, unknown>;

const CARD = loadSchema('event-39801-card.v1.json');
const STATUS = loadSchema('event-39803-status.v1.json');
const ENTRY = loadSchema('event-49305-ledger-entry.v1.json');

const CAMPAIGN = `39801:${'a'.repeat(64)}:my-slug`;

function cardContent() {
  return buildFundraiserCardContent({
    title: 'Solar microgrid',
    summary: 'Rooftop solar for a village clinic',
    format: 'milestones',
    rails: ['cashu', 'lightning'],
    milestones: [{ id: 'm1', title: 'Equipment', amount: 50_000, status: 'locked' }],
    attestation: 'agent-verified',
    api: 'https://fund.bao.network',
    agentHints: { amountUnit: 'sats', canContributeFrom: ['browser', 'mcp'], idempotency: 'Idempotency-Key' },
  });
}

const statusContent = () =>
  buildMilestoneStatusContent({ campaign: CAMPAIGN, milestone: 'm1', seq: 1, status: 'unlocked' });

async function ledgerContent() {
  const sk = generateSecretKey();
  const signer = { signEvent: async (e: never) => (await import('nostr-tools/pure')).finalizeEvent(e, sk) };
  const [ev] = await signLedgerChain(
    signer as never,
    CAMPAIGN,
    [{ type: 'STAKE_LOCK', registrarEpoch: 1, amountSats: 500, proofSetHash: 'a'.repeat(64), nullifierRoot: 'b'.repeat(64), createdAt: 1_700_000_000 }],
  );
  return validateLedgerEntry(ev);
}

describe('published event schemas validate real builder output', () => {
  it('39801 card content conforms', () => {
    const content = cardContent();
    expect(validateAgainstSchema(CARD, content)).toEqual([]);
  });

  it('39803 status content conforms', () => {
    expect(validateAgainstSchema(STATUS, statusContent())).toEqual([]);
  });

  it('49305 ledger entry content conforms', async () => {
    expect(validateAgainstSchema(ENTRY, await ledgerContent())).toEqual([]);
  });
});

describe('schema ↔ implementation drift guard', () => {
  const assertCovered = (schema: Record<string, unknown>, content: object) => {
    const props = Object.keys((schema.properties as Record<string, unknown>) ?? {});
    const required = (schema.required as string[]) ?? [];
    const keys = Object.keys(content);
    for (const key of keys) {
      expect(props, `schema.properties is missing "${key}"`).toContain(key);
    }
    for (const key of required) {
      expect(keys, `builder output is missing required "${key}"`).toContain(key);
    }
  };

  it('39801 required keys match the builder', () => assertCovered(CARD, cardContent()));
  it('39803 required keys are a subset of emitted keys', () => assertCovered(STATUS, statusContent()));
  it('49305 required keys match the validator output', async () => assertCovered(ENTRY, await ledgerContent()));
});

describe('schemas reject non-conformant content', () => {
  it('39801: missing required, unknown key, bad enum, float amount', () => {
    const base = cardContent();
    const missing: Record<string, unknown> = { ...base };
    delete missing.title;
    expect(validateAgainstSchema(CARD, missing).some((e) => e.keyword === 'required')).toBe(true);

    expect(validateAgainstSchema(CARD, { ...base, extra: 1 }).some((e) => e.keyword === 'additionalProperties')).toBe(true);
    expect(validateAgainstSchema(CARD, { ...base, format: 'nope' }).some((e) => e.keyword === 'enum')).toBe(true);
    const floatMs = { ...base, milestones: [{ ...base.milestones[0], amount: 1.5 }] };
    expect(validateAgainstSchema(CARD, floatMs).some((e) => e.keyword === 'type')).toBe(true);
  });

  it('39803: a bare slug (not a full a-coordinate) is rejected', () => {
    const bad = { ...statusContent(), fundraiser: 'my-slug' };
    expect(validateAgainstSchema(STATUS, bad).some((e) => e.keyword === 'pattern')).toBe(true);
  });

  it('49305: a float amount and a bad campaign coordinate are rejected', async () => {
    const entry = await ledgerContent();
    expect(validateAgainstSchema(ENTRY, { ...entry, amountSats: 1.5 }).some((e) => e.keyword === 'type')).toBe(true);
    expect(validateAgainstSchema(ENTRY, { ...entry, campaign: 'slug' }).some((e) => e.keyword === 'pattern')).toBe(true);
  });
});
