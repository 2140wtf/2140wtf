import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';

import { AgentJoinPanel } from './AgentJoinPanel';

const mocks = vi.hoisted(() => ({
  nsec: vi.fn(),
  extension: vi.fn(),
  bunker: vi.fn(),
  nostrEvent: vi.fn(async (_event: { kind: number; content: string }) => ({})),
  onHoldJoin: vi.fn(),
  onHumanPath: vi.fn(),
}));

vi.mock('@/hooks/useLoginActions', () => ({
  useLoginActions: () => ({
    nsec: mocks.nsec,
    extension: mocks.extension,
    bunker: mocks.bunker,
  }),
}));

vi.mock('@nostrify/react', () => ({
  useNostr: () => ({ nostr: { event: mocks.nostrEvent } }),
}));

function renderPanel() {
  return render(
    <AgentJoinPanel
      communityName="Test ₿AO"
      linkSigner={'ab'.repeat(32)}
      bootstrapRelays={['wss://relay.example']}
      onHoldJoin={mocks.onHoldJoin}
      onHumanPath={mocks.onHumanPath}
    />,
  );
}

describe('AgentJoinPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the scrapeable machine card with the bundle coordinate and docs link', () => {
    const { container, getByText } = renderPanel();
    const pre = container.querySelector('pre[data-bao-agent-invite]');
    expect(pre).toBeTruthy();
    const card = JSON.parse(pre!.textContent!);
    expect(card.type).toBe('bao-community-invite');
    expect(card.audience).toBe('agent');
    expect(card.community).toBe('Test ₿AO');
    expect(card.bundle_coordinate).toEqual({ kind: 33301, author: 'ab'.repeat(32), d: '' });
    expect(card.bootstrap_relays).toEqual(['wss://relay.example']);
    expect(card.docs).toMatch(/\/AGENTS\.md$/);
    expect(getByText(/I'm a human/)).toBeTruthy();
  });

  it('rejects a malformed nsec without calling login', () => {
    const { getByLabelText, getByText } = renderPanel();
    fireEvent.click(getByText('I have a Nostr key — log in & join'));
    fireEvent.change(getByLabelText('Your nsec'), { target: { value: 'npub1notasecret' } });
    fireEvent.click(getByText('Join'));
    expect(mocks.nsec).not.toHaveBeenCalled();
    expect(getByText(/doesn't look like an nsec/)).toBeTruthy();
  });

  it('logs in with a pasted nsec (the page auto-join takes over — no hold)', () => {
    const { getByLabelText, getByText } = renderPanel();
    fireEvent.click(getByText('I have a Nostr key — log in & join'));
    fireEvent.change(getByLabelText('Your nsec'), { target: { value: 'nsec1whatever' } });
    fireEvent.click(getByText('Join'));
    expect(mocks.nsec).toHaveBeenCalledWith('nsec1whatever');
    expect(mocks.onHoldJoin).not.toHaveBeenCalled();
  });

  it('create-key generates a login, marks the bot profile, reveals the nsec, and HOLDS the join', async () => {
    const { getByText, getByLabelText, getByDisplayValue } = renderPanel();
    fireEvent.change(getByLabelText('Agent name'), { target: { value: 'swarm-7' } });
    fireEvent.click(getByText('Create my agent key & join'));

    await waitFor(() => expect(mocks.nsec).toHaveBeenCalledTimes(1));
    const nsec = mocks.nsec.mock.calls[0][0] as string;
    expect(nsec.startsWith('nsec1')).toBe(true);
    // The revealed key matches the logged-in key, shown exactly once, join held.
    getByDisplayValue(nsec);
    expect(mocks.onHoldJoin).toHaveBeenCalledWith(true);
    // Bot profile published straight from the fresh key (kind 0, bot: true).
    await waitFor(() => expect(mocks.nostrEvent).toHaveBeenCalledTimes(1));
    const profile = mocks.nostrEvent.mock.calls[0][0];
    expect(profile.kind).toBe(0);
    expect(JSON.parse(profile.content)).toEqual({ name: 'swarm-7', bot: true });

    // Releasing the hold is the agent's explicit "I stored it" action.
    fireEvent.click(getByText('My key is stored — take me into the ₿AO'));
    expect(mocks.onHoldJoin).toHaveBeenLastCalledWith(false);
  });

  it('skips the bot profile publish when the box is unticked', async () => {
    const { getByText, getByRole } = renderPanel();
    fireEvent.click(getByRole('checkbox'));
    fireEvent.click(getByText('Create my agent key & join'));
    await waitFor(() => expect(mocks.nsec).toHaveBeenCalledTimes(1));
    expect(mocks.nostrEvent).not.toHaveBeenCalled();
  });

  it('lets a human take the normal path', () => {
    const { getByText } = renderPanel();
    fireEvent.click(getByText(/I'm a human/));
    expect(mocks.onHumanPath).toHaveBeenCalled();
  });
});
