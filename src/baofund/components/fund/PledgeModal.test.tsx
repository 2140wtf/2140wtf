import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { PledgeModal, pledgeRailsFor } from './PledgeModal';
import type { CampaignBreakdown } from './campaignBreakdown';

const mocks = vi.hoisted(() => ({
  submit: vi.fn(), models: vi.fn(), spend: vi.fn(),
  decode: vi.fn(), spent: vi.fn(),
  signer: { getPublicKey: async () => 'test-pubkey' },
}));
vi.mock('../../lib/baoFundraising', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/baoFundraising')>()),
  fetchVerificationModels: mocks.models,
  baoRelayUrl: () => 'wss://example.invalid',
}));
vi.mock('./pledgeFlow', () => ({ submitPledge: mocks.submit }));
vi.mock('../../lib/cashu/tokenUtils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/cashu/tokenUtils')>()),
  decodeCashuToken: mocks.decode,
  checkTokenProofsSpent: mocks.spent,
}));
vi.mock('../../relay/guestIdentity', () => ({ createGuestSigner: vi.fn(), getGuestPubkeyHex: () => 'guest' }));
vi.mock('../../auth/useAuth', () => ({ useAuth: () => ({ status: 'ready', signer: mocks.signer, pubkey: 'test-pubkey' }) }));
vi.mock('../../wallet/nip61', () => ({ sendNutzap: vi.fn() }));
vi.mock('../../wallet/cashuWallet', () => ({ loadStoredWallet: () => ({ proofs: [], mintUrl: 'https://example.invalid' }), sumProofs: () => 0, spendFromStoredWallet: mocks.spend, loadPendingTopUp: () => null, createLightningTopUp: vi.fn(), completeLightningTopUp: vi.fn() }));
let container: HTMLDivElement;
let root: Root;
let onDone = vi.fn<(msg: string) => void>();
let onClose = vi.fn<() => void>();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  mocks.models.mockResolvedValue({ models: [{ id: 'test-model', name: 'Test model' }], defaultModel: 'test-model' });
  mocks.submit.mockResolvedValue({ ok: true, message: 'Recorded' });
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container); onDone = vi.fn(); onClose = vi.fn();
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render(mainnetCashu = false) {
  await act(async () => root.render(<PledgeModal fundraiserId="test-campaign" title="Test project" mainnetCashu={mainnetCashu} onDone={onDone} onClose={onClose} />));
}
async function submit() {
  await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
}

const milestoneBreakdown = (): CampaignBreakdown => ({
  key: 'fr_test',
  frId: 'fr_test',
  title: 'Test project',
  description: 'A tiny campaign.',
  goalSats: 100_000,
  raisedSats: 25_000,
  runner: 'Agent',
  rail: 'cashu',
  frStatus: 'open',
  ownerPubkey: 'ab'.repeat(32),
  milestones: [
    { id: 'm1', title: 'First deliverable', description: 'Do the first thing.', criteria: 'It works.', amountSats: 50_000, status: 'locked', deadlineAt: 1_800_000_000, marketId: null },
  ],
});

it('previews which milestones the entered amount fills (waterfall)', async () => {
  await act(async () => root.render(
    <PledgeModal fundraiserId="test-campaign" title="Test project" breakdown={milestoneBreakdown()} nowSec={1_700_000_000} onDone={onDone} onClose={onClose} />,
  ));
  const lead = [...container.querySelectorAll('button')].find((b) => /Fund this project \(testnet\)/i.test(b.textContent));
  await act(async () => lead!.click());
  expect(container.querySelector('[data-testid=waterfall-preview]')).toBeTruthy();
  expect(container.textContent).toContain('This pledge fills');
  expect(container.textContent).toMatch(/\+1,000 of 50,000 sats/);
  const input = container.querySelector<HTMLInputElement>('input[type=number]')!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, '30000');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(container.textContent).toMatch(/1\. First deliverable - funded/);
});

