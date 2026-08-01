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

function renderDialog(onCreated = vi.fn(), onOpenChange = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <CreateCampaignDialog open onOpenChange={onOpenChange} onCreated={onCreated} />
    </QueryClientProvider>,
  );
  return onCreated;
}

/** Fill every required field of the default milestone-markets form. */
function fillValidForm() {
  fireEvent.change(screen.getByLabelText('Project title'), { target: { value: 'Test campaign' } });
  fireEvent.change(screen.getByLabelText(/Repository/), { target: { value: 'https://github.com/x/y' } });
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'x'.repeat(130) } });
  fireEvent.change(screen.getAllByPlaceholderText('sats')[0], { target: { value: '5000' } });
  fireEvent.change(screen.getByPlaceholderText('Milestone 1'), { target: { value: 'Ship it' } });
  fireEvent.change(screen.getByPlaceholderText(/What will be delivered/), { target: { value: 'd'.repeat(60) } });
  fireEvent.change(screen.getByPlaceholderText(/Delivery criteria/), { target: { value: 'c'.repeat(25) } });
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

    // …then switch to the single shot: the Goal input shows only the
    // first draft's amount, so that is what the campaign must be created with.
    fireEvent.click(screen.getByText('Single shot'));
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
    // Category is fixed server-side; the dialog no longer offers a picker.
    expect(input.category).toBe('bao-fund');
    expect(input.subcategory).toBeNull();
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('new-id'));
  });

  it('fixes the category to bao-fund and sends the trimmed subcategory tags', async () => {
    renderDialog();

    fireEvent.change(screen.getByLabelText('Project title'), { target: { value: 'Tagged campaign' } });
    fireEvent.change(screen.getByLabelText(/Repository/), { target: { value: 'https://github.com/x/y' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'x'.repeat(130) } });
    fireEvent.change(screen.getByLabelText('Subcategory / tags'), { target: { value: '  mining, app doing xyz  ' } });

    fireEvent.change(screen.getAllByPlaceholderText('sats')[0], { target: { value: '5000' } });
    fireEvent.change(screen.getByPlaceholderText(`Milestone 1`), { target: { value: 'Ship it' } });
    fireEvent.change(screen.getByPlaceholderText(/What will be delivered/), { target: { value: 'd'.repeat(60) } });
    fireEvent.change(screen.getByPlaceholderText(/Delivery criteria/), { target: { value: 'c'.repeat(25) } });

    fireEvent.click(screen.getByRole('button', { name: 'Create raise — 5,000 sats goal' }));
    await waitFor(() => expect(mocks.createMock).toHaveBeenCalledTimes(1));

    const input = mocks.createMock.mock.calls[0][1] as CreateFundraiserInput;
    expect(input.category).toBe('bao-fund');
    expect(input.subcategory).toBe('mining, app doing xyz');
  });
});

describe('CreateCampaignDialog — idempotency while creating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('blocks closing and shows progress text during the relay poll', async () => {
    let resolveCreate!: (value: unknown) => void;
    mocks.createMock.mockImplementation(
      () => new Promise((resolve) => { resolveCreate = resolve; }),
    );
    const onOpenChange = vi.fn();
    renderDialog(vi.fn(), onOpenChange);

    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create raise — 5,000 sats goal' }));

    // While the relay-first poll runs (up to 30s), the dialog must not close.
    expect(await screen.findByText(/Publishing to the ₿AO relay/)).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    resolveCreate({ result: { fundraiser: { id: 'new-id' }, milestones: [], markets: [] }, via: 'rest' });
    await waitFor(() => expect(mocks.toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Campaign created (DEMO)' }),
    ));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('CreateCampaignDialog — deadline validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it.each(['1', '99999'])('rejects a milestone deadline of %s days', async (days) => {
    renderDialog();
    fillValidForm();
    // The deadline input sits next to the "days to deliver" label.
    const deadlineInput = screen.getByText('days to deliver (7–50)').previousElementSibling as HTMLInputElement;
    fireEvent.change(deadlineInput, { target: { value: days } });

    expect(await screen.findByText('Milestone 1: deadline must be 7–50 days')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create raise/ })).toBeDisabled();
    expect(mocks.createMock).not.toHaveBeenCalled();
  });

  it('rejects a vesting window below 1 day in single-shot mode', async () => {
    renderDialog();
    fireEvent.click(screen.getByText('Single shot'));
    fireEvent.change(screen.getByLabelText('Project title'), { target: { value: 'Test campaign' } });
    fireEvent.change(screen.getByLabelText(/Repository/), { target: { value: 'https://github.com/x/y' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'x'.repeat(130) } });
    fireEvent.change(screen.getByLabelText('Goal (sats)'), { target: { value: '5000' } });
    fireEvent.change(screen.getByLabelText('Vesting window (days)'), { target: { value: '0' } });

    expect(await screen.findByText('Vesting window must be ≥ 1 day')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create raise/ })).toBeDisabled();
  });
});

describe('CreateCampaignDialog — fee disclosure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the computed runner fee in sats next to the fee selector', () => {
    renderDialog();
    fireEvent.change(screen.getAllByPlaceholderText('sats')[0], { target: { value: '10000' } });
    // Default tier is 2.14% → 214 sats on a 10,000-sat milestone.
    expect(screen.getByText('≈214 sats')).toBeInTheDocument();
  });

  it('states the AI verification fee range and distinguishes it from the runner fee', () => {
    renderDialog();
    expect(screen.getByText(/~500–2,000 sats depending on the judge model/)).toBeInTheDocument();
    expect(screen.getByText(/separate from the runner fee/)).toBeInTheDocument();
    expect(screen.queryByText(/~500 sats \(min\)/)).not.toBeInTheDocument();
  });
});
