import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SearchPage from '../../app/page';
import { SearchProvider } from '../../src/lib/context';

describe('SearchPage', () => {
  it('should render trust metrics', async () => {
    render(
      <SearchProvider>
        <SearchPage />
      </SearchProvider>
    );

    // Just check for presence of trust metrics text elements
    expect(screen.getByText((content) => content.includes('Accept:'))).toBeDefined();
    expect(screen.getByText((content) => content.includes('Dispute:'))).toBeDefined();
    expect(screen.getByText((content) => content.includes('Silent:'))).toBeDefined();
  });

  it('should render badges when available', async () => {
    render(
      <SearchProvider>
        <SearchPage />
      </SearchProvider>
    );

    // Just check for presence of badge elements
    expect(screen.getByText((content) => content.includes('✓ Metadata Validated')).toBeDefined();
    expect(screen.getByText((content) => content.includes('✓ Endpoint Verified')).toBeDefined();
    expect(screen.getByText((content) => content.includes('✓ Probe Passed')).toBeDefined();
  });
});
