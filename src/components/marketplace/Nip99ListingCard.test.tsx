import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { TestApp } from '@/test/TestApp';
import { Nip99ListingCard } from './Nip99ListingCard';
import type { Nip99Listing } from '@/lib/nip99';

const navigateMock = vi.fn();

const mocks = vi.hoisted(() => ({
  currentUser: null as { pubkey: string } | null,
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: mocks.currentUser }),
}));

vi.mock('@/hooks/useAuthor', () => ({
  useAuthor: () => ({ data: { metadata: {} } }),
}));

vi.mock('@/hooks/useProfileUrl', () => ({
  useProfileUrl: () => '/p/seller',
}));

vi.mock('@/hooks/useMarkListingSold', () => ({
  useMarkListingSold: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/components/auth/LoginDialog', () => ({
  default: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="login-dialog">Login dialog</div> : null,
}));

vi.mock('@/components/marketplace/MarketplaceBuyDialog', () => ({
  MarketplaceBuyDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="buy-dialog">Buy dialog</div> : null,
}));

function makeListing(): Nip99Listing {
  return {
    id: 'seller:product',
    eventId: 'event-id',
    pubkey: '0000000000000000000000000000000000000000000000000000000000000001',
    dTag: 'product',
    title: 'Test Product',
    summary: 'A test product',
    content: 'Detailed description',
    price: { value: 1000, currency: 'sats' },
    images: ['https://example.com/image.png'],
    categories: ['art'],
    status: 'active',
    shippingOptionRefs: [],
    createdAt: 0,
    event: {
      id: 'event-id',
      pubkey: '0000000000000000000000000000000000000000000000000000000000000001',
      kind: 30402,
      tags: [
        ['d', 'product'],
        ['title', 'Test Product'],
        ['price', '1000', 'sats'],
        ['t', 'art'],
        ['image', 'https://example.com/image.png'],
      ],
      content: 'Detailed description',
      created_at: 0,
      sig: 'sig',
    },
  };
}

function getCardButton(): HTMLElement {
  const buttons = screen.getAllByRole('button');
  const cardButton = buttons.find((b) => b.querySelector('img[alt="Test Product"]'));
  if (!cardButton) throw new Error('Card button not found');
  return cardButton;
}

describe('Nip99ListingCard', () => {
  beforeEach(() => {
    navigateMock.mockClear();
    mocks.currentUser = null;
  });

  it('opens the login dialog when an anonymous user clicks Buy', async () => {
    render(
      <TestApp>
        <Nip99ListingCard listing={makeListing()} />
      </TestApp>,
    );

    await screen.findByText('Test Product');
    await act(async () => {
      fireEvent.click(getCardButton());
    });
    const buyButton = screen.getByRole('button', { name: /Buy/i });
    await act(async () => {
      fireEvent.click(buyButton);
    });

    expect(screen.getByTestId('login-dialog')).toBeInTheDocument();
    expect(screen.queryByTestId('buy-dialog')).not.toBeInTheDocument();
  });

  it('opens the buy dialog when a logged-in user clicks Buy', async () => {
    mocks.currentUser = { pubkey: '0000000000000000000000000000000000000000000000000000000000000002' };

    render(
      <TestApp>
        <Nip99ListingCard listing={makeListing()} />
      </TestApp>,
    );

    await screen.findByText('Test Product');
    await act(async () => {
      fireEvent.click(getCardButton());
    });
    const buyButton = screen.getByRole('button', { name: /Buy/i });
    await act(async () => {
      fireEvent.click(buyButton);
    });

    expect(screen.queryByTestId('login-dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('buy-dialog')).toBeInTheDocument();
  });
});
