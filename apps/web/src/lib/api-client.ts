import type {
  ApiClient,
  SearchListing,
  SearchQuery,
  SearchResponse,
  Task,
  TaskDraft,
} from './models';

export class MockApiClient implements ApiClient {
  private listings: Map<number, SearchListing>;
  private tasks: Map<number, Task>;
  private nextTaskId = 1;

  constructor(listings: SearchListing[] = []) {
    this.listings = new Map(listings.map((l) => [l.listingId, l]));
    this.tasks = new Map();
  }

  async search(query: SearchQuery): Promise<SearchResponse> {
    let results = Array.from(this.listings.values());

    if (query.text) {
      const lowerQuery = query.text.toLowerCase();
      results = results.filter(
        (l) =>
          l.metadata.title.toLowerCase().includes(lowerQuery) ||
          l.metadata.description.toLowerCase().includes(lowerQuery) ||
          l.metadata.tags.some((t: string) =>
            t.toLowerCase().includes(lowerQuery),
          ),
      );
    }

    if (query.unitType) {
      results = results.filter((l) => l.pricing.unitType === query.unitType);
    }

    if (query.priceBucket) {
      const bucketRanges: Record<string, [number, number]> = {
        'under-50': [0, 50],
        '50-100': [50, 100],
        '100-250': [100, 250],
        '250-500': [250, 500],
        '500-plus': [500, Number.POSITIVE_INFINITY],
      };
      const range = bucketRanges[query.priceBucket];
      if (range) {
        results = results.filter(
          (l) =>
            l.pricing.unitPrice >= range[0] && l.pricing.unitPrice < range[1],
        );
      }
    }

    const scoredResults = results.map((listing) => ({
      listingId: listing.listingId,
      listing,
      score: 1 - listing.metrics.disputeRate,
      relevanceScore: 1,
      trustScore: listing.metrics.acceptRate,
      economicsScore: 0.5,
    }));

    const facets = this.computeFacets(results);

    return { results: scoredResults, facets };
  }

  async getListing(listingId: number): Promise<SearchListing | null> {
    return this.listings.get(listingId) ?? null;
  }

  async createTask(draft: TaskDraft): Promise<Task> {
    const listing = this.listings.get(draft.listingId);
    if (!listing) {
      throw new Error(`Listing ${draft.listingId} not found`);
    }

    const task: Task = {
      taskId: this.nextTaskId++,
      listingId: draft.listingId,
      agentId: listing.agentId,
      buyer: '0x0000000000000000000000000000000000000000',
      status: 'OPEN',
      taskURI: draft.taskURI,
      proposedUnits: draft.proposedUnits,
      postedAt: Date.now(),
    };

    this.tasks.set(task.taskId, task);
    return task;
  }

  async getTask(taskId: number): Promise<Task | null> {
    return this.tasks.get(taskId) ?? null;
  }

  private computeFacets(listings: SearchListing[]): {
    unitType: Record<string, number>;
    priceBucket: Record<string, number>;
  } {
    const unitType: Record<string, number> = {};
    const priceBucket: Record<string, number> = {};

    for (const listing of listings) {
      unitType[listing.pricing.unitType] =
        (unitType[listing.pricing.unitType] ?? 0) + 1;

      const bucketId = this.getPriceBucketId(listing.pricing.unitPrice);
      priceBucket[bucketId] = (priceBucket[bucketId] ?? 0) + 1;
    }

    return { unitType, priceBucket };
  }

  private getPriceBucketId(unitPrice: number): string {
    const buckets: { id: string; min: number; max: number }[] = [
      { id: 'under-50', min: 0, max: 50 },
      { id: '50-100', min: 50, max: 100 },
      { id: '100-250', min: 100, max: 250 },
      { id: '250-500', min: 250, max: 500 },
      { id: '500-plus', min: 500, max: Number.POSITIVE_INFINITY },
    ];

    for (const bucket of buckets) {
      if (unitPrice >= bucket.min && unitPrice < bucket.max) {
        return bucket.id;
      }
    }
    return 'unknown';
  }
}

export const mockApiClient = new MockApiClient([
  {
    listingId: 1,
    agentId: 1,
    metadata: {
      title: 'Code Review Assistant',
      description: 'Expert code review with focus on security and performance',
      tags: ['code-review', 'security', 'performance'],
    },
    pricing: {
      unitType: 'LOC',
      unitPrice: 10,
      basePrice: 100,
      minUnits: 10,
      maxUnits: 1000,
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
  },
  {
    listingId: 2,
    agentId: 2,
    metadata: {
      title: 'Data Processing Service',
      description: 'Fast and reliable data processing and transformation',
      tags: ['data', 'processing', 'transformation'],
    },
    pricing: {
      unitType: 'MB',
      unitPrice: 0.5,
      basePrice: 50,
      minUnits: 100,
      maxUnits: 10000,
    },
    metrics: {
      agentId: 2,
      postedCount: 30,
      acceptedCount: 28,
      submittedCount: 28,
      disputeCount: 1,
      settledCount: 27,
      autoReleaseCount: 3,
      cancelCount: 2,
      acceptRate: 0.93,
      disputeRate: 0.04,
      cancelRate: 0.07,
      silentAutoReleaseFrequency: 0.11,
      avgTimeToSubmitSec: 1800,
    },
    curation: {
      updatedAt: Date.now(),
      badges: {
        metadata_validated: true,
        endpoint_verified: false,
        probe_passed: true,
      },
      riskScore: 15,
      probeScore: 0.85,
      probeEvidenceURI: 'ipfs://test2',
      lint: { valid: true, errors: [], warnings: [], spamSignals: [] },
      endpointHealth: {
        total: 1,
        okCount: 0,
        failedCount: 1,
        checkedAt: Date.now(),
      },
    },
  },
]);
