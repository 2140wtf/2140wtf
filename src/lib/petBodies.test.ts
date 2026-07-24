import { describe, expect, it } from 'vitest';

import type { NostrEvent } from '@nostrify/nostrify';

import {
  buildAgentBodyMap,
  normalizeAgentPubkeys,
  petBodyFromEvent,
} from './petBodies';

const pk = (ch: string) => ch.repeat(64);

const AGENT_A = pk('a');
const AGENT_B = pk('b');
const OWNER = pk('c');

let idCounter = 0;

/** A valid kind 31124 pet state event, optionally carrying an agent-body tag. */
function petEvent(overrides: {
  agent?: string;
  name?: string;
  d?: string;
  image?: string;
  baseColor?: string;
  pubkey?: string;
  createdAt?: number;
  extraTags?: string[][];
} = {}): NostrEvent {
  const tags: string[][] = [
    ['d', overrides.d ?? '2140pets-cccccccccccc-0123456789'],
    ['b', 'pets:ecosystem:v1'],
    ['name', overrides.name ?? 'Puck'],
    ['stage', 'baby'],
    ['state', 'active'],
    ['last_interaction', '1000'],
    ...(overrides.extraTags ?? []),
  ];
  if (overrides.agent) tags.push(['agent', overrides.agent]);
  if (overrides.image) tags.push(['image', overrides.image]);
  if (overrides.baseColor) tags.push(['base_color', overrides.baseColor]);
  return {
    id: (idCounter++).toString(16).padStart(64, '0'),
    pubkey: overrides.pubkey ?? OWNER,
    kind: 31124,
    created_at: overrides.createdAt ?? 1000,
    tags,
    content: '',
    sig: 'f'.repeat(128),
  };
}

describe('normalizeAgentPubkeys', () => {
  it('lowercases, dedupes, sorts, and drops malformed pubkeys', () => {
    expect(
      normalizeAgentPubkeys([
        AGENT_B.toUpperCase(),
        AGENT_A,
        AGENT_B,
        'not-a-pubkey',
        'abcd',
        '',
      ]),
    ).toEqual([AGENT_A, AGENT_B]);
  });

  it('returns an empty list for empty input', () => {
    expect(normalizeAgentPubkeys([])).toEqual([]);
  });
});

describe('petBodyFromEvent', () => {
  it('parses a pet event carrying an agent-body tag', () => {
    const body = petBodyFromEvent(
      petEvent({ agent: AGENT_A, name: 'Puck', image: 'https://example.com/puck.png', baseColor: '#F59E0B' }),
    );
    expect(body).toEqual({
      agentPubkey: AGENT_A,
      name: 'Puck',
      picture: 'https://example.com/puck.png',
      ownerPubkey: OWNER,
      d: '2140pets-cccccccccccc-0123456789',
      baseColor: '#F59E0B',
    });
  });

  it('lowercases the agent pubkey from the tag', () => {
    const body = petBodyFromEvent(petEvent({ agent: AGENT_A.toUpperCase() }));
    expect(body?.agentPubkey).toBe(AGENT_A);
  });

  it('returns undefined when the pet has no agent tag', () => {
    expect(petBodyFromEvent(petEvent())).toBeUndefined();
  });

  it('returns undefined for events that are not valid pet state events', () => {
    const notAPet = petEvent({ agent: AGENT_A, extraTags: [] });
    notAPet.kind = 1;
    expect(petBodyFromEvent(notAPet)).toBeUndefined();

    const noNamespace = petEvent({ agent: AGENT_A });
    noNamespace.tags = noNamespace.tags.filter(([n]) => n !== 'b');
    expect(petBodyFromEvent(noNamespace)).toBeUndefined();
  });

  it('derives the name from a legacy d-tag when the name tag is missing', () => {
    const event = petEvent({ agent: AGENT_A, d: 'pets-mr-cool' });
    event.tags = event.tags.filter(([n]) => n !== 'name');
    expect(petBodyFromEvent(event)?.name).toBe('Mr Cool');
  });

  it('omits picture and baseColor when the tags are absent', () => {
    const body = petBodyFromEvent(petEvent({ agent: AGENT_A }));
    expect(body?.picture).toBeUndefined();
    expect(body?.baseColor).toBeUndefined();
  });
});

describe('buildAgentBodyMap', () => {
  it('maps agent pubkeys to their pet bodies', () => {
    const map = buildAgentBodyMap([
      petEvent({ agent: AGENT_A, name: 'Puck' }),
      petEvent({ agent: AGENT_B, name: 'Jack', d: '2140pets-cccccccccccc-aabbccddee' }),
    ]);
    expect(map.get(AGENT_A)?.name).toBe('Puck');
    expect(map.get(AGENT_B)?.name).toBe('Jack');
    expect(map.size).toBe(2);
  });

  it('filters to the requested agents when given a list', () => {
    const map = buildAgentBodyMap(
      [
        petEvent({ agent: AGENT_A, name: 'Puck' }),
        petEvent({ agent: AGENT_B, name: 'Jack', d: '2140pets-cccccccccccc-aabbccddee' }),
      ],
      [AGENT_A],
    );
    expect(map.get(AGENT_A)?.name).toBe('Puck');
    expect(map.has(AGENT_B)).toBe(false);
  });

  it('accepts mixed-case and malformed entries in the requested list', () => {
    const map = buildAgentBodyMap(
      [petEvent({ agent: AGENT_A, name: 'Puck' })],
      [AGENT_A.toUpperCase(), 'garbage'],
    );
    expect(map.get(AGENT_A)?.name).toBe('Puck');
  });

  it('keeps the newest event when two pets claim the same agent', () => {
    const older = petEvent({ agent: AGENT_A, name: 'Old', createdAt: 1000 });
    const newer = petEvent({
      agent: AGENT_A,
      name: 'New',
      d: '2140pets-cccccccccccc-aabbccddee',
      createdAt: 2000,
    });
    const map = buildAgentBodyMap([newer, older]);
    expect(map.get(AGENT_A)?.name).toBe('New');
  });

  it('skips pets without an agent tag and invalid events', () => {
    const invalid = petEvent({ agent: AGENT_B });
    invalid.kind = 1;
    const map = buildAgentBodyMap([petEvent(), invalid]);
    expect(map.size).toBe(0);
  });

  it('returns an empty map for no events', () => {
    expect(buildAgentBodyMap([]).size).toBe(0);
  });
});
