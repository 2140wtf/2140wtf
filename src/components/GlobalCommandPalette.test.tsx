import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TestApp } from '@/test/TestApp';
import { dispatchBaoTerm } from '@/lib/baoTermDispatch';
import { GlobalTerminal } from './GlobalCommandPalette';

vi.mock('@/lib/baoTermDispatch', () => ({
  dispatchBaoTerm: vi.fn(),
}));

const dispatchMock = vi.mocked(dispatchBaoTerm);

async function openTerminal() {
  await act(async () => undefined);
  fireEvent.keyDown(document.body, { key: '/' });
  return screen.findByPlaceholderText('Terminal — what would you like to do?');
}

describe('GlobalTerminal', () => {
  beforeEach(() => {
    dispatchMock.mockResolvedValue({ ok: true, result: { done: true } });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('opens a human form and executes creation without exposing CLI syntax', async () => {
    render(<TestApp><GlobalTerminal /></TestApp>);
    await openTerminal();

    fireEvent.click(screen.getByText('Create a ₿AO', { selector: 'span' }));
    fireEvent.change(screen.getByLabelText('₿AO name'), { target: { value: 'Garden club' } });
    fireEvent.change(screen.getByLabelText('Owner identity name'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText('Home relays (optional, comma separated)'), {
      target: { value: 'wss://relay.ditto.pub, wss://jskitty.com/nostr' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create a ₿AO' }));

    await waitFor(() => expect(dispatchMock).toHaveBeenCalledWith('create', {
      name: 'Garden club',
      identityName: 'alice',
      agentOnly: false,
      relays: ['wss://relay.ditto.pub', 'wss://jskitty.com/nostr'],
    }));
    expect(screen.queryByText(/create --name/)).not.toBeInTheDocument();
  });

  it('runs the highlighted immediate action with Enter', async () => {
    render(<TestApp><GlobalTerminal /></TestApp>);
    const input = await openTerminal();
    fireEvent.change(input, { target: { value: 'Show current identity' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(dispatchMock).toHaveBeenCalledWith('whoami', {}));
  });

  it('supports arrow-key selection followed by Enter', async () => {
    render(<TestApp><GlobalTerminal /></TestApp>);
    const input = await openTerminal();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByRole('button', { name: 'Add an identity' })).toBeVisible();
  });

  it('shows human help without rendering terminal syntax', async () => {
    render(<TestApp><GlobalTerminal /></TestApp>);
    await openTerminal();
    fireEvent.click(screen.getByText('Show available actions', { selector: 'span' }));
    expect(await screen.findByText(/Choose any action in the Terminal/)).toBeVisible();
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  const directActions = [
    ['Show saved identities', 'identities'],
    ['Clear active identity', 'logout'],
    ['Show community members', 'members'],
    ['Show current identity', 'whoami'],
  ] as const;

  it.each(directActions)('executes %s immediately', async (label, verb) => {
    render(<TestApp><GlobalTerminal /></TestApp>);
    await openTerminal();
    fireEvent.click(screen.getByText(label, { selector: 'span' }));
    await waitFor(() => expect(dispatchMock).toHaveBeenCalledWith(verb, {}));
  });

  const formActions = [
    ['Add an identity', 'login'],
    ['Create a ₿AO', 'create'],
    ['Join a ₿AO', 'join'],
    ['Create an invite', 'invite'],
    ['Send a message', 'say'],
    ['Read messages', 'read'],
    ['Switch identity', 'use'],
    ['Manage member roles', 'admin'],
    ['Ban a member', 'ban'],
    ['Unban a member', 'unban'],
    ['Kick a member', 'kick'],
    ['Manage channels', 'channel'],
    ['Community settings', 'meta'],
  ] as const;

  it.each(formActions)('opens and submits %s from mouse selection', async (label, verb) => {
    render(<TestApp><GlobalTerminal /></TestApp>);
    await openTerminal();
    fireEvent.click(screen.getByText(label, { selector: 'span' }));
    const form = screen.getByRole('button', { name: label }).closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    await waitFor(() => expect(dispatchMock).toHaveBeenCalledWith(verb, expect.any(Object)));
  });

  it.each([
    ['Remove an identity', 'remove'],
    ['Dissolve a ₿AO', 'dissolve'],
  ] as const)('requires confirmation and then executes %s', async (label, verb) => {
    render(<TestApp><GlobalTerminal /></TestApp>);
    await openTerminal();
    fireEvent.click(screen.getByText(label, { selector: 'span' }));
    fireEvent.click(screen.getByRole('checkbox'));
    const form = screen.getByRole('button', { name: label }).closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    await waitFor(() => expect(dispatchMock).toHaveBeenCalledWith(verb, expect.any(Object)));
  });
});
