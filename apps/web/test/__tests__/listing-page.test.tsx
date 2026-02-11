import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ListingPage from '../../app/listing/[id]/page';

vi.mock('next/navigation', async () => {
  const actual = await vi.importActual('next/navigation');
  return {
    ...actual,
    useParams: () => ({ id: '1' }),
  };
});

vi.mock('../../src/lib/api-client', () => ({
  mockApiClient: {
    getListing: vi.fn().mockResolvedValue({
      listingId: 1,
      agentId: 1,
      metadata: {
        title: 'Code Review Assistant',
        description: 'Expert code review',
        tags: ['code-review'],
      },
      pricing: {
        unitType: 'LOC',
        unitPrice: 10,
        basePrice: 100,
        minUnits: 10,
        maxUnits: 1000,
      },
      policy: {
        challengeWindowSec: 86400,
        postDisputeWindowSec: 604800,
        sellerBondBps: 100,
      },
      metrics: {
        agentId: 1,
        postedCount: 50,
        acceptedCount: 45,
        submittedCount: 45,
        disputeCount: 2,
        settledCount: 43,
        autoReleaseCount: 5,
        cancelCount: 5,
        acceptRate: 0.9,
        disputeRate: 0.04,
        cancelRate: 0.1,
        silentAutoReleaseFrequency: 0.12,
        avgTimeToSubmitSec: 3600,
      },
      curation: {
        updatedAt: Date.now(),
        badges: {
          metadata_validated: true,
          endpoint_verified: true,
          probe_passed: true,
        },
        riskScore: 10,
        probeScore: 0.9,
        probeEvidenceURI: 'ipfs://test',
        lint: { valid: true, errors: [], warnings: [], spamSignals: [] },
        endpointHealth: {
          total: 1,
          okCount: 1,
          failedCount: 0,
          checkedAt: Date.now(),
        },
      },
    }),
  },
}));

describe('ListingPage', () => {
  it('should render pricing policy', async () => {
    render(<ListingPage params={{ id: '1' }} />);

    await screen.findByText(/Code Review Assistant/i);

    expect(screen.getByText(/Challenge Window:/i)).toBeDefined();
    expect(screen.getByText(/Post-Dispute Window:/i)).toBeDefined();
    expect(screen.getByText(/Seller Bond:/i)).toBeDefined();
  });

  it('should render create task CTA with pre-filled listingId', async () => {
    render(<ListingPage params={{ id: '1' }} />);

    await screen.findByText(/Create Task/i);

    const createTaskButton = screen.getByText(/Create Task/i);
    expect(createTaskButton.closest('a')).toHaveAttribute(
      'href',
      '/task/new?listingId=1&unitType=LOC',
    );
  });
});

vi.mock('../../../src/lib/api-client', () => ({
  mockApiClient: {
    getListing: vi.fn().mockResolvedValue({
      listingId: 1,
      agentId: 1,
      metadata: {
        title: 'Code Review Assistant',
        description: 'Expert code review',
        tags: ['code-review'],
      },
      pricing: {
        unitType: 'LOC',
        unitPrice: 10,
        basePrice: 100,
        minUnits: 10,
        maxUnits: 1000,
      },
      policy: {
        challengeWindowSec: 86400,
        postDisputeWindowSec: 604800,
        sellerBondBps: 100,
      },
      metrics: {
        agentId: 1,
        postedCount: 50,
        acceptedCount: 45,
        submittedCount: 45,
        disputeCount: 2,
        settledCount: 43,
        autoReleaseCount: 5,
        cancelCount: 5,
        acceptRate: 0.9,
        disputeRate: 0.04,
        cancelRate: 0.1,
        silentAutoReleaseFrequency: 0.12,
        avgTimeToSubmitSec: 3600,
      },
      curation: {
        updatedAt: Date.now(),
        badges: {
          metadata_validated: true,
          endpoint_verified: true,
          probe_passed: true,
        },
        riskScore: 10,
        probeScore: 0.9,
        probeEvidenceURI: 'ipfs://test',
        lint: { valid: true, errors: [], warnings: [], spamSignals: [] },
        endpointHealth: {
          total: 1,
          okCount: 1,
          failedCount: 0,
          checkedAt: Date.now(),
        },
      },
    }),
  },
}));

describe('ListingPage', () => {
  it('should render pricing policy', async () => {
    render(<ListingPage params={{ id: '1' }} />);

    await screen.findByText(/Code Review Assistant/i);

    expect(screen.getByText(/Challenge Window:/i)).toBeDefined();
    expect(screen.getByText(/Post-Dispute Window:/i)).toBeDefined();
    expect(screen.getByText(/Seller Bond:/i)).toBeDefined();
  });

  it('should render create task CTA with pre-filled listingId', async () => {
    render(<ListingPage params={{ id: '1' }} />);

    await screen.findByText(/Create Task/i);

    const createTaskButton = screen.getByText(/Create Task/i);
    expect(createTaskButton.closest('a')).toHaveAttribute(
      'href',
      '/task/new?listingId=1&unitType=LOC',
    );
  });
});
