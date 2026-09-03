import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TestApp } from '@/test/TestApp';
import { BAO_HOSTED_ORIGIN } from '@/lib/baosocial/relayPolicy';
import { BaoCommunitiesPage } from './BaoCommunitiesPage';

describe('BaoCommunitiesPage', () => {
  it('embeds the canonical encrypted chat instead of showing a launcher card', async () => {
    render(
      <TestApp>
        <BaoCommunitiesPage />
      </TestApp>,
    );

    const chat = await screen.findByTitle('2140 Community Chat');
    expect(chat).toBeInstanceOf(HTMLIFrameElement);
    expect(chat).toHaveAttribute('src', BAO_HOSTED_ORIGIN);
    expect(screen.queryByText(/Room discovery and authentication run/)).not.toBeInTheDocument();
  });
});
