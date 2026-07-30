import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CreateCampaignDialog } from './CreateCampaignDialog';
import type { CreateFundraiserInput } from '@/lib/baoFundraising';

const mocks = vi.hoisted(() => ({
  createMock: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock('@/lib/baoFundraising', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/baoFundraising')>();
  return { ...actual, createFundraiserRelayFirst: mocks.createMock };
});

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: 'user-pubkey', signer: {} } }),
}));

vi.mock('@/hooks/useNostrPublish', () => ({
  useNostrPublish: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast: mocks.toastMock }),
}));

function renderDialog(onCreated = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <CreateCampaignDialog open onOpenChange={() => {}} onCreated={onCreated} />
    </QueryClientProvider>,
  );
  return onCreated;
}

describe('CreateCampaignDialog — stream goal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createMock.mockResolvedValue({
      result: { fundraiser: { id: 'new-id' }, milestones: [], markets: [] },
      via: 'rest',
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('sends the visible Goal field as goal_sats, not the sum of leftover milestone drafts', async () => {
    const onCreated = renderDialog();

    // Draft two milestones in milestone-markets mode…
    fireEvent.change(screen.getAllByPlaceholderText('sats')[0], { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: /Add milestone/ }));
    fireEvent.change(screen.getAllByPlaceholderText('sats')[1], { target: { value: '2000' } });

    // …then switch to the time-lock stream: the Goal input shows only the
    // first draft's amount, so that is what the campaign must be created with.
    fireEvent.click(screen.getByText('Time-lock stream'));
    expect((screen.getByLabelText('Goal (sats)') as HTMLInputElement).value).toBe('1000');
    expect(screen.getByRole('button', { name: 'Create raise — 1,000 sats goal' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Project title'), { target: { value: 'Test campaign' } });
    fireEvent.change(screen.getByLabelText(/Repository/), { target: { value: 'https://github.com/x/y' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'x'.repeat(130) } });

    fireEvent.click(screen.getByRole('button', { name: 'Create raise — 1,000 sats goal' }));
    await waitFor(() => expect(mocks.createMock).toHaveBeenCalledTimes(1));

    const input = mocks.createMock.mock.calls[0][1] as CreateFundraiserInput;
    expect(input.format).toBe('stream');
    expect(input.goal_sats).toBe(1000);
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('new-id'));
  });
});
