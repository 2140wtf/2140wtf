import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import type { ReactNode } from 'react';

import { useAgentBodyPets } from './useAgentBodyPets';

// Control the relay response per-test.
const query = vi.fn<(filters: NostrFilter[]) => Promise<NostrEvent[]>>();
vi.mock('@nostrify/react', () => ({
  useNostr: () => ({ nostr: { query } }),
}));

const pk = (ch: string) => ch.repeat(64);

const AGENT_A = pk('a');
const AGENT_B = pk('b');
const AGENT_C = pk('c');
const OWNER = pk('d');

let idCounter = 0;

/** A valid kind 31124 pet state event, optionally declaring an agent body. */
function petEvent(agent: string | undefined, name: string, d: string): NostrEvent {
  const tags: string[][] = [
    ['d', d],
    ['b', 'pets:ecosystem:v1'],
    ['name', name],
    ['stage', 'baby'],
    ['state', 'active'],
    ['last_interaction', '1000'],
  ];
  if (agent) tags.push(['agent', agent]);
  return {
    id: (idCounter++).toString(16).padStart(64, '0'),
    pubkey: OWNER,
    kind: 31124,
    created_at: 1000,
    tags,
    content: '',
    sig: 'f'.repeat(128),
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useAgentBodyPets', () => {
  beforeEach(() => {
    query.mockReset();
  });

  it('returns pet bodies for the requested agents', async () => {
    query.mockResolvedValue([
      petEvent(AGENT_A, 'Puck', '2140pets-dddddddddddd-0123456789'),
      petEvent(AGENT_B, 'Jack', '2140pets-dddddddddddd-aabbccddee'),
      petEvent(undefined, 'Bodyless', '2140pets-dddddddddddd-ffeeddccbb'),
    ]);

    const { result } = renderHook(() => useAgentBodyPets([AGENT_A, AGENT_C]), { wrapper });

    await waitFor(() => expect(result.current.bodies.get(AGENT_A)?.name).toBe('Puck'));

    // AGENT_C has no body; the bodyless pet is ignored entirely.
    expect(result.current.bodies.has(AGENT_C)).toBe(false);
    expect(result.current.bodies.size).toBe(1);

    // The relay query scans the pets ecosystem via the single-letter `#b`
    // namespace tag (relays can't filter the multi-letter `agent` tag).
    const filters = query.mock.calls[0][0];
    expect(filters).toHaveLength(1);
    expect(filters[0]).toMatchObject({ kinds: [31124], '#b': ['pets:ecosystem:v1'] });
  });

  it('does not fetch when no agent pubkeys are given', async () => {
    const { result } = renderHook(() => useAgentBodyPets([]), { wrapper });

    await waitFor(() => expect(result.current.isFetching).toBe(false));

    expect(query).not.toHaveBeenCalled();
    expect(result.current.bodies.size).toBe(0);
  });

  it('ignores malformed pubkeys in the input', async () => {
    const { result } = renderHook(() => useAgentBodyPets(['not-a-pubkey', '']), { wrapper });

    await waitFor(() => expect(result.current.isFetching).toBe(false));

    expect(query).not.toHaveBeenCalled();
    expect(result.current.bodies.size).toBe(0);
  });

  it('degrades to an empty map when the relay query fails', async () => {
    query.mockRejectedValue(new Error('relay down'));

    const { result } = renderHook(() => useAgentBodyPets([AGENT_A]), { wrapper });

    await waitFor(() => expect(result.current.isFetching).toBe(false));

    expect(result.current.bodies.size).toBe(0);
  });

  it('shares one relay scan across callers with different agent lists', async () => {
    query.mockResolvedValue([
      petEvent(AGENT_A, 'Puck', '2140pets-dddddddddddd-0123456789'),
      petEvent(AGENT_B, 'Jack', '2140pets-dddddddddddd-aabbccddee'),
    ]);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const sharedWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const first = renderHook(() => useAgentBodyPets([AGENT_A]), { wrapper: sharedWrapper });
    const second = renderHook(() => useAgentBodyPets([AGENT_B]), { wrapper: sharedWrapper });

    await waitFor(() => expect(first.result.current.bodies.get(AGENT_A)?.name).toBe('Puck'));
    await waitFor(() => expect(second.result.current.bodies.get(AGENT_B)?.name).toBe('Jack'));

    expect(query).toHaveBeenCalledTimes(1);
  });
});
