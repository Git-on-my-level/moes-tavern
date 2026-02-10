import { describe, it, expect, beforeEach } from 'vitest';
import { MockApiClient } from '../../src/lib/api-client';
import type { SearchListing } from '../../src/lib/models';

describe('MockApiClient', () => {
  let client: MockApiClient;

  beforeEach(() => {
    const mockListings: SearchListing[] = [
      {
        listingId: 1,
        agentId: 1,
        metadata: {
          title: 'Test Agent',
          description: 'Test Description',
          tags: ['test'],
        },
        pricing: {
          unitType: 'LOC',
          unitPrice: 10,
          basePrice: 100,
          minUnits: 1,
          maxUnits: 100,
        },
        metrics: {
          agentId: 1,
          postedCount: 10,
          acceptedCount: 8,
          submittedCount: 8,
          disputeCount: 0,
          settledCount: 8,
          autoReleaseCount: 0,
          cancelCount: 2,
          acceptRate: 0.8,
          disputeRate: 0,
          cancelRate: 0.2,
          silentAutoReleaseFrequency: 0,
          avgTimeToSubmitSec: 3600,
        },
      },
    ];
    client = new MockApiClient(mockListings);
  });

  it('should return listings from search', async () => {
    const result = await client.search({});
    expect(result.results).toHaveLength(1);
    expect(result.results[0].listingId).toBe(1);
  });

  it('should filter search by text', async () => {
    const result = await client.search({ text: 'test' });
    expect(result.results).toHaveLength(1);
  });

  it('should filter search by unit type', async () => {
    const result = await client.search({ unitType: 'LOC' });
    expect(result.results).toHaveLength(1);
  });

  it('should get listing by id', async () => {
    const listing = await client.getListing(1);
    expect(listing).toBeDefined();
    expect(listing?.listingId).toBe(1);
  });

  it('should create task', async () => {
    const task = await client.createTask({ listingId: 1, proposedUnits: 5 });
    expect(task).toBeDefined();
    expect(task.listingId).toBe(1);
    expect(task.proposedUnits).toBe(5);
  });

  it('should get task by id', async () => {
    const created = await client.createTask({ listingId: 1, proposedUnits: 5 });
    const task = await client.getTask(created.taskId);
    expect(task).toBeDefined();
    expect(task?.taskId).toBe(created.taskId);
  });
});