it('offers the one-transaction split for multi-milestone campaigns and lists every escrow output', async () => {
  const bd = milestoneBreakdown();
  bd.milestones = [
    { ...bd.milestones[0], id: 'm1', title: 'First deliverable', amountSats: 10_000 },
    { ...bd.milestones[0], id: 'm2', title: 'Second deliverable', amountSats: 20_000 },
  ];
  mocks.submit.mockResolvedValueOnce({
    ok: true,
    claimed: 0,
    message: 'One transaction pays 2 milestone escrows',
    awaitingPayment: {
      address: 'tb1pA',
      amountSats: 30_000,
      explorerUrl: '',
      rail: 'btc-testnet4',
      splitGroup: 'group-1',
      outputs: [
        { milestoneId: 'm1', address: 'tb1pA', amountSats: 10_000, explorerUrl: '' },
        { milestoneId: 'm2', address: 'tb1pB', amountSats: 20_000, explorerUrl: '' },
      ],
    },
  });
  await act(async () => root.render(
    <PledgeModal fundraiserId="test-campaign" title="Test project" breakdown={bd} nowSec={1_700_000_000} onDone={onDone} onClose={onClose} />,
  ));
  const lead = [...container.querySelectorAll('button')].find((b) => /Fund this project \(testnet\)/i.test(b.textContent ?? ''));
  await act(async () => lead!.click());
  expect(container.querySelector('[data-testid=split-pledge]')).toBeTruthy();
  await submit();
  // A split pledge spans several escrow addresses: the single-address
  // wallet-drawer shortcut must not be offered.
  expect(container.querySelector('[data-testid=pledge-open-wallet]')).toBeNull();
  expect(mocks.submit).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ split: true }),
  );
  const outputs = container.querySelectorAll('[data-testid=split-output]');
  expect(outputs).toHaveLength(2);
  expect(outputs[0].textContent).toContain('First deliverable');
  expect(outputs[1].textContent).toContain('Second deliverable');
  expect(container.textContent).toContain('pay every output in a SINGLE transaction');
  // The split escrow is the DEFAULT path for multi-milestone campaigns: the
  // NO VALUE badge must render here too, not only on the single-address path.
  expect(container.querySelector('[data-testid="t4-badge-awaiting"]')?.textContent).toBe('TESTNET4 · NO VALUE');
});

it('renders a single-milestone escrow once - no duplicate address block', async () => {
  const bd = milestoneBreakdown();
  bd.milestones = [{ ...bd.milestones[0], id: 'm1', title: 'Only deliverable', amountSats: 10_000 }];
  mocks.submit.mockResolvedValueOnce({
    ok: true,
    claimed: 0,
    message: 'One transaction pays 1 milestone escrow',
    awaitingPayment: {
      address: 'tb1pONLY',
      amountSats: 10_000,
      explorerUrl: '',
      rail: 'btc-testnet4',
      splitGroup: 'group-1',
      outputs: [
        { milestoneId: 'm1', address: 'tb1pONLY', amountSats: 10_000, explorerUrl: '' },
      ],
    },
  });
  await act(async () => root.render(
    <PledgeModal fundraiserId="test-campaign" title="Test project" breakdown={bd} nowSec={1_700_000_000} onDone={onDone} onClose={onClose} />,
  ));
  const lead = [...container.querySelectorAll('button')].find((b) => /Fund this project \(testnet\)/i.test(b.textContent ?? ''));
  await act(async () => lead!.click());
  await submit();
  expect(container.querySelectorAll('[data-testid=split-output]')).toHaveLength(1);
  const addressBlocks = [...container.querySelectorAll('code')].filter((c) => (c.textContent ?? '').includes('tb1pONLY'));
  expect(addressBlocks).toHaveLength(1);
});

