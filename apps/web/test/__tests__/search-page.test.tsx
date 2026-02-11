import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import SearchPage from '../../app/page';
import { SearchProvider } from '../../src/lib/context';

describe('SearchPage', () => {
  it('should render trust metrics', async () => {
    render(
      <SearchProvider>
        <SearchPage />
      </SearchProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText(/result.*found/i)).toBeDefined();
    });

    expect(
      screen.getAllByText((content) => content.includes('Accept:')).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText((content) => content.includes('Dispute:')).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText((content) => content.includes('Silent:')).length,
    ).toBeGreaterThan(0);
  });

  it('should render badges when available', async () => {
    render(
      <SearchProvider>
        <SearchPage />
      </SearchProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText(/result.*found/i)).toBeDefined();
    });

    expect(
      screen.getAllByText((content) => content.includes('✓ Metadata Validated'))
        .length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText((content) => content.includes('✓ Endpoint Verified'))
        .length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText((content) => content.includes('✓ Probe Passed'))
        .length,
    ).toBeGreaterThan(0);
  });
});
