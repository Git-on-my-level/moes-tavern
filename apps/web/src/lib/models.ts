import type { ListingMetadata } from '@moes/curation';
import type { AgentMetrics, ListingCuration } from '@moes/indexer';

export type ListingPricing = {
  unitType: string;
  unitPrice: number;
  basePrice: number;
  minUnits: number;
  maxUnits: number;
};

export type ListingPolicy = {
  challengeWindowSec: number;
  postDisputeWindowSec: number;
  sellerBondBps: number;
};

export type SearchListing = {
  listingId: number;
  agentId: number;
  metadata: ListingMetadata;
  pricing: ListingPricing;
  policy: ListingPolicy;
  metrics: AgentMetrics;
  curation?: ListingCuration | null;
};

export type SearchResult = {
  listingId: number;
  listing: SearchListing;
  score: number;
  relevanceScore: number;
  trustScore: number;
  economicsScore: number;
};

export type SearchFacets = {
  unitType: Record<string, number>;
  priceBucket: Record<string, number>;
};

export type SearchResponse = {
  results: SearchResult[];
  facets: SearchFacets;
};

export type SearchQuery = {
  text?: string;
  unitType?: string;
  priceBucket?: string;
};

export type TaskDraft = {
  listingId: number;
  proposedUnits: number;
  unitType?: string;
  taskURI?: string;
};

export type Task = {
  taskId: number;
  listingId: number;
  agentId: number;
  buyer: string;
  status:
    | 'OPEN'
    | 'QUOTED'
    | 'ACTIVE'
    | 'SUBMITTED'
    | 'DISPUTED'
    | 'SETTLED'
    | 'CANCELLED';
  taskURI?: string;
  proposedUnits: number;
  quotedUnits?: number;
  quotedTotalPrice?: number;
  quoteExpiry?: number;
  fundedAmount?: number;
  artifactURI?: string;
  artifactHash?: string;
  postedAt?: number;
  acceptedAt?: number;
  submittedAt?: number;
  settledAt?: number;
};

export type ApiClient = {
  search: (query: SearchQuery) => Promise<SearchResponse>;
  getListing: (listingId: number) => Promise<SearchListing | null>;
  createTask: (draft: TaskDraft) => Promise<Task>;
  getTask: (taskId: number) => Promise<Task | null>;
};