it('opens milestones-first when given the breakdown and leads to the pledge via the bottom button', async () => {
  await act(async () => root.render(
    <PledgeModal fundraiserId="test-campaign" title="Test project" breakdown={milestoneBreakdown()} nowSec={1_700_000_000} onDone={onDone} onClose={onClose} />,
  ));
  expect(container.querySelector('[data-testid=milestone-breakdown]')).toBeTruthy();
  expect(container.textContent).toContain('First deliverable');
  // Pledge form is not shown until the bottom button is pressed.
  expect(container.querySelector('button[type="submit"]')).toBeNull();
  const lead = [...container.querySelectorAll('button')].find((b) => /Fund this project \(testnet\)/i.test(b.textContent));
  expect(lead).toBeTruthy();
  await act(async () => lead!.click());
  expect(container.querySelector('[data-testid=milestone-breakdown]')).toBeNull();
  expect(container.querySelector('button[type="submit"]')?.textContent).toContain('Pledge (testnet)');
  // And the donor can step back to the milestones without closing.
  const back = [...container.querySelectorAll('button')].find((b) => /Milestones/i.test(b.textContent));
  await act(async () => back!.click());
  expect(container.querySelector('[data-testid=milestone-breakdown]')).toBeTruthy();
});
it('renders the real dialog and closes through the close button', async () => {
  await render();
  expect(container.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Fund Test project');
  expect(container.textContent).toContain('Test model');
  await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click(); });
  expect(onClose).toHaveBeenCalledOnce();
  expect(mocks.submit).not.toHaveBeenCalled();
});
it('submits the selected testnet parameters and reuses its intent on retry', async () => {
  await render(); await submit(); await submit();
  expect(mocks.submit).toHaveBeenCalledWith({ signer: mocks.signer, pubkey: 'test-pubkey' }, expect.objectContaining({ fundraiserId: 'test-campaign', amountSats: 1000, rail: 'btc-testnet4', judgeModel: 'test-model' }));
  expect(mocks.submit.mock.calls[0][1].idempotencyKey).toBe(mocks.submit.mock.calls[1][1].idempotencyKey);
  expect(onDone).toHaveBeenCalledWith('Recorded');
});
it('shows a failed submission without announcing completion', async () => {
  mocks.submit.mockResolvedValue({ ok: false, message: 'Test rejection' });
  await render(); await submit();
  expect(container.textContent).toContain('Test rejection');
  expect(onDone).not.toHaveBeenCalled();
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
});
it('blocks issuing a real token when the wallet balance is insufficient', async () => {
  await render(true); await submit();
  expect(container.textContent).toContain('Mainnet wallet balance is 0 sats');
  expect(mocks.spend).not.toHaveBeenCalled();
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(onDone).not.toHaveBeenCalled();
});

// ── Testnet4 rail (step 5) ─────────────────────────────────────────────────

function setT4Env(value: string | undefined) {
  const env = import.meta.env as Record<string, string | undefined>;
  if (value === undefined) delete env.VITE_BAO_T4_ENABLED;
  else env.VITE_BAO_T4_ENABLED = value;
}

it('offers the testnet rails by default (testnet4 + liquid-testnet; legacy rails are retired)', async () => {
  setT4Env(undefined);
  await render();
  const options = Array.from(container.querySelectorAll('option')).map((o) => o.getAttribute('value'));
  expect(options).toContain('btc-testnet4');
  expect(options).toContain('liquid-testnet');
  // The retired legacy rails must NOT appear in the dropdown.
  expect(options).not.toContain('cashu');
  expect(options).not.toContain('l1');
  expect(options).not.toContain('liquid');
  // The gate flag no longer hides the rail - the UI is testnet-first now.
  setT4Env('1');
  try {
    await render();
    const enabled = Array.from(container.querySelectorAll('option')).map((o) => o.getAttribute('value'));
    expect(enabled).toContain('btc-testnet4');
  } finally {
    setT4Env(undefined);
  }
});

it('shows the TESTNET4 · NO VALUE badge when the testnet4 rail is selected', async () => {
  setT4Env('1');
  try {
    await render();
    const select = container.querySelector('select')!;
    await act(async () => {
      select.value = 'btc-testnet4';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.textContent).toContain('TESTNET4 · NO VALUE');
    expect(container.querySelector('[data-testid="t4-badge"]')).not.toBeNull();
    // The badge disappears when the other testnet rail is selected.
    await act(async () => {
      select.value = 'liquid-testnet';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.querySelector('[data-testid="t4-badge"]')).toBeNull();
  } finally {
    setT4Env(undefined);
  }
});

it('shows the escrow address with a testnet4 explorer link and the badge on the txid step', async () => {
  setT4Env('1');
  try {
    mocks.submit.mockResolvedValue({
      ok: true,
      claimed: 0,
      message: 'Deposit address issued',
      awaitingPayment: {
        address: 'tb1p2wslz457mz9trzql8nnnsv9lmprohe7ccy6pinj30vzw26zqt4sqp3kl58',
        amountSats: 1000,
        explorerUrl: 'https://mempool.space/testnet4/address/tb1p2wslz457mz9trzql8nnnsv9lmprohe7ccy6pinj30vzw26zqt4sqp3kl58',
        rail: 'btc-testnet4',
      },
    });
    await render();
    const select = container.querySelector('select')!;
    await act(async () => {
      select.value = 'btc-testnet4';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await submit();
    const link = container.querySelector<HTMLAnchorElement>('[data-testid="t4-explorer-address"]');
    expect(link).not.toBeNull();
    expect(link!.href).toBe('https://mempool.space/testnet4/address/tb1p2wslz457mz9trzql8nnnsv9lmprohe7ccy6pinj30vzw26zqt4sqp3kl58');
    expect(container.querySelector('[data-testid="t4-badge-awaiting"]')?.textContent).toBe('TESTNET4 · NO VALUE');
    expect(container.textContent).toContain('NO VALUE');
  } finally {
    setT4Env(undefined);
  }
});

// ── Campaign rail matching ─────────────────────────────────────────────────

it('maps campaign rails to executable UI rails and flags unsupported ones', () => {
  expect(pledgeRailsFor(undefined)).toEqual({ rails: ['btc-testnet4', 'liquid-testnet'], unsupported: [] });
  expect(pledgeRailsFor([])).toEqual({ rails: ['btc-testnet4', 'liquid-testnet'], unsupported: [] });
  expect(pledgeRailsFor(['l1'])).toEqual({ rails: ['btc-testnet4'], unsupported: [] });
  expect(pledgeRailsFor(['liquid'])).toEqual({ rails: ['liquid-testnet'], unsupported: [] });
  expect(pledgeRailsFor(['btc-testnet4', 'liquid-testnet'])).toEqual({ rails: ['btc-testnet4', 'liquid-testnet'], unsupported: [] });
  expect(pledgeRailsFor(['cashu'])).toEqual({ rails: [], unsupported: ['cashu'] });
  expect(pledgeRailsFor(['cashu', 'l1'])).toEqual({ rails: ['btc-testnet4'], unsupported: ['cashu'] });
  expect(pledgeRailsFor(['lightning'])).toEqual({ rails: [], unsupported: ['lightning'] });
});

it('offers only the campaign rail - an l1 campaign cannot be pledged over liquid', async () => {
  await act(async () => root.render(
    <PledgeModal fundraiserId="test-campaign" title="Test project" campaignRails={['l1']} onDone={onDone} onClose={onClose} />,
  ));
  const options = Array.from(container.querySelectorAll('[data-testid=pledge-rail] option')).map((o) => o.getAttribute('value'));
  expect(options).toEqual(['btc-testnet4']);
  await submit();
  expect(mocks.submit).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ rail: 'btc-testnet4' }),
  );
});

it('fails closed when the campaign rail has no executable path (cashu on testnet)', async () => {
  await act(async () => root.render(
    <PledgeModal fundraiserId="test-campaign" title="Test project" campaignRails={['cashu']} onDone={onDone} onClose={onClose} />,
  ));
  expect(container.querySelector('[data-testid=rail-unsupported]')?.textContent).toContain('Cashu');
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
  await submit();
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(container.textContent).toContain('no pledge can be placed');
});

it('rejects uppercase txids on the testnet4 commit step (rail validator contract)', async () => {
  setT4Env('1');
  try {
    mocks.submit.mockResolvedValue({
      ok: true,
      claimed: 0,
      message: 'Deposit address issued',
      awaitingPayment: { address: 'tb1p2wslz457mz9trzql8nnnsv9lmprohe7ccy6pinj30vzw26zqt4sqp3kl58', amountSats: 1000, explorerUrl: '', rail: 'btc-testnet4' },
    });
    await render();
    const select = container.querySelector('select')!;
    await act(async () => {
      select.value = 'btc-testnet4';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await submit();
    const input = container.querySelector<HTMLInputElement>('input[placeholder="64-character txid"]')!;
    await act(async () => {
      input.value = 'A'.repeat(64);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const forms = container.querySelectorAll('form');
    await act(async () => { forms[forms.length - 1].dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(container.textContent).toContain('lowercase hex');
    expect(mocks.submit).toHaveBeenCalledTimes(1); // only the address call
  } finally {
    setT4Env(undefined);
  }
});

it('lets the donor retry a pasted token after a validation error (no permanent lockout)', async () => {
  mocks.decode.mockReturnValueOnce(null);
  mocks.spent.mockResolvedValue(false);
  await render(true);
  const input = container.querySelector<HTMLTextAreaElement>('[data-testid=pledge-token-input]')!;
  const setValue = (v: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(input, v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  await act(async () => { setValue('cashuA-not-a-token'); });
  await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid=pledge-token-deliver]')!.click(); });
  expect(container.textContent).toContain('not a single-mint Cashu token');

  // The donor fixes the paste - the deliver path must work again.
  mocks.decode.mockReturnValue([{
    mintUrl: 'https://mint.example.com',
    proofs: [{ id: '009a1f293253e41e', amount: 1000, secret: 'synthetic-secret', C: '02' + 'ab'.repeat(32) }],
    amount: 1000,
  }]);
  await act(async () => { setValue('cashuB-valid-token'); });
  await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid=pledge-token-deliver]')!.click(); });
  expect(mocks.spent).toHaveBeenCalled();
  expect(container.textContent).toContain('Token issued');
});

it('offers pay-from-built-in-wallet only for single-output pledges, pre-filling the drawer', async () => {
  setT4Env('1');
  const events: CustomEvent[] = [];
  const listener = (e: Event): void => { events.push(e as CustomEvent); };
  window.addEventListener('bao-open-wallet-drawer', listener);
  try {
    mocks.submit.mockResolvedValueOnce({
      ok: true,
      claimed: 0,
      message: 'Deposit address issued',
      awaitingPayment: { address: 'tb1psingleoutput', amountSats: 1000, explorerUrl: '', rail: 'btc-testnet4' },
    });
    await render();
    const select = container.querySelector('select')!;
    await act(async () => {
      select.value = 'btc-testnet4';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await submit();
    const pay = container.querySelector<HTMLButtonElement>('[data-testid=pledge-open-wallet]');
    expect(pay).toBeTruthy();
    expect(pay!.textContent).toContain('Bitcoin testnet4');
    await act(async () => { pay!.click(); });
    expect(events).toHaveLength(1);
    expect(events[0].detail).toMatchObject({ tab: 'send', rail: 'l1', to: 'tb1psingleoutput', sats: '1000' });
  } finally {
    window.removeEventListener('bao-open-wallet-drawer', listener);
    setT4Env(undefined);
  }
});
